import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';

async function check(file, deadlineTest, duringHeartbeat = false) {
  const source=fs.readFileSync(file,'utf8').replace(/^import[\s\S]*?;\n/gm,'');
  let unblock, started;
  const running=new Promise(resolve=>{unblock=resolve;});
  const began=new Promise(resolve=>{started=resolve;});
  const calls=[];const timers=[];const intervals=[];let claims=0;
  const jobs=[1,2].map(id=>({id,job_type:'notify',claim_token:`owner-${id}`,payload_json:{tenantKey:'fixture',callSid:`call-${id}`},attempts:1,max_attempts:5}));
  const deps={
    pg:{Pool:class {async end(){calls.push(['end']);}}},
    process:{env:{DATABASE_URL:'offline',WORKER_SHUTDOWN_TIMEOUT_MS:'999999'},pid:123,on(){},exit(code){calls.push(['exit',code]);}},
    logError(){},logInfo(){},ensureTables:async()=>{},
    ASYNC_JOB_TYPES:{leadNotificationSend:'notify'},
    claimAsyncJobs:async()=>{claims++;return claims===1?jobs:[];},
    heartbeatAsyncJob:async(_,id,opts)=>{calls.push(['heartbeat',id,opts.claimToken]);if(duringHeartbeat && id===1){started();await running;}return true;},
    releaseAsyncJob:async(_,id,opts)=>{calls.push(['release',id,opts.claimToken]);return true;},
    completeAsyncJob:async(_,id,opts)=>{calls.push(['complete',id,opts.claimToken]);return true;},
    failAsyncJob:async(_,id,opts)=>{calls.push(['fail',id,opts.claimToken]);return true;},
    sendLeadNotifications:async()=>{calls.push(['effect']);started();await running;},
    setInterval(fn){const timer={fn,unref(){}};intervals.push(timer);return timer;},clearInterval(){},
    setTimeout(fn,ms){const timer={fn,ms};timers.push(timer);return timer;},clearTimeout(){}
  };
  const worker=new Function(...Object.keys(deps),`${source}\nreturn {shutdown,loop:()=>loopPromise};`)(...Object.values(deps));
  await began;
  if (duringHeartbeat) {
    const shutdown=worker.shutdown('SIGTERM');await nextTurn();
    unblock();await shutdown;await worker.loop();
    assert.equal(calls.some(c=>c[0]==='effect'),false);
    assert.ok(calls.some(c=>c[0]==='release'&&c[1]===1));
    return;
  }
  await intervals[0].fn();
  assert.ok(calls.some(c=>c[0]==='heartbeat'&&c[1]===2&&c[2]==='owner-2'));
  const shutdown=worker.shutdown('SIGTERM');await nextTurn();
  assert.ok(calls.some(c=>c[0]==='release'&&c[1]===2&&c[2]==='owner-2'));
  assert.equal(calls.some(c=>c[0]==='release'&&c[1]===1),false);
  assert.equal(calls.some(c=>c[0]==='end'),false);
  assert.equal(timers[0].ms,25000);
  if(deadlineTest){timers[0].fn();assert.ok(calls.some(c=>c[0]==='exit'&&c[1]===1));assert.equal(calls.some(c=>c[0]==='complete'),false);}
  unblock();await shutdown;await worker.loop();
  assert.equal(calls.filter(c=>c[0]==='effect').length,1);
  assert.ok(calls.some(c=>c[0]==='complete'&&c[1]===1&&c[2]==='owner-1'));
  assert.ok(calls.findIndex(c=>c[0]==='end')>calls.findIndex(c=>c[0]==='complete'));
}
const files=process.argv.slice(2);
if(!files.length)files.push(new URL('../apps/worker/src/worker.js',import.meta.url));
for(const file of files){await check(file,false);await check(file,true);await check(file,false,true);console.log(`PASS worker batch heartbeat, fenced completion, graceful drain, unstarted release and bounded deadline: ${file}`);}
