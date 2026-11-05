import type { Run } from "@/lib/types";

/** "Superlast 2" was a typo in the running log for "Superblast 2". */
export function canonicalShoe(raw: string | undefined | null): string {
  const name = String(raw || "").trim() || "Unspecified";
  return /^super(?:blast|last)\s*2$/i.test(name) ? "Superblast 2" : name;
}

export function summarizeShoeMileage(runs: Run[], starting: Record<string, number> = {}) {
  const totals = new Map<string, number>();
  for (const [raw, amount] of Object.entries(starting)) {
    const name = canonicalShoe(raw);
    totals.set(name, (totals.get(name) || 0) + Math.max(0, Number(amount) || 0));
  }
  for (const run of runs) {
    const name = canonicalShoe(run.shoes);
    totals.set(name, (totals.get(name) || 0) + Math.max(0, Number(run.distance) || 0));
  }
  return [...totals.entries()].map(([name, km]) => ({ name, km }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function canonicalMileageBase(starting: Record<string, number> = {}): Record<string, number> {
  const output: Record<string, number> = {};
  for (const [raw, amount] of Object.entries(starting)) {
    const name = canonicalShoe(raw);
    output[name] = (output[name] || 0) + Math.max(0, Number(amount) || 0);
  }
  return output;
}
