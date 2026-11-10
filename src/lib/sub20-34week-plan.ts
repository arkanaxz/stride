import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { Workout } from "@/lib/types";
import { sub20ScheduleCompressed, sub20ScheduleSha256 } from "./sub20-34week-data";

export const SUB20_34W_IMPORT_KEY = "sub20_34week_20261110_preserve_history_v1";
export const SUB20_34W_BACKUP_KEY = "before_sub20_34week_20261110_v1";
export const SUB20_34W_PRESERVE_THROUGH = "2026-11-10";
export const SUB20_34W_TITLE = "Sub-20 5K • 34-Week Progressive Plan";

type Week = { week: number; monday: string; phase: string; focus: string; days: string[] };
type StrengthRow = [string, string, string, string, string, string];
type Source = { weeks: Week[]; strength: { A: StrengthRow[]; B: StrengthRow[]; rules: [string, string][] } };
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function sub20Source(): Source {
  const unzipped = gunzipSync(Buffer.from(sub20ScheduleCompressed, "base64"));
  const hash = createHash("sha256").update(unzipped).digest("hex");
  if (hash !== sub20ScheduleSha256) throw new Error("34-week plan input checksum mismatch: no data was imported.");
  const data = JSON.parse(unzipped.toString("utf8")) as Source;
  if (data.weeks.length !== 33 || data.weeks.some((w, i) =>
    w.week !== i + 2 || w.days.length !== 7 || !/^\d{4}-\d{2}-\d{2}$/.test(w.monday)
  ) || data.strength.A.length !== 6 || data.strength.B.length !== 5 || data.strength.rules.length !== 7) {
    throw new Error("34-week plan structure invalid: no data was imported.");
  }
  return data;
}

function datePlusDays(monday: string, offset: number): string {
  const d = new Date(monday + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function strengthPrescription(source: Source, kind: "A" | "B", week: number): string {
  if (kind === "A" && week === 2) {
    return [
      "WEEK 2 MODIFIED STRENGTH A · 20–25 min",
      "Hip/glute bridge, hip abduction, single-leg balance, calf raises.",
      "Do NOT perform lateral step-down or split squat this week.",
      source.strength.rules[0][1],
      "Use only comfortable, familiar resistance; avoid pain and next-day soreness.",
    ].join("\n");
  }
  return source.strength[kind].map(row =>
    row[0] + ": " + row[1] + " sets × " + row[2] + " · " + row[3] +
    "\nProgression: " + row[4] + "\nForm / stop rule: " + row[5]
  ).join("\n\n");
}

function applicableStrengthRules(source: Source, week: number): string {
  const rules = source.strength.rules;
  const selected = [
    ...(week >= 3 && week <= 6 ? [rules[1]] : []),
    rules[2],
    ...(week === 2 ? [rules[0]] : []),
    ...(week === 6 || week === 12 || week === 23 || week === 30 ? [rules[3]] : []),
    ...(week === 18 || week === 34 ? [rules[4]] : []),
    rules[5],
    rules[6],
  ];
  return selected.map(([label, note]) => label + ": " + note).join("\n");
}

export function sub20Workouts(): Workout[] {
  const input = sub20Source();
  const result: Workout[] = [];
  const append = (week: Week, dayIndex: number, date: string, kind: "run" | "strength-a" | "strength-b", raw: string) => {
    const day = dayNames[dayIndex];
    const isStrength = kind !== "run";
    const strengthKind = kind === "strength-a" ? "A" : "B";
    const first = raw.split(/\r?\n/)[0].trim();
    const id = "sub20-34w-w" + String(week.week).padStart(2, "0") + "-" + date + "-" + day.toLowerCase() + "-" + kind;
    const note = [
      "Imported from workbook: 34-Week Plan, Week " + week.week + ", " + day,
      "Phase: " + week.phase + "\nFocus: " + week.focus,
      "Original daily instruction:\n" + raw,
      ...(isStrength ? ["Strength A and B sheet rules:\n" + applicableStrengthRules(input, week.week)] : []),
    ].join("\n\n");
    result.push({
      id, week: week.week, phase: isStrength ? week.phase + " • STRENGTH " + strengthKind : week.phase,
      day, date, session: day + ": " + (isStrength ? "Strength " + strengthKind + " — " : "") + first,
      target: raw,
      ...(isStrength ? { strength: strengthPrescription(input, strengthKind, week.week) } : {}),
      notes: note,
      status: "planned",
      dateShiftable: false,
    });
  };

  for (const week of input.weeks) {
    for (const [index, dayText] of week.days.entries()) {
      const date = datePlusDays(week.monday, index);
      if (date <= SUB20_34W_PRESERVE_THROUGH || index === 0) continue;
      const raw = dayText.trim();
      if (!raw) continue;
      if (index === 2) {
        if (!/^NO RUN\b/i.test(raw)) {
          const runOnly = raw.split(/\nThen STRENGTH A/i)[0].trim();
          append(week, index, date, "run", runOnly);
        }
        if (/STRENGTH A/i.test(raw)) append(week, index, date, "strength-a", raw);
      } else if (index === 4) {
        if (/STRENGTH B/i.test(raw)) append(week, index, date, "strength-b", raw);
      } else if (!/^(REST\b|NO RUN\b|NO EXTRA RUN\b|SATURDAY:\s*REST\b)/i.test(raw)) {
        append(week, index, date, "run", raw);
      }
    }
  }
  const runs = result.filter(w => !w.strength).length;
  const a = result.filter(w => w.id?.toString().endsWith("-strength-a")).length;
  const b = result.filter(w => w.id?.toString().endsWith("-strength-b")).length;
  if (result.length !== 219 || runs !== 153 || a !== 33 || b !== 33) {
    throw new Error("34-week plan session count mismatched (expected 153 runs + 33 A + 33 B).");
  }
  if (new Set(result.map(w => w.id)).size !== result.length ||
      result.some(w => w.date <= SUB20_34W_PRESERVE_THROUGH)) {
    throw new Error("Duplicate IDs or protected dates detected in imported plan.");
  }
  return result;
}
