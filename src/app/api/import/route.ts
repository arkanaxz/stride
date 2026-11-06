import * as XLSX from "xlsx";
import { currentUser } from "@/lib/auth";
import { appendRunHistorySafely, getBundle } from "@/lib/database";
import type { Run } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function value(row: unknown[], index: number) { return row[index] ?? ""; }
function text(raw: unknown) { return String(raw ?? "").trim(); }
function numeric(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const result = Number(raw);
  return Number.isFinite(result) ? result : null;
}
function clockTime(raw: string): string { const match = raw.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i); if (!match) return ""; let hour = Number(match[1]) % 12; if (match[3].toUpperCase() === "PM") hour += 12; return `${String(hour).padStart(2, "0")}:${match[2]}`; }

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
  return { date, name, type: text(row.type) || "Run", distance, duration, avgHr: numeric(row.avgHr), maxHr: numeric(row.maxHr), garminVo2Max: numeric(row.garminVo2Max), sleep: numeric(row.sleep), rpe: numeric(row.rpe), pain: numeric(row.pain), painDuring: text(row.painDuring), painNext: text(row.painNext), effort: numeric(row.effort), weatherStart: text(row.weatherStart), weatherEnd: text(row.weatherEnd), weatherDuring: text(row.weatherDuring), weatherRoute: text(row.weatherRoute), location: text(row.location), startTime: text(row.startTime), endTime: text(row.endTime), shoes: text(row.shoes), notes: text(row.notes) };
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  const preview = form.get("preview") === "true";
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
      const newRuns = importedRuns.filter((run) => {
        const key = `${run.date}|${run.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (preview) return Response.json({ preview: true, importedRuns: newRuns.length, importedWorkouts: 0, preservedRuns: current.runs.length, preservedCompleted: current.plan.filter((w) => w.status === "completed").length });
      const { bundle: result } = await appendRunHistorySafely(newRuns);
      return Response.json({ ...result, importedRuns: newRuns.length, importedWorkouts: 0, preservedRuns: current.runs.length });
    }
    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    // Run-log imports NEVER change the planned-workout table, even if a workbook
    // includes a Training Plan worksheet alongside a Run Log worksheet.
    const runSheet = workbook.Sheets["Run Log"];
    if (!runSheet) {
      return Response.json({
        error: workbook.Sheets["18-Week Plan"] || workbook.Sheets["Training Log"] || workbook.Sheets["Training Plan"]
          ? "This workbook contains a training plan, not a run log. Import Run Log cannot change planned workouts. No records were modified."
          : "Excel imports require a Run Log worksheet. No records were modified.",
      }, { status: 400 });
    }
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
        startTime: weatherTimes ? clockTime(weatherTimes[1]) : "", endTime: weatherTimes ? clockTime(weatherTimes[2]) : "",
        weatherStart: weatherTimes && temperatures ? `${weatherTimes[1]} · ${temperatures[1]}°C` : weather,
        weatherEnd: weatherTimes && temperatures ? `${weatherTimes[2]} · ${temperatures[2]}°C` : "",
        shoes: text(value(row, 14)), notes: text(value(row, 15)),
      });
    }
    const current = await getBundle();
    const seenRuns = new Set(current.runs.map((run) => `${run.date}|${run.name}`));
    const newRuns = importedRuns.filter((run) => {
      const key = `${run.date}|${run.name}`;
      if (seenRuns.has(key)) return false;
      seenRuns.add(key);
      return true;
    });
    const details = {
      importedRuns: newRuns.length,
      importedWorkouts: 0,
      preservedRuns: current.runs.length,
      preservedCompleted: current.plan.filter((workout) => workout.status === "completed").length,
    };
    if (preview || !newRuns.length) return Response.json({ ...current, preview, ...details });
    // The plan, settings and metadata are NEVER included in an import save.
    const { bundle: result } = await appendRunHistorySafely(newRuns);
    return Response.json({ ...result, ...details });
  } catch {
    return Response.json({ error: "Could not read the workbook. Check that it is a valid run-log spreadsheet." }, { status: 400 });
  }
}
