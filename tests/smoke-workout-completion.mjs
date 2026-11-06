import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync, mkdirSync } from "node:fs";

const port=4651;
const base="http://127.0.0.1:"+port;
const folder=join(tmpdir(),"stride-workout-smoke-"+randomUUID());
mkdirSync(folder,{recursive:true});
const env={...process.env,STRIDE_DB_PATH:join(folder,"test.sqlite"),STRIDE_USERNAME:"smoke_admin",
  STRIDE_PASSWORD:"smoke_password_not_used_in_production",
  STRIDE_SESSION_SECRET:"local-only-test-secret-"+randomUUID(),
  PORT:String(port)};
const proc=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{
  env,stdio:"ignore",
});
async function ready() {
  for(let tries=0;tries<75;tries++){
    if(proc.exitCode!==null)throw new Error("Test server exited "+proc.exitCode);
    try {const res=await fetch(base+"/login",{signal:AbortSignal.timeout(1200)});if(res.status===200)return;}
    catch{}
    await new Promise(resolve=>setTimeout(resolve,350));
  }
  throw new Error("Test server never started");
}
async function json(endpoint,opts) {
  const response=await fetch(base+endpoint,opts);
  return {status:response.status, body:await response.json()};
}
try {
  await ready();
  const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({username:env.STRIDE_USERNAME,password:env.STRIDE_PASSWORD})});
  assert.equal(login.status,200,"admin login");
  const cookie=login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie,"auth cookie");
  const headers={cookie,"content-type":"application/json"};
  const before=await json("/api/data",{headers});
  assert.equal(before.status,200,JSON.stringify(before.body));
  const planned=before.body.plan.find(item=>item.status==="planned"&&!item.strength&&item.date!=="2026-11-03");
  assert.ok(planned,"plan has running session");
  const name="SMOKE "+planned.session;
  const run={date:planned.date,name,type:"Easy",distance:6.21,duration:41.5,location:"Lapu-Lapu City, Cebu, Philippines"};
  const send=()=>json("/api/data",{method:"POST",headers,body:JSON.stringify({kind:"complete-workout",workoutId:planned.id,run})});
  const first=await send();
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.insertedRun,true);
  assert.equal(first.body.plan.find(item=>item.id===planned.id).status,"completed");
  assert.equal(first.body.runs.filter(item=>item.date===run.date&&item.name===run.name).length,1);
  const second=await send();
  assert.equal(second.status,200,JSON.stringify(second.body));
  assert.equal(second.body.insertedRun,false);
  assert.equal(second.body.runs.filter(item=>item.date===run.date&&item.name===run.name).length,1);
  const planned2=second.body.plan.find(item=>item.status==="planned"&&!item.strength);
  assert.ok(planned2);
  const bad=await json("/api/data",{method:"POST",headers,body:JSON.stringify({
    kind:"complete-workout",workoutId:planned2.id,run:{date:planned2.date,name:"invalid",distance:0,duration:30},
  })});
  assert.equal(bad.status,409);
  const after=await json("/api/data",{headers});
  assert.equal(after.status,200);
  assert.equal(after.body.plan.find(item=>item.id===planned2.id).status,"planned");
  assert.equal(after.body.runs.filter(item=>item.name==="invalid").length,0);
  console.log("PASS: Login, complete workout, run present, progress updated, retry deduplicated, invalid save rolls back.");
} finally {
  proc.kill("SIGTERM");
  rmSync(folder,{recursive:true,force:true});
}
