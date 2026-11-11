import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const libsql=process.env.SMOKE_LIBSQL==="1";
const port=libsql?4852:4851;
const base="http://127.0.0.1:"+port;
const dir=join(tmpdir(),"stride-strength-smoke-"+randomUUID());
mkdirSync(dir,{recursive:true});
const path=join(dir,"isolated.sqlite");
const db=new DatabaseSync(path);
db.exec("CREATE TABLE runs(id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL)");
db.exec("CREATE TABLE workouts(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
db.exec("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
const originalRun={date:"2026-11-10",name:"Preserve this running record",distance:8,duration:51.5,type:"Easy",shoes:"Superblast 2"};
db.prepare("INSERT INTO runs(payload) VALUES (?)").run(JSON.stringify(originalRun));
const records=[
  {id:"strength-nov11",week:2,date:"2026-11-11",session:"Wed: Strength A",status:"completed",strength:"Glute bridge, hip abduction; 20–25 min"},
  {id:"strength-nov13",week:2,date:"2026-11-13",session:"Fri: Strength B",status:"planned",strength:"Calf raises, core"},
  {id:"run-nov12",week:2,date:"2026-11-12",session:"Thu: Tempo run",status:"planned"},
  {id:"strength-cancelled",week:3,date:"2026-11-18",session:"Strength A cancelled",status:"cancelled",strength:"Easy movement"}
];
for (const row of records)db.prepare("INSERT INTO workouts(id,payload) VALUES (?,?)").run(row.id,JSON.stringify(row));
db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run("sub20_34week_20261110_preserve_history_v1",JSON.stringify("already imported"));
db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run("verified_garmin_four_runs_20261105_v1",JSON.stringify("previously recovered"));
db.close();

const env={...process.env,STRIDE_DB_PATH:path,STRIDE_USERNAME:"strength_admin",STRIDE_PASSWORD:"local-test-password-123!",
  STRIDE_SESSION_SECRET:"local-strength-test-secret-"+randomUUID(),PORT:String(port)};
for(const key of ["TURSO_DATABASE_URL","TURSO_AUTH_TOKEN","stride_TURSO_DATABASE_URL","stride_TURSO_AUTH_TOKEN"])delete env[key];
if(libsql){env.TURSO_DATABASE_URL="file:"+path;env.TURSO_AUTH_TOKEN="local-only-test";}
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{env,stdio:"ignore"});
async function ready(){
  for(let n=0;n<80;n++){
    if(server.exitCode!==null)throw new Error("Server exited "+server.exitCode);
    try {if((await fetch(base+"/login",{signal:AbortSignal.timeout(1200)})).status===200)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  throw new Error("Test server did not become ready");
}
async function call(url,init={}){
  const response=await fetch(base+url,init);
  const text=await response.text();
  let body;
  try{body=JSON.parse(text);}catch{throw new Error(url+" response "+response.status+": "+text.slice(0,350));}
  return {status:response.status,body};
}
try {
  await ready();
  const unauth=await call("/api/strength-log",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({workoutId:"strength-nov11"})});
  assert.ok([401,403].includes(unauth.status),"Unauthenticated writes must be blocked");
  const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({username:env.STRIDE_USERNAME,password:env.STRIDE_PASSWORD})});
  assert.equal(login.status,200,"admin login");
  const cookie=login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const headers={cookie,"content-type":"application/json"};
  const before=await call("/api/data",{headers});
  assert.equal(before.status,200,JSON.stringify(before.body).slice(0,900));
  assert.equal(before.body.runs.length,1);
  assert.equal(before.body.plan.find(x=>x.id==="strength-nov11").status,"completed");
  assert.equal(before.body.plan.find(x=>x.id==="strength-nov11").strengthLog,undefined);

  const log={date:"2026-11-11",name:"Strength A — Wednesday",type:"Strength A",duration:27.5,
    avgHr:112,maxHr:137,sleep:6.5,rpe:4,painDuring:"0",painNext:"0",
    location:"Lapu-Lapu City, Cebu, Philippines",startTime:"07:00",endTime:"07:28",
    weatherDuring:"Warm gym",exercises:"2x15 glute bridges; 3x10 hip abduction",notes:"No ITB pain",
    distance:999,shoes:"SHOULD_NOT_COPY",garminVo2Max:60,effort:99,weatherStart:"99C"};
  const save=async(id,details)=>call("/api/strength-log",{method:"POST",headers,body:JSON.stringify({workoutId:id,log:details})});
  const first=await save("strength-nov11",log);
  assert.equal(first.status,200,JSON.stringify(first.body).slice(0,700));
  assert.equal(first.body.runs.length,1,"Strength does NOT add Run History records");
  assert.equal(first.body.runs[0].distance,8,"Mileage stays exactly 8 km");
  assert.equal(first.body.runs[0].name,originalRun.name);
  const saved=first.body.plan.find(x=>x.id==="strength-nov11");
  assert.equal(saved.status,"completed");
  assert.equal(saved.strengthLog.duration,27.5);
  assert.equal(saved.strengthLog.rpe,4);
  assert.equal(saved.strengthLog.exercises,log.exercises);
  for(const field of ["distance","shoes","garminVo2Max","effort","weatherStart","weatherEnd"])assert.equal(saved.strengthLog[field],undefined,"no running-specific field: "+field);
  assert.equal(first.body.plan.length,records.length,"Never delete planned workouts");

  const edited={...log,duration:32,rpe:5,notes:"Updated strength notes"};
  const second=await save("strength-nov11",edited);
  assert.equal(second.status,200,JSON.stringify(second.body).slice(0,700));
  assert.equal(second.body.runs.length,1);
  assert.equal(second.body.plan.filter(x=>x.id==="strength-nov11").length,1);
  assert.equal(second.body.plan.find(x=>x.id==="strength-nov11").strengthLog.notes,"Updated strength notes");

  const planned=await save("strength-nov13",{...log,date:"2026-11-13"});
  assert.equal(planned.status,200,JSON.stringify(planned.body).slice(0,700));
  assert.equal(planned.body.plan.find(x=>x.id==="strength-nov13").status,"completed");
  assert.equal(planned.body.runs.length,1);

  const notStrength=await save("run-nov12",{...log,date:"2026-11-12"});
  assert.equal(notStrength.status,409,"Cannot write strength into a run workout");
  const cancelled=await save("strength-cancelled",{...log,date:"2026-11-18"});
  assert.equal(cancelled.status,409,"Cannot override a cancelled workout");
  const invalid=await save("strength-nov11",{...log,duration:0});
  assert.equal(invalid.status,409,"Invalid durations rejected before writes");
  const after=await call("/api/data",{headers});
  assert.equal(after.status,200);
  assert.equal(after.body.runs.length,1);
  assert.equal(after.body.runs[0].distance,8);
  assert.equal(after.body.plan.find(x=>x.id==="strength-nov11").strengthLog.notes,"Updated strength notes");
  assert.equal(after.body.plan.find(x=>x.id==="run-nov12").status,"planned");
  assert.equal(after.body.plan.find(x=>x.id==="strength-cancelled").status,"cancelled");
  console.log("PASS navigation-independent authenticated strength logging, completed-session backfill, editing, progress, excluded fields, no running-mileage changes",libsql?"Turso SDK":"SQLite");
} finally {
  server.kill("SIGTERM");
  rmSync(dir,{recursive:true,force:true});
}
