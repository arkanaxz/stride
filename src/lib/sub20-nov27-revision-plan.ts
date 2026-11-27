import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { Workout } from "./types";
import { nov27RevisionCompressed, nov27RevisionSha256 } from "./sub20-nov27-revision-data";

export const NOV27_REVISION_IMPORT_KEY = "sub20_nov27_week5_revised_plan_v1";
export const NOV27_REVISION_START = "2026-11-30";
export const NOV27_REVISION_END = "2027-06-27";
export const NOV27_REVISION_TITLE = "Sub-20 5K • 34-Week Plan (Nov 27 Revision)";

type Week = {
  week: number; monday: string; phase: string; focus: string;
  days: string[]; coreKm: number; optKm: number; maxKm: number; decision: string; load: string;
};
type StrengthExercise = [string, string | number, string, string, string, string];
type Source = { weeks: Week[]; strength: { A: StrengthExercise[]; B: StrengthExercise[] } };
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function nov27RevisionSource(): Source {
  const raw = gunzipSync(Buffer.from(nov27RevisionCompressed, "base64"));
  const digest = createHash("sha256").update(raw).digest("hex");
  if (digest !== nov27RevisionSha256) throw new Error("Nov 27 workbook data checksum mismatch: nothing was imported.");
  const source = JSON.parse(raw.toString("utf8")) as Source;
  if (source.weeks.length !== 30 || source.strength.A.length !== 7 || source.strength.B.length !== 6 ||
      source.weeks.some((w, i) => w.week !== i + 5 || w.days.length !== 7 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(w.monday) ||
        !Number.isFinite(w.coreKm) || !Number.isFinite(w.optKm) || !Number.isFinite(w.maxKm))) {
    throw new Error("Nov 27 workbook structure invalid: nothing was imported.");
  }
  if (source.weeks[0].monday !== NOV27_REVISION_START ||
      source.weeks.at(-1)?.monday !== "2027-06-21") {
    throw new Error("Nov 27 workbook date range invalid: nothing was imported.");
  }
  return source;
}

function datePlusDays(monday: string, offset: number): string {
  const day = new Date(monday + "T12:00:00Z");
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

function strengthPrescription(source: Source, type: "A" | "B"): string {
  const title = type === "A" ? "STRENGTH A + CORE A · Sunday" : "STRENGTH B + CORE B · Friday";
  return title + "\n" + source.strength[type].map(([exercise, sets, reps, effort, progression, cue]) =>
    exercise + ": " + sets + " sets × " + reps + " · " + effort +
    "\nProgression: " + progression + "\nForm / stop rule: " + cue
  ).join("\n\n");
}

/**
 * Exactly the Week 5–34 schedule from the uploaded "34-Week Plan" sheet,
 * with A/B exercise details from its companion "Strength A and B" sheet.
 * REST days have no completion row. Sunday recovery running and Strength A
 * are independent trackable entries, grouped as one visible training-day row.
 */
export function nov27RevisionWorkouts(): Workout[] {
  const source = nov27RevisionSource();
  const result: Workout[] = [];
  const append = (week: Week, dayIndex: number, kind: "run" | "strength-a" | "strength-b", raw: string) => {
    const day = dayNames[dayIndex];
    const date = datePlusDays(week.monday, dayIndex);
    const type = kind === "strength-a" ? "A" : kind === "strength-b" ? "B" : null;
    const first = raw.split(/\r?\n/)[0].trim();
    const id = "sub20-nov27-w" + String(week.week).padStart(2, "0") +
      "-" + date + "-" + day.toLowerCase() + "-" + kind;
    result.push({
      id, date, day, week: week.week,
      phase: type ? week.phase + " • STRENGTH " + type : week.phase,
      session: day + ": " + (type ? "Strength " + type + " / Core " + type + " — " : "") + first,
      target: raw,
      ...(type ? { strength: strengthPrescription(source, type) } : {}),
      notes: [
        "Source: Nov 27, 2026 uploaded workbook · 34-Week Plan · Week " + week.week + " · " + day,
        "Phase: " + week.phase + "\nFocus: " + week.focus,
        "Original daily instruction:\n" + raw,
        "Monday recovery instruction:\n" + week.days[0],
        "Weekly mileage targets: core " + week.coreKm + " km; optional " +
          week.optKm + " km; maximum " + week.maxKm + " km",
        "Workbook decision: " + week.decision + "\nLoad / race decision: " + week.load,
        ...(type ? ["Strength instructions are from the attached Strength A and B sheet; follow the day's recovery conditions."] : []),
      ].join("\n\n"),
      status: "planned",
      dateShiftable: false,
    });
  };

  for (const week of source.weeks) {
    // The schedule explicitly makes Monday a recovery day.
    for (const index of [1, 2, 3, 4, 5, 6]) {
      const raw = week.days[index].trim();
      if (!raw) continue;
      if (index === 4) {
        if (/\bStrength B\b/i.test(raw) && !/^\s*(REST|NO STRENGTH)\b/i.test(raw)) {
          append(week, index, "strength-b", raw);
        }
      } else if (index === 6) {
        // The March 7 HM is an alternative to Saturday's easy run, not an extra session.
        const hasRun = /\b\d+(?:\.\d+)?\s*km\b|SM2SM HM FUN RUN/i.test(raw);
        const hasStrength = /\bStrength A\b|\bstrength\b|\bA\/core\b|\bSunday A\b/i.test(raw) &&
          !/\bdeferred\b|\bno heavy strength\b|\bno demanding strength\b|\bno strength\b/i.test(raw);
        if (hasRun) append(week, index, "run", raw);
        if (hasStrength) append(week, index, "strength-a", raw);
      } else {
        // Tuesday, Wednesday, Thursday and Saturday are training/run instructions.
        // Week 18's Saturday row explicitly describes an HM-alternative easy run.
        append(week, index, "run", raw);
      }
    }
  }
  const runs = result.filter(w => !w.strength).length;
  const a = result.filter(w => String(w.id).endsWith("-strength-a")).length;
  const b = result.filter(w => String(w.id).endsWith("-strength-b")).length;
  if (result.length !== 187 || runs !== 141 || a !== 21 || b !== 25 ||
      result.some(w => w.date < NOV27_REVISION_START || w.date > NOV27_REVISION_END) ||
      new Set(result.map(w => w.id)).size !== result.length) {
    throw new Error("Nov 27 workbook session validation failed: nothing was imported.");
  }
  return result;
}
