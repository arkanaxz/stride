import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { Workout } from "@/lib/types";
import { compressedWorkbookSchedule } from "./sm2sm-workbook-data";

/** Version changes only when the user explicitly supplies a new authoritative workbook. */
export const AUTHORITATIVE_PLAN_KEY = "authoritative_sm2sm_2027_8ec0b4ad_20261105";
const EXPECTED_HASH = "8ec0b4ad2bd6a8b26a8adb108d7f6232548f8c671cab83d1242540a847e4d8af";

type Week = { p: string; m: string; r: string; d: string[] };
type WorkbookSource = { weeks: Week[]; strength: { a: string; b: string } };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function authoritativeWorkouts(): Workout[] {
  const json = gunzipSync(Buffer.from(compressedWorkbookSchedule, "base64")).toString("utf8");
  const hash = createHash("sha256").update(json).digest("hex");
  if (hash !== EXPECTED_HASH) throw new Error("SM2SM workbook integrity check failed: schedule was not changed.");
  const source = JSON.parse(json) as WorkbookSource;
  if (source.weeks.length !== 18 || source.weeks.some((week) => week.d.length !== 7)) {
    throw new Error("SM2SM workbook must contain all 18 weeks and seven day columns.");
  }

  const workouts: Workout[] = [];
  for (const [weekIndex, week] of source.weeks.entries()) {
    for (const [dayIndex, raw] of week.d.entries()) {
      const cell = raw.trim();
      if (!cell || /^(REST|NO RUN)\b/i.test(cell)) continue;
      const day = DAYS[dayIndex];
      const date = new Date(Date.UTC(2026, 10, 2 + weekIndex * 7 + dayIndex)).toISOString().slice(0, 10);
      const strength = day === "Wed" || day === "Fri";
      const headline = cell.split(/\r?\n/)[0].trim();
      const mobility = /^MOBILITY ONLY/i.test(headline);
      const strengthB = day === "Fri" || /^B-LIGHT/i.test(headline);
      const exercises = strength
        ? mobility ? "Mobility only: no loaded lower-body strength during race week."
        : strengthB ? source.strength.b : source.strength.a
        : "";
      const notes = [
        "WEEK MISSION: " + week.m,
        "READINESS RULE: " + week.r,
        exercises ? "STRENGTH PRESCRIPTION:\n" + exercises : "",
      ].filter(Boolean).join("\n\n");
      workouts.push({
        id: "sm2sm-2027-" + (strength ? "strength" : "gm") + "-" + date + "-" + day.toLowerCase(),
        week: weekIndex + 1,
        phase: strength ? "STRENGTH / MOBILITY" : week.p,
        day,
        date,
        session: day + ": " + headline,
        target: cell,
        ...(strength ? { strength: exercises } : {}),
        notes,
        status: "planned",
        dateShiftable: false,
      });
    }
  }

  const runs = workouts.filter((item) => !item.strength).length;
  const strengthSessions = workouts.length - runs;
  if (workouts.length !== 115 || runs !== 82 || strengthSessions !== 33) {
    throw new Error("SM2SM workbook session counts did not match 82 running + 33 strength/mobility.");
  }
  if (new Set(workouts.map((item) => String(item.id))).size !== workouts.length) {
    throw new Error("SM2SM workbook contains duplicate workout IDs.");
  }
  return workouts;
}
