import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const libsql = process.env.SMOKE_LIBSQL === "1";
const port = libsql ? 4782 : 4781;
const root = "http://127.0.0.1:" + port;
const dir = join(tmpdir(), "stride-34week-test-" + randomUUID());
mkdirSync(dir, { recursive: true });
const dbfile = join(dir, "stride.sqlite");
const db = new DatabaseSync(dbfile);
db.exec("CREATE TABLE runs(id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)");
db.exec("CREATE TABLE workouts(id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
db.exec("CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
db.exec("CREATE TABLE secrets(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
db.exec("CREATE TABLE run_comments(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
const previousWorkouts = [
  { id:"prev-nov03",week:1,date:"2026-11-03",day:"Tue",session:"Week1 actual",status:"completed" },
  { id:"prev-today",week:2,date:"2026-11-10",day:"Tue",session:"Today's run must remain exactly as is",status:"planned",target:"Original Nov10 running prescription" },
  { id:"prev-future-planned",week:2,date:"2026-11-11",day:"Wed",session:"Old future prescription",status:"planned" },
  { id:"prev-future-cancelled",week:3,date:"2026-11-17",day:"Tue",session:"Old cancelled session",status:"cancelled" },
  { id:"prev-future-completed",week:3,date:"2026-11-18",day:"Wed",session:"Existing completed session",status:"completed" },
];
for (const workout of previousWorkouts) db.prepare("INSERT INTO workouts(id,payload) VALUES (?,?)").run(workout.id,JSON.stringify(workout));
const originalRun={date:"2026-11-03",name:"Preserved real run",type:"Easy",distance:6.12,duration:45.3,garminVo2Max:47.2,notes:"KEEP THIS!"};
db.prepare("INSERT INTO runs(payload) VALUES (?)").run(JSON.stringify(originalRun));
db.prepare("INSERT INTO run_comments(run_id,username,text) VALUES (?,?,?)").run(1,"smoke_admin","Original run review");
db.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("defaultLocation",JSON.stringify("Lapu-Lapu City, Cebu, Philippines"));
db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run("title",JSON.stringify("Old SM2SM plan"));
// The separate legacy Garmin recovery routine has already run in a real existing installation.
// Disable it only in this fixture so the migration can be tested in isolation.
db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run("verified_garmin_four_runs_20261105_v1",JSON.stringify("previously completed"));
db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run("shoeMileageBase",JSON.stringify("{\"Superblast 2\":900}"));
db.prepare("INSERT INTO secrets(key,value) VALUES (?,?)").run("api-key:openai","ENCRYPTED_TEST_VALUE");
db.close();

const env = { ...process.env, STRIDE_DB_PATH:dbfile, STRIDE_USERNAME:"smoke_admin",
  STRIDE_PASSWORD:"smoke-not-real-password",
  STRIDE_SESSION_SECRET:"test-only-" + randomUUID(), PORT:String(port) };
delete env.TURSO_DATABASE_URL;
delete env.TURSO_AUTH_TOKEN;
delete env.stride_TURSO_DATABASE_URL;
delete env.stride_TURSO_AUTH_TOKEN;
if(libsql){ env.TURSO_DATABASE_URL = "file:" + dbfile; env.TURSO_AUTH_TOKEN="test-only"; }
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{env,stdio:"ignore"});
async function ready() {
  for(let i=0;i<80;i++){
    if(server.exitCode !== null) throw new Error("Test server exited: "+server.exitCode);
    try {if((await fetch(root+"/login",{signal:AbortSignal.timeout(1200)})).status===200)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error("Test server did not start");
}
async function json(url,init={}){const response=await fetch(root+url,init);return {status:response.status,data:await response.json()};}
try {
  await ready();
  assert.ok([401,403].includes((await json("/api/backup/34week")).status),"Backup must reject unauthenticated requests");
  const login=await fetch(root+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({username:env.STRIDE_USERNAME,password:env.STRIDE_PASSWORD})});
  assert.equal(login.status,200,"Authenticated admin login");
  const cookie=login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const headers={cookie,"content-type":"application/json"};
  const first=await json("/api/data",{headers});
  assert.equal(first.status,200,JSON.stringify(first.data).slice(0,800));
  assert.equal(first.data.runs.length,1,"Historical runs preserved");
  assert.deepEqual(first.data.runs[0].notes,originalRun.notes);
  assert.equal(first.data.comments.length,1,"Comments preserved");
  assert.equal(first.data.preferences.defaultLocation,"Lapu-Lapu City, Cebu, Philippines");
  assert.equal(first.data.meta.title,"Sub-20 5K • 34-Week Progressive Plan");
  assert.ok(first.data.meta.sub20_34week_20261110_preserve_history_v1,"One-time import marker exists");

  const byId=new Map(first.data.plan.map(w=>[w.id,w]));
  for(const item of previousWorkouts) assert.ok(byId.has(item.id),"Existing ID still present "+item.id);
  assert.deepEqual(byId.get("prev-today"),previousWorkouts[1],"Protected Nov10 is byte-for-byte unchanged");
  assert.deepEqual(byId.get("prev-nov03"),previousWorkouts[0],"Earlier completed record unchanged");
  assert.deepEqual(byId.get("prev-future-completed"),previousWorkouts[4],"Completed future record unchanged");
  assert.equal(byId.get("prev-future-planned").status,"superseded");
  assert.equal(byId.get("prev-future-planned").previousStatus,"planned");
  assert.equal(byId.get("prev-future-cancelled").status,"superseded");
  const imported=first.data.plan.filter(w=>String(w.id).startsWith("sub20-34w-w"));
  assert.equal(imported.length,219);
  assert.equal(imported.filter(w=>w.strength).length,66);
  assert.equal(imported.filter(w=>!w.strength).length,153);
  assert.equal(imported.filter(w=>w.date==="2026-11-10").length,0);
  assert.ok(imported.some(w=>w.date==="2027-06-26"));
  assert.equal(imported.filter(w=>w.date==="2026-11-11").length,1);

  const response=await fetch(root+"/api/backup/34week",{headers:{cookie}});
  assert.equal(response.status,200);
  assert.match(response.headers.get("content-disposition")||"",/attachment/);
  const snapshot=await response.json();
  assert.equal(snapshot.snapshotKey,"before_sub20_34week_20261110_v1");
  assert.equal(snapshot.containsSensitiveCredentials,true);
  assert.equal(snapshot.tables.runs.length,1);
  assert.equal(snapshot.tables.workouts.length,5);
  assert.equal(snapshot.tables.secrets.length,1);
  assert.equal(snapshot.tables.settings.length,1);
  assert.equal(snapshot.tables.run_comments.length,1);
  const savedOld=snapshot.tables.workouts.map(x=>JSON.parse(x.payload));
  assert.ok(savedOld.some(x=>x.id==="prev-future-planned" && x.status==="planned"),"Backup captures original status BEFORE mutation");
  assert.equal(JSON.parse(snapshot.tables.metadata.find(x=>x.key==="title").value),"Old SM2SM plan");
  assert.equal(snapshot.tables.secrets[0].value,"ENCRYPTED_TEST_VALUE");

  // Backup management: only the administrator can inspect or change checkpoints.
  assert.ok([401,403].includes((await json("/api/backups")).status));
  assert.ok([401,403].includes((await json("/api/backups/restore-plan",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({key:"before_sub20_34week_20261110_v1",confirm:"RESTORE PLAN"}),
  })).status));
  const list=await json("/api/backups",{headers});
  assert.equal(list.status,200,JSON.stringify(list.data));
  assert.ok(list.data.points.some(item=>item.id==="before_sub20_34week_20261110_v1"));
  assert.ok(!JSON.stringify(list.data).includes("ENCRYPTED_TEST_VALUE"),"Listing excludes secret values");
  const manual=await json("/api/backups",{method:"POST",headers});
  assert.equal(manual.status,200,JSON.stringify(manual.data));
  const newId=manual.data.backup.id;
  assert.match(newId,/^stride_recovery_[0-9a-f-]{36}$/);
  assert.ok(manual.data.backup.workouts>=first.data.plan.length);
  const external=await fetch(root+"/api/backups/"+newId,{headers});
  assert.equal(external.status,200);
  assert.match(external.headers.get("content-disposition")||"",/attachment/);
  const downloaded=await external.json();
  assert.equal(downloaded.snapshotKey,newId);
  assert.ok(downloaded.tables.runs.length>=1);
  assert.equal(downloaded.tables.secrets[0].value,"ENCRYPTED_TEST_VALUE");

  const invalid=await json("/api/backups/restore-plan",{method:"POST",headers,
    body:JSON.stringify({key:"before_sub20_34week_20261110_v1",confirm:"NO"})});
  assert.equal(invalid.status,400,"No plan changes without exact confirmation");
  const restore=await json("/api/backups/restore-plan",{method:"POST",headers,
    body:JSON.stringify({key:"before_sub20_34week_20261110_v1",confirm:"RESTORE PLAN"})});
  assert.equal(restore.status,200,JSON.stringify(restore.data));
  assert.match(restore.data.beforeRestoreKey,/^stride_recovery_[0-9a-f-]{36}$/);
  const recovered=await json("/api/data",{headers});
  assert.equal(recovered.status,200);
  assert.equal(recovered.data.runs.length,1,"Restore does not delete or add runs");
  assert.equal(recovered.data.runs[0].notes,originalRun.notes,"Run history untouched");
  assert.equal(recovered.data.plan.find(w=>w.id==="prev-today").target,previousWorkouts[1].target,"Today unchanged");
  assert.equal(recovered.data.plan.find(w=>w.id==="prev-nov03").status,"completed","Past completed unchanged");
  assert.equal(recovered.data.plan.find(w=>w.id==="prev-future-completed").status,"completed","Completed future unchanged");
  assert.equal(recovered.data.plan.find(w=>w.id==="prev-future-planned").status,"planned","Older prescription recovered");
  assert.equal(recovered.data.plan.find(w=>w.id==="prev-future-cancelled").status,"cancelled","Previously cancelled restored");
  assert.equal(recovered.data.meta.title,"Old SM2SM plan","Title restored to selected snapshot");
  const latest=await json("/api/backups",{headers});
  assert.ok(latest.data.points.some(item=>item.id===restore.data.beforeRestoreKey && item.kind==="before-restore"));
  assert.ok(latest.data.points.some(item=>item.id===newId));
  assert.ok(latest.data.points.some(item=>item.id==="before_sub20_34week_20261110_v1"));

  const second=await json("/api/data",{headers});
  assert.equal(second.status,200);
  assert.equal(second.data.plan.length,first.data.plan.length,"Idempotent: no duplicate records");
  assert.equal(second.data.runs.length,1);
  const stale=await json("/api/data",{method:"PUT",headers,body:JSON.stringify({plan:previousWorkouts})});
  assert.equal(stale.status,409,"Old browser tab cannot overwrite the imported plan");
  console.log("PASS backup list, create, private download, confirmed non-destructive restore, pre-restore checkpoint, idempotence and stale-tab protection",libsql?"libsql":"sqlite");
} finally {
  server.kill("SIGTERM");
  rmSync(dir,{recursive:true,force:true});
}
