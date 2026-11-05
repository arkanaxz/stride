import type { Workout } from "./types";

export type PlanMergeResult = {
  plan: Workout[];
  importedCount: number;
  preservedCompleted: number;
  preservedCancelled: number;
  replacedPlanned: number;
};

// Match a revised workbook by stable ID first, then date/day or week/day.
// A completed workout is historical evidence: it must NEVER be rewritten by a plan import.
function dayOf(workout: Workout): string {
  const raw = String(workout.day || workout.session.match(/^([A-Za-z]{3,9}):/)?.[1] || "");
  return raw.trim().slice(0, 3).toLowerCase();
}

function findExisting(workouts: Workout[], imported: Workout, used: Set<number>): number {
  const available = workouts.map((workout, index) => ({ workout, index })).filter(({ index }) => !used.has(index));
  const byId = available.find(({ workout }) => workout.id != null && String(workout.id) === String(imported.id));
  if (byId) return byId.index;
  const day = dayOf(imported);
  const matches = (candidate: Workout) => day && dayOf(candidate) === day;
  const byDate = available.filter(({ workout }) => matches(workout) && workout.date === imported.date);
  const priority = (status?: string) => status === "completed" ? 0 : status === "cancelled" ? 1 : 2;
  byDate.sort((a, b) => priority(a.workout.status) - priority(b.workout.status));
  if (byDate.length) return byDate[0].index;
  const byWeekDay = available.filter(({ workout }) => matches(workout) && workout.week === imported.week);
  byWeekDay.sort((a, b) => priority(a.workout.status) - priority(b.workout.status));
  return byWeekDay[0]?.index ?? -1;
}

export function mergeRevisedPlan(existing: Workout[], revised: Workout[]): PlanMergeResult {
  const used = new Set<number>();
  const plan = revised.map((workout) => {
    const index = findExisting(existing, workout, used);
    if (index < 0) return workout;
    used.add(index);
    const previous = existing[index];
    if (previous.status === "completed") return previous;
    if (previous.status === "cancelled") return { ...workout, status: "cancelled" };
    return workout;
  });

  // A revised schedule can remove obsolete planned entries, but never history.
  // Keep completed/cancelled records even if their date or week no longer exists.
  existing.forEach((workout, index) => {
    if (used.has(index)) return;
    if (workout.status === "completed" || workout.status === "cancelled") plan.push(workout);
  });

  const sortDate = (a: Workout, b: Workout) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id));
  plan.sort(sortDate);
  return {
    plan,
    importedCount: revised.length,
    preservedCompleted: existing.filter((workout) => workout.status === "completed").length,
    preservedCancelled: existing.filter((workout) => workout.status === "cancelled").length,
    replacedPlanned: existing.filter((workout) => workout.status !== "completed" && workout.status !== "cancelled").length,
  };
}
