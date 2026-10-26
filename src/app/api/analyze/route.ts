export const runtime = "nodejs";
export const maxDuration = 300;

type RequestBody = { provider: "openai" | "gemini" | "anthropic"; apiKey: string; model: string; prompt: string };

export async function POST(request: Request) {
  const { provider, apiKey, model, prompt } = await request.json() as RequestBody;
  if (!apiKey?.trim() || !prompt?.trim()) return Response.json({ error: "Choose a provider and enter its API key." }, { status: 400 });
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
    return Response.json({ answer, model });
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    return Response.json({ error: timeout ? "The analysis took too long. Try a faster model or retry later." : "Could not connect to the selected AI provider." }, { status: timeout ? 504 : 502 });
  } finally {
    clearTimeout(timer);
  }
}
