import type { Run } from "@/lib/types";

export type Vo2Range = "all" | "week" | "month" | "year";
export type Vo2Point = { date: string; value: number };
export type Vo2Bounds = { start: string; endExclusive: string };

export function localDateKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function vo2Points(runs: Run[]): Vo2Point[] {
  // Keep the last recorded Garmin estimate per calendar day.
  const byDate = new Map<string, number>();
  const ordered = [...runs].sort((a, b) => a.date.localeCompare(b.date) || Number(a.id || 0) - Number(b.id || 0));
  for (const run of ordered) {
    const value = Number(run.garminVo2Max);
    if (run.garminVo2Max == null || !Number.isFinite(value) || value < 10 || value > 100) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(run.date)) continue;
    byDate.set(run.date, value);
  }
  return [...byDate].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

export function vo2RangeBounds(mode: Vo2Range, shift: number, todayKey: string): Vo2Bounds {
  const today = new Date(todayKey + "T12:00:00");
  let start: Date;
  let end: Date;
  if (mode === "all") {
    end = new Date(today);
    end.setDate(end.getDate() + 1);
    return { start: "", endExclusive: localDateKey(end) };
  }
  if (mode === "week") {
    start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7) + shift * 7);
    end = new Date(start);
    end.setDate(end.getDate() + 7);
  } else if (mode === "month") {
    start = new Date(today.getFullYear(), today.getMonth() + shift, 1, 12);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1, 12);
  } else {
    start = new Date(today.getFullYear() + shift, 0, 1, 12);
    end = new Date(start.getFullYear() + 1, 0, 1, 12);
  }
  return { start: localDateKey(start), endExclusive: localDateKey(end) };
}

export function selectVo2Points(points: Vo2Point[], mode: Vo2Range, shift: number, todayKey: string): Vo2Point[] {
  const { start, endExclusive } = vo2RangeBounds(mode, shift, todayKey);
  // Do not plot entries dated after today, even if a future run was planned.
  return points.filter(point => point.date >= start && point.date < endExclusive && point.date <= todayKey);
}
