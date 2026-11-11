import type { Workout } from "@/lib/types";
export const STRENGTH_PAGE_SIZES = [1, 5, 10, 15, 20, 100] as const;

export function strengthWeekday(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(date + "T12:00:00");
  return Number.isNaN(parsed.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(parsed);
}
export function searchStrengthWorkouts(workouts: Workout[], search: string): Workout[] {
  const q = search.trim().toLowerCase();
  if (!q) return workouts;
  return workouts.filter(workout => {
    const log = workout.strengthLog;
    const date = log?.date || workout.date;
    return [
      date, workout.date, strengthWeekday(date), workout.session, workout.phase, workout.strength,
      workout.target, workout.status, log?.name, log?.type, log?.duration, log?.avgHr,
      log?.maxHr, log?.sleep, log?.rpe, log?.painDuring, log?.painNext,
      log?.location, log?.startTime, log?.endTime, log?.weatherDuring, log?.exercises, log?.notes,
    ].some(value => String(value ?? "").toLowerCase().includes(q));
  });
}
export function paginateStrengthWorkouts(workouts: Workout[], pageSize: number, requestPage: number) {
  const limit = STRENGTH_PAGE_SIZES.some(size => size === pageSize) ? pageSize : 10;
  const pageCount = Math.max(1, Math.ceil(workouts.length / limit));
  const page = Math.min(Math.max(0, Math.trunc(requestPage) || 0), pageCount - 1);
  const start = page * limit;
  return { page, pageCount, start, end: Math.min(start + limit, workouts.length),
    total: workouts.length, rows: workouts.slice(start, start + limit) };
}
