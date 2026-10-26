import * as XLSX from "xlsx";
import { saveBundle, getBundle } from "@/lib/database";
import type { Run, Workout } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function value(row: unknown[], index: number) { return row[index] ?? ""; }
function text(raw: unknown) { return String(raw ?? "").trim(); }
function numeric(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const result = Number(raw);
  return Number.isFinite(result) ? result : null;
}
function dateString(raw: unknown): string {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number") return XLSX.SSF.parse_date_code(raw)?.y ? new Date(Date.UTC(XLSX.SSF.parse_date_code(raw)!.y, XLSX.SSF.parse_date_code(raw)!.m - 1, XLSX.SSF.parse_date_code(raw)!.d)).toISOString().slice(0, 10) : "";
  return text(raw).slice(0, 10);
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function csvRun(row: Record<string, string>): Run | null {
  const date = text(row.date);
  const name = text(row.name);
  const distance = numeric(row.distance);
  const duration = numeric(row.duration);
  if (!date || !name || distance === null || duration === null) return null;
  return { date, name, type: text(row.type) || "Run", distance, duration, avgHr: numeric(row.avgHr), maxHr: numeric(row.maxHr), sleep: numeric(row.sleep), pain: numeric(row.pain), painDuring: text(row.painDuring), painNext: text(row.painNext), effort: numeric(row.effort), weatherStart: text(row.weatherStart), weatherEnd: text(row.weatherEnd), weatherDuring: text(row.weatherDuring), weatherRoute: text(row.weatherRoute), location: text(row.location), startTime: text(row.startTime), shoes: text(row.shoes), notes: text(row.notes) };
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size > 40_000_000) return Response.json({ error: "Choose an Excel workbook under 40 MB." }, { status: 413 });
  try {
    if (file.name.toLowerCase().endsWith(".csv")) {
      const rows = parseCsv(await file.text());
      const headers = rows.shift()?.map((header) => header.trim()) || [];
      const required = ["date", "name", "distance", "duration"];
      const missing = required.filter((header) => !headers.includes(header));
      if (missing.length) return Response.json({ error: `CSV is missing required columns: ${missing.join(", ")}.` }, { status: 400 });
      const importedRuns = rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]))).map(csvRun).filter((run): run is Run => Boolean(run));
      const current = await getBundle();
      const seen = new Set(current.runs.map((run) => `${run.date}|${run.name}`));
      const result = await saveBundle({ runs: [...current.runs, ...importedRuns.filter((run) => !seen.has(`${run.date}|${run.name}`))] });
      return Response.json({ ...result, importedRuns: importedRuns.length, importedWorkouts: 0 });
    }
    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const runSheet = workbook.Sheets["Run Log"];
    const planSheet = workbook.Sheets["Training Plan"];
    if (!runSheet || !planSheet) return Response.json({ error: "Workbook must include Run Log and Training Plan sheets." }, { status: 400 });
    const runRows = XLSX.utils.sheet_to_json<unknown[]>(runSheet, { header: 1, raw: true, defval: "" });
    const importedRuns: Run[] = [];
    for (const row of runRows.slice(4)) {
      const label = text(value(row, 3));
      const distance = numeric(value(row, 4));
      const seconds = numeric(value(row, 5));
      if (!label || distance === null || seconds === null) continue;
      const match = label.match(/(\d{1,2})\/(\d{1,2})/);
      const date = match ? `${dateString(value(row, 0)).slice(0, 4) || "2026"}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : dateString(value(row, 0));
      const parts = label.split(/\r?\n/);
      const name = parts.at(-1)?.trim() || label;
      const weather = text(value(row, 13));
      const weatherTimes = weather.match(/([^\s]+\s*[AP]M)\s+to\s+([^\s]+\s*[AP]M)/i);
      const temperatures = weather.match(/(-?\d+(?:\.\d+)?)\s*°?C?\s+to\s+(-?\d+(?:\.\d+)?)\s*°?C?/i);
      const sleepText = text(value(row, 12));
      const sleepParts = sleepText.match(/(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?/i);
      const sleep = sleepParts && (sleepParts[1] || sleepParts[2]) ? Number(sleepParts[1] || 0) + Number(sleepParts[2] || 0) / 60 : numeric(value(row, 12));
      importedRuns.push({
        date, name, type: name.replace(/\s+run$/i, "") || "Run", distance,
        duration: Math.round(seconds * 1440 * 10000) / 10000,
        avgHr: numeric(value(row, 7)), maxHr: numeric(value(row, 8)), effort: numeric(value(row, 9)),
        painDuring: text(value(row, 10)), painNext: text(value(row, 11)), sleep,
        pain: Math.max(0, ...(text(value(row, 10)).match(/\d+(?:\.\d+)?/g) || ["0"]).map(Number)),
        weatherRoute: weather,
        weatherStart: weatherTimes && temperatures ? `${weatherTimes[1]} · ${temperatures[1]}°C` : weather,
        weatherEnd: weatherTimes && temperatures ? `${weatherTimes[2]} · ${temperatures[2]}°C` : "",
        shoes: text(value(row, 14)), notes: text(value(row, 15)),
      });
    }
    const planRows = XLSX.utils.sheet_to_json<unknown[]>(planSheet, { header: 1, raw: true, defval: "" });
    const importedPlan: Workout[] = planRows.slice(4).flatMap((row, index) => {
      const date = dateString(value(row, 5));
      const session = text(value(row, 6));
      if (!date || !session || /no run|^rest|^strength/i.test(session)) return [];
      return [{ id: `excel-${date}-${index}`, week: numeric(value(row, 0)) || 0, phase: text(value(row, 2)), day: text(value(row, 4)), date, session, pace: text(value(row, 7)), hr: text(value(row, 8)), target: text(value(row, 9)), strength: text(value(row, 10)), notes: text(value(row, 11)), itbNext: text(value(row, 12)), status: "planned" }];
    });
    const current = await getBundle();
    const seenRuns = new Set(current.runs.map((run) => `${run.date}|${run.name}`));
    const runs = [...current.runs, ...importedRuns.filter((run) => !seenRuns.has(`${run.date}|${run.name}`))];
    const plan = importedPlan.length ? importedPlan : current.plan;
    const result = await saveBundle({ runs, plan, meta: { ...current.meta, title: "SM2SM 2027 Half Marathon", raceDate: current.preferences.raceDate, goalFinish: "1:44:59", goalPace: "4:58/km" } });
    return Response.json({ ...result, importedRuns: importedRuns.length, importedWorkouts: importedPlan.length });
  } catch {
    return Response.json({ error: "Could not read the workbook. Check that it is a valid training-plan spreadsheet." }, { status: 400 });
  }
}
