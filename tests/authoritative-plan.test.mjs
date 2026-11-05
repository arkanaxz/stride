import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const sourceCode = readFileSync("src/lib/sm2sm-workbook-data.ts", "utf8");
const encodedMatch = sourceCode.match(/compressedWorkbookSchedule\s*=\s*("(?:[^"\\]|\\.)*")/);
if (!encodedMatch) throw new Error("Authoritative workbook data missing");
const encoded = JSON.parse(encodedMatch[1]);
const bytes = gunzipSync(Buffer.from(encoded, "base64"));
const checksum = createHash("sha256").update(bytes).digest("hex");
const payload = JSON.parse(bytes.toString("utf8"));
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

test("exact, verifiable latest workbook source", () => {
  assert.equal(checksum, "8ec0b4ad2bd6a8b26a8adb108d7f6232548f8c671cab83d1242540a847e4d8af");
  assert.equal(payload.weeks.length, 18);
  assert.equal(payload.weeks.every((w) => w.d.length === 7), true);
  assert.match(payload.strength.a, /Lateral step-down/);
  assert.match(payload.strength.b, /Dead bug/);
});

test("115 workouts: 82 runs including Monday optional runs; 33 strength/mobility", () => {
  const counts = Object.fromEntries(DAYS.map(day => [day, 0]));
  for (const week of payload.weeks) {
    week.d.forEach((cell, index) => {
      if (cell.trim() && !/^(REST|NO RUN)\b/i.test(cell.trim())) counts[DAYS[index]]++;
    });
  }
  assert.deepEqual(counts, {Mon:11,Tue:18,Wed:18,Thu:18,Fri:15,Sat:17,Sun:18});
  const running = counts.Mon + counts.Tue + counts.Thu + counts.Sat + counts.Sun;
  assert.equal(running, 82);
  assert.equal(counts.Wed + counts.Fri, 33);
  assert.equal(running + counts.Wed + counts.Fri, 115);
});

test("the November 2–March 7 schedule and 5K/10K TT reductions are intact", () => {
  assert.match(payload.weeks[0].d[1], /6 km EASY/);
  assert.match(payload.weeks[5].d[5], /5K TT/);
  assert.match(payload.weeks[11].d[5], /10K TT/);
  assert.match(payload.weeks[17].d[6], /SM2SM HALF MARATHON/);
  assert.match(payload.weeks[17].d[2], /MOBILITY ONLY/);
  assert.match(payload.weeks[17].d[4], /REST/);
});

test("one-time migration backups the previous plan and never deletes runs", () => {
  const db = readFileSync("src/lib/database.ts", "utf8");
  const start = db.indexOf("export async function ensureAuthoritativeWorkbookPlan");
  const end = db.indexOf("export async function getBundle", start);
  assert.ok(start > 0 && end > start);
  const migration = db.slice(start, end);
  assert.match(migration, /workout_plan_backups/);
  assert.match(migration, /DELETE FROM workouts/);
  assert.doesNotMatch(migration, /DELETE FROM runs/);
  assert.match(migration, /AUTHORITATIVE_PLAN_KEY/);
  assert.match(migration, /preserveMatchedStatus/);
  const api = readFileSync("src/app/api/data/route.ts", "utf8");
  assert.match(api, /await ensureAuthoritativeWorkbookPlan\(\)/);
  assert.doesNotMatch(api, /await ensureStrengthPlan\(\)/);
});
