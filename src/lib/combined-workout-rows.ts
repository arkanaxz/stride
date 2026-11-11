import type { Workout } from "./types";

/**
 * One training-day row can contain both the run and the Strength A prescription.
 * Keep both underlying workout records: running mileage is logged through the
 * run, while the strength log has its own fields and must never add mileage.
 * Only collapse the exact imported Wednesday pair, never arbitrary same-day
 * sessions or manually changed prescriptions.
 */
export type TrainingBlockRow = { workout: Workout; linkedRun: Workout | null };

export function groupCombinedStrengthDays(plan: Workout[]): TrainingBlockRow[] {
  const byId = new Map(plan.map(workout => [String(workout.id ?? ""), workout]));
  const combined = new Map<Workout, Workout>();
  const hiddenRunRows = new Set<Workout>();

  for (const strength of plan) {
    const id = String(strength.id ?? "");
    if (!strength.strength || !id.startsWith("sub20-34w-") || !id.endsWith("-strength-a")) continue;
    const run = byId.get(id.slice(0, -"-strength-a".length) + "-run");
    if (!run || run.strength || run.date !== strength.date || run.week !== strength.week ||
        !run.target || !strength.target?.startsWith(run.target)) continue;
    combined.set(strength, run);
    hiddenRunRows.add(run);
  }

  return plan.filter(workout => !hiddenRunRows.has(workout))
    .map(workout => ({ workout, linkedRun: combined.get(workout) || null }));
}
