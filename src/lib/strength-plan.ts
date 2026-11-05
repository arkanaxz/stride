import type { Workout } from "@/lib/types";

// Week-by-week Wednesday/Friday prescriptions from SM2SM_2027_Sub145_GM.xlsx,
// sheets "18-Week Plan" and "Strength A + B" (Nov 2, 2026–Mar 7, 2027).
// Stable IDs and one-time, insert-only seeding preserve all existing records.
export const STRENGTH_PLAN_SEED_KEY = "sm2sm_2027_strength_seed_v1";

const strengthA = [
  "Lateral step-down: 2 × 6–8 / leg (pain-sensitive: 1 × 6, 10 cm step). Lower 2–3 sec, keep pelvis level.",
  "Split squat: 2 × 6–8 / leg (pain-sensitive: 1 × 6 shallow). Controlled depth; add weight only after symptom-free weeks.",
  "Single-leg RDL: 2 × 8 / leg (pain-sensitive: 1 × 6 bodyweight). Hinge, keep hips level.",
  "Lateral band walk: 2 × 10 steps / side (pain-sensitive: 1 × 8, light band). No trunk sway.",
  "Calf raises: 2 × 12–15 (pain-sensitive: 1 × 10 both legs). Full controlled range.",
  "Side plank: 2 × 25–40 sec / side (pain-sensitive: 1 × 20–25 sec on knees). Don't allow the hip to sag.",
].join("\n");

const strengthB = [
  "Side-lying hip abduction: 2 × 12 / leg (pain-sensitive: 1 × 10). Do not roll the pelvis back.",
  "Bodyweight glute bridge: 2 × 12 (pain-sensitive: 1 × 10). Lower slowly with ribs down.",
  "Clamshell (light band): 1 × 12 / side (pain-sensitive: 1 × 10 without band). Keep the pelvis still.",
  "Dead bug: 2 × 8 / side (pain-sensitive: 1 × 6). Keep the lower back supported.",
  "Single-leg balance: 2 × 20–30 sec / leg (pain-sensitive: 1 × 20 sec with support). Hips level.",
].join("\n");

const weeks: ReadonlyArray<readonly [string, string]> = [
  ["STRENGTH A — LIGHT this Wed\n1 set of easy, familiar movements\nNo new load or next-day soreness\nFull prescription → Strength A",
   "STRENGTH B • 15–20 min\nSide-lying abduction, bridge, clamshell, dead bug, balance\nLight and controlled"],
  ["STRENGTH A • 20–30 min\nStart 1 set, build to 2\nSee full prescription",
   "STRENGTH B • 15–20 min\nSide-lying abduction, bridge, clamshell, dead bug, balance"],
  ["STRENGTH A • 25–35 min\n2 sets, controlled\nSee full prescription",
   "STRENGTH B • 15–20 min\nSide-lying abduction, bridge, clamshell, dead bug, balance"],
  ["A-LIGHT • 15–20 min\n1 set each; no soreness",
   "STRENGTH B • 15–20 min\nSide-lying abduction, bridge, clamshell, dead bug, balance"],
  ["STRENGTH A • 25–35 min\n2 sets, controlled",
   "STRENGTH B • 15–20 min\nSide-lying abduction, bridge, clamshell, dead bug, balance"],
  ["A-LIGHT • 15 min\nRehearsal / no DOMS",
   "REST • no strength\nProtect 5K time trial"],
  ["STRENGTH A • 25–35 min\n2 sets, controlled",
   "STRENGTH B • 15–20 min\nSide-lying abduction, bridge, clamshell, dead bug, balance"],
  ["A-LIGHT • 15–20 min\n1 set each; no soreness",
   "STRENGTH B • 15–20 min\nSide-lying abduction, bridge, clamshell, dead bug, balance"],
  ["STRENGTH A • 25–35 min\n2 sets, controlled",
   "STRENGTH B • 15–20 min\nSide-lying abduction, bridge, clamshell, dead bug, balance"],
  ["STRENGTH A • 25–35 min\n2 sets, controlled",
   "STRENGTH B • 15–20 min\nSide-lying abduction, bridge, clamshell, dead bug, balance"],
  ["STRENGTH A • 25–35 min\n2 sets, controlled",
   "STRENGTH B • 15–20 min\nSide-lying abduction, bridge, clamshell, dead bug, balance"],
  ["A-LIGHT • 15 min\nRehearsal / no DOMS",
   "REST • no strength\nProtect 10K time trial"],
  ["STRENGTH A • 20–25 min, controlled\nNo heavy loading or next-day DOMS",
   "STRENGTH B • 12–15 min, light\nActivation, glute/core; no fatigue"],
  ["A-LIGHT • 15–20 min\n1 easy set only; avoid leg soreness",
   "STRENGTH B • 10–12 min EASY\nActivation only; skip if fatigued"],
  ["STRENGTH A • 20–25 min\nControlled, no DOMS",
   "STRENGTH B • 12–15 min LOW-LOAD\nSkip if legs sore"],
  ["A-LIGHT • 15 min\n1 set, activation only; no soreness",
   "STRENGTH B • 10 min OPTIONAL\nActivation only; skip if tired"],
  ["B-LIGHT • 10–15 min\nNo heavy leg work; use gentle Strength B exercises",
   "B-LIGHT • 10 min OPTIONAL\nGentle glute activation only"],
  ["MOBILITY ONLY • 10 min\nNo loaded strength in race week",
   "REST • no strength\nFocus sleep, food and hydration"],
];

export const strengthPlanWorkouts: Workout[] = weeks.flatMap(([wednesday, friday], index) => {
  const week = index + 1;
  const toWorkout = (raw: string, day: "Wed" | "Fri", offset: number): Workout[] => {
    if (/^REST\b/i.test(raw.trim())) return [];
    const date = new Date(Date.UTC(2026, 10, 2 + index * 7 + offset)).toISOString().slice(0, 10);
    const [title, ...lines] = raw.split("\n");
    const mobility = /^MOBILITY/i.test(title);
    const useB = day === "Fri" || /^B-LIGHT/i.test(title);
    const prescription = mobility ? "Gentle mobility only. No loaded lower-body strength during race week." : useB ? strengthB : strengthA;
    return [{
      id: "sm2sm-2027-strength-" + date + "-" + day.toLowerCase(),
      week,
      phase: mobility ? "RACE WEEK • MOBILITY" : "STRENGTH • DURABILITY",
      day,
      date,
      session: title,
      target: lines.join(" · ") || (useB ? "Low-load stability" : "Controlled strength work"),
      strength: prescription,
      notes: "From updated SM2SM 2027 workbook • Week " + week + ", " + day +
        "\n\n" + raw + "\n\nFULL EXERCISE PRESCRIPTION:\n" + prescription +
        "\n\nStop or reduce if lateral-knee pain worsens, running gait changes, or symptoms increase the next morning. Friday remains low-load to protect Saturday's run.",
      status: "planned",
      dateShiftable: false,
    }];
  };
  return [...toWorkout(wednesday, "Wed", 2), ...toWorkout(friday, "Fri", 4)];
});
