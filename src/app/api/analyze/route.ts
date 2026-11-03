import { currentUser } from "@/lib/auth";
import { getBundle, saveBundle } from "@/lib/database";
import { getProviderKey } from "@/lib/secrets";
import type { Run } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type RequestBody = { runId?: number };

function pace(run: Run) { const value = run.distance ? run.duration / run.distance : 0; return `${Math.floor(value)}:${String(Math.round(value % 1 * 60)).padStart(2, "0")}`; }
function zones(lthr: number) {
  const bpm = (percent: number) => Math.round(lthr * percent / 100);
  return `Z1 below ${bpm(85)}; Z2 ${bpm(85)}–${bpm(89)}; Z3 ${bpm(90)}–${bpm(94)}; Z4 ${bpm(95)}–${bpm(99)}; Z5a ${bpm(100)}–${bpm(102)}; Z5b ${bpm(103)}–${bpm(106)}; Z5c above ${bpm(106)} bpm. These are LTHR-based running zones.`;
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  const { runId } = await request.json() as RequestBody;
  if (!Number.isInteger(runId)) return Response.json({ error: "Choose a saved run to analyze." }, { status: 400 });
  const bundle = await getBundle();
  const run = bundle.runs.find((item) => item.id === runId);
  if (!run) return Response.json({ error: "That run could not be found." }, { status: 404 });
  const provider = bundle.preferences.provider;
  const model = bundle.preferences.model;
  const apiKey = await getProviderKey(provider);
  if (!apiKey) return Response.json({ error: `Save a ${provider} API key in Admin Settings before analyzing runs.` }, { status: 400 });
  const lthr = Number(bundle.preferences.lthr);
  const zoneContext = Number.isFinite(lthr) && lthr > 0 ? `Runner’s LTHR: ${lthr} bpm. Use these zones: ${zones(lthr)} Compare average and maximum heart rate with the zones, but do not infer time-in-zone from summary HR.` : "The runner's LTHR and heart-rate zones are not configured. Do not guess them.";
  const prompt = `You are a direct, evidence-based running coach. Give honest, specific, unsugar-coated but constructive feedback. Do not diagnose injuries. Distinguish facts from uncertainty.\n\nHeart-rate context: ${zoneContext}\n\nRun: ${JSON.stringify({ ...run, pace: `${pace(run)} min/km` })}\n\nBe concise: what went well, what needs attention, ITB/recovery signal, and next-session recommendation.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 280 * 1000);
  try {
    let response: Response;
    let answer = "";
    if (provider === "openai") {
      response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: model || "gpt-6-luna", input: prompt, max_output_tokens: 900 }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) return Response.json({ error: result.error?.message || "OpenAI request failed." }, { status: response.status });
      answer = result.output?.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content || []).filter((part: { type: string }) => part.type === "output_text").map((part: { text?: string }) => part.text).join("\n") || result.output_text || "";
    } else if (provider === "anthropic") {
      response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: model || "claude-sonnet-5-5", max_tokens: 900, messages: [{ role: "user", content: prompt }] }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) return Response.json({ error: result.error?.message || "Anthropic request failed." }, { status: response.status });
      answer = result.content?.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("\n") || "";
    } else if (provider === "gemini") {
      const headers = { "x-goog-api-key": apiKey, "Content-Type": "application/json", "Api-Revision": "2026-05-20" };
      response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers, body: JSON.stringify({ model: model || "gemini-3.8-flash", input: prompt, background: true, store: false, generation_config: { thinking_level: "low", max_output_tokens: 900 } }), signal: controller.signal });
      let interaction = await response.json();
      if (!response.ok) return Response.json({ error: interaction.error?.message || "Gemini request failed." }, { status: response.status });
      const started = Date.now();
      while (interaction.status === "in_progress" && Date.now() - started < 270 * 1000) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(interaction.id)}`, { headers, signal: controller.signal });
        interaction = await response.json();
        if (!response.ok) return Response.json({ error: interaction.error?.message || "Gemini request failed." }, { status: response.status });
      }
      answer = interaction.output_text || interaction.steps?.flatMap((step: { content?: { type: string; text?: string }[] }) => step.content || []).filter((part: { type: string }) => part.type === "text").map((part: { text?: string }) => part.text).join("\n") || "";
      if (interaction.status !== "completed" || !answer) return Response.json({ error: "Gemini did not complete the analysis. Please try again." }, { status: 502 });
    } else {
      return Response.json({ error: "Unsupported AI provider." }, { status: 400 });
    }
    const updatedRuns = bundle.runs.map((item) => item.id === runId ? { ...item, analysis: answer } : item);
    await saveBundle({ runs: updatedRuns });
    return Response.json({ answer, model, provider });
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    return Response.json({ error: timeout ? "The analysis took too long. Try a faster model or retry later." : "Could not connect to the selected AI provider." }, { status: timeout ? 504 : 502 });
  } finally {
    clearTimeout(timer);
  }
}
