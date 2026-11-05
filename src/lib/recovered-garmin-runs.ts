import type { Run } from "@/lib/types";

/**
 * Verified summary values from Garmin activity exports previously analyzed
 * for the user in ChatGPT on November 4, 2026.
 *
 * The original Stride run payloads were lost. These summaries intentionally
 * do not invent start/end times, sleep, shoes, weather, Strava Relative
 * Effort, RPE or AI reviews that are not preserved in those analyses.
 */
export const VERIFIED_GARMIN_RECOVERY_KEY = "verified_garmin_four_runs_20261105_v1";

const sharedNote = "Recovered from Garmin workout data previously analyzed in ChatGPT, after four Stride entries disappeared. The original manually entered Stride record could not be recovered. Verified: date, distance, duration, average and maximum heart rate. Missing: original run title, shoe, sleep, weather, RPE, Strava Relative Effort, and original AI review. Please treat unspecified fields as unknown, not zero.";

export const verifiedGarminRunSummaries: Run[] = [
  {
    date: "2026-10-29",
    name: "Intervals · 5 × 1 km (recovered)",
    type: "Intervals",
    distance: 7.33,
    duration: 44 + 38 / 60,
    avgHr: 166,
    maxHr: 189,
    recoveryStatus: "summary-only",
    notes: sharedNote + "\n\nWorkout context: five 1-km repetitions, approximately 4:46–4:58/km in the repetitions (previous Garmin analysis).",
  },
  {
    date: "2026-10-30",
    name: "Easy run (recovered)",
    type: "Easy",
    distance: 5.04,
    duration: 36 + 6 / 60,
    avgHr: 146,
    maxHr: 153,
    recoveryStatus: "summary-only",
    notes: sharedNote,
  },
  {
    date: "2026-11-03",
    name: "Easy run (recovered)",
    type: "Easy",
    distance: 6.12,
    duration: 45 + 9 / 60,
    avgHr: 137,
    maxHr: 149,
    recoveryStatus: "summary-only",
    notes: sharedNote,
  },
  {
    date: "2026-11-04",
    name: "Tempo · 5 × 3 min (recovered)",
    type: "Tempo",
    distance: 7.83,
    duration: 53 + 23 / 60,
    avgHr: 152,
    maxHr: 178,
    painDuring: "0.1",
    recoveryStatus: "summary-only",
    notes: sharedNote + "\n\nWorkout context: five 3-minute repetitions at 5:16, 5:12, 5:09, 5:08 and 5:08/km, with about 2 minutes recovery each. The runner reported negligible ITB pain (~0.1/10) and feeling good throughout.",
  },
];
