import type { Workout } from "./types";

/**
 * One training-day row can contain both the run and the Strength A prescription.
 * Keep both underlying workout records: running mileage is logged through the
 * run, while the strength log has its own fields and must never add mileage.
 * Only collapse the exact imported Wednesday pair (original plan) or Sunday
 * pair (Nov 27 revision), never arbitrary same-day sessions or changed plans.
 */
export type TrainingBlockRow = { workout: Workout; linkedRun: Workout | null };

export function groupCombinedStrengthDays(plan: Workout[]): TrainingBlockRow[] {
  const byId = new Map(plan.map(workout => [String(workout.id ?? ""), workout]));
  const combined = new Map<Workout, Workout>();
  const hiddenRunRows = new Set<Workout>();

  for (const strength of plan) {
    const id = String(strength.id ?? "");
    const originalWednesday = id.startsWith("sub20-34w-") && strength.day === "Wed";
    const revisedSunday = id.startsWith("sub20-nov27-w") && strength.day === "Sun";
    if (!strength.strength || !(originalWednesday || revisedSunday) || !id.endsWith("-strength-a")) continue;
    const run = byId.get(id.slice(0, -"-strength-a".length) + "-run");
    if (!run || run.strength || run.date !== strength.date || run.week !== strength.week ||
        run.day !== strength.day || !run.target) continue;
    if (originalWednesday && !strength.target?.startsWith(run.target)) continue;
    if (revisedSunday && strength.target !== run.target) continue;
    combined.set(strength, run);
    hiddenRunRows.add(run);
  }

  return plan.filter(workout => !hiddenRunRows.has(workout))
    .map(workout => ({ workout, linkedRun: combined.get(workout) || null }));
}
