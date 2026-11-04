import * as XLSX from "xlsx";
import { currentUser } from "@/lib/auth";
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
  return { date, name, type: text(row.type) || "Run", distance, duration, avgHr: numeric(row.avgHr), maxHr: numeric(row.maxHr), sleep: numeric(row.sleep), pain: numeric(row.pain), painDuring: text(row.painDuring), painNext: text(row.painNext), effort: numeric(row.effort), weatherStart: text(row.weatherStart), weatherEnd: text(row.weatherEnd), weatherDuring: text(row.weatherDuring), weatherRoute: text(row.weatherRoute), location: text(row.location), startTime: text(row.startTime), endTime: text(row.endTime), shoes: text(row.shoes), notes: text(row.notes) };
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
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
    const sm2smSheet = workbook.Sheets["18-Week Plan"];
    if (sm2smSheet) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sm2smSheet, { header: 1, raw: true, defval: "" });
      const mondayValue = value(rows[6] || [], 1);
      const mondayDate = dateString(mondayValue);
      if (!mondayDate) return Response.json({ error: "The 18-Week Plan sheet is missing its first Monday date." }, { status: 400 });
      const dayColumns = [
        { day: "Mon", column: 4, offset: 0 },
        { day: "Tue", column: 5, offset: 1 },
        { day: "Thu", column: 7, offset: 3 },
        { day: "Sat", column: 9, offset: 5 },
        { day: "Sun", column: 10, offset: 6 },
      ];
      const importedPlan: Workout[] = rows.slice(6, 24).flatMap((row, weekIndex) => {
        const week = numeric(value(row, 0)) || weekIndex + 1;
        const phase = text(value(row, 2));
        const mission = text(value(row, 3));
        const progression = text(value(row, 14));
        return dayColumns.flatMap(({ day, column, offset }) => {
          const details = text(value(row, column));
          if (!details || /^(rest|strength|mobility)\b/i.test(details)) return [];
          const date = new Date(`${mondayDate}T00:00:00Z`);
          date.setUTCDate(date.getUTCDate() + weekIndex * 7 + offset);
          const workoutDate = date.toISOString().slice(0, 10);
          const headline = details.split(/\r?\n/)[0].trim();
          return [{
            id: `sm2sm-2027-gm-${workoutDate}-${day.toLowerCase()}`,
            week,
            phase,
            day,
            date: workoutDate,
            session: `${day}: ${headline}`,
            target: details,
            notes: [mission, progression].filter(Boolean).join("\n\n"),
            status: "planned",
            dateShiftable: false,
          }];
        });
      });
      if (!importedPlan.length) return Response.json({ error: "No running workouts were found on the 18-Week Plan sheet." }, { status: 400 });
      const current = await getBundle();
      const raceDate = new Date(`${mondayDate}T00:00:00Z`);
      raceDate.setUTCDate(raceDate.getUTCDate() + 17 * 7 + 6);
      const raceDateString = raceDate.toISOString().slice(0, 10);
      const result = await saveBundle({
        plan: importedPlan,
        preferences: { ...current.preferences, raceDate: raceDateString, lthr: 179 },
        meta: { ...current.meta, title: "SM2SM 2027 Half Marathon · Sub 1:45", raceDate: raceDateString, goalFinish: "1:44:59", goalPace: "4:58/km" },
      });
      return Response.json({ ...result, importedRuns: 0, importedWorkouts: importedPlan.length });
    }
    const runningEraSheet = workbook.Sheets["Training Log"];
    if (runningEraSheet) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(runningEraSheet, { header: 1, raw: true, defval: "" });
      const importedPlan: Workout[] = rows.slice(5).flatMap((row, index) => {
        const date = dateString(value(row, 2));
        const type = text(value(row, 4));
        const workoutText = text(value(row, 5));
        if (!date || !type || /^(rest|strength)/i.test(type) || !workoutText) return [];
        const week = numeric(value(row, 0)) || 0;
        const day = text(value(row, 3));
        const plannedKm = numeric(value(row, 6));
        const paceTarget = text(value(row, 7));
        const hrTarget = text(value(row, 8));
        const coaching = text(value(row, 9));
        const status = /^yes$/i.test(text(value(row, 10))) ? "completed" : "planned";
        const actualNotes = text(value(row, 16));
        return [{ id: `running-era-${date}-${week}-${day}-${index}`, week, phase: text(value(row, 1)), day, date, session: `${type}: ${workoutText}`, target: plannedKm === null ? workoutText : `${plannedKm} km · ${workoutText}`, pace: paceTarget, hr: hrTarget, notes: [coaching, actualNotes && `Logged notes: ${actualNotes}`].filter(Boolean).join("\n\n"), status, dateShiftable: false }];
      });
      if (!importedPlan.length) return Response.json({ error: "No running workouts were found on the Training Log sheet." }, { status: 400 });
      const current = await getBundle();
      const result = await saveBundle({ plan: importedPlan, preferences: { ...current.preferences, raceDate: "2027-03-07", lthr: 179 }, meta: { ...current.meta, title: "SM2SM 2027 Half Marathon · Sub 1:45", raceDate: "2027-03-07", goalFinish: "1:44:59", goalPace: "4:58/km" } });
      return Response.json({ ...result, importedRuns: 0, importedWorkouts: importedPlan.length });
    }
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
        startTime: weatherTimes ? clockTime(weatherTimes[1]) : "", endTime: weatherTimes ? clockTime(weatherTimes[2]) : "",
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
