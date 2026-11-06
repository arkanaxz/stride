import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/weather/route.ts";

function localToday() {
  const entries = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  return ["year","month","day"].map(type=>entries.find(p=>p.type===type)?.value).join("-");
}

async function exercise(date,forecast) {
  const calls=[];
  const before=global.fetch;
  global.fetch=async url=>{
    const parsed=new URL(String(url));
    calls.push(parsed);
    const t=[date+"T06:00", date+"T07:00", date+"T08:00"];
    return new Response(JSON.stringify({hourly:{time:t,temperature_2m:[27.5,28.1,28.7]}}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try {
    const response=await POST(new Request("http://localhost/api/weather", {
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({location:"Lapu-Lapu City, Cebu, Philippines",date,startTime:"06:10",endTime:"07:02"}),
    }));
    assert.equal(response.status,200,await response.text().catch(()=>""));
    const body=await response.json();
    assert.match(body.weatherStart,/27.5°C/);
    assert.match(body.weatherEnd,/28.1°C/);
    assert.equal(body.location,"Lapu-Lapu City, Cebu, Philippines");
    assert.equal(calls.length,1);
    const url=calls[0];
    assert.equal(url.hostname,forecast?"api.open-meteo.com":"archive-api.open-meteo.com");
    if(forecast) {
      assert.ok(url.searchParams.has("past_days"));
      assert.ok(!url.searchParams.has("start_date"));
      assert.ok(!url.searchParams.has("end_date"));
    } else {
      assert.equal(url.searchParams.get("start_date"),date);
      assert.ok(!url.searchParams.has("past_days"));
    }
  } finally { global.fetch=before; }
}

test("recent Lapu-Lapu workouts return start and finish temps without conflicting date parameters",async()=>{
  await exercise(localToday(),true);
});
test("historical runs use archive start_date/end_date without past_days",async()=>{
  await exercise("2025-11-03",false);
});
