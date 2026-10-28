import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createApp} from './server.mjs';
test('auth, validation, deduplication, partial failure, durable retry',async()=>{
 const dir=await mkdtemp(tmpdir()+'/awtar-');let calls=0;
 const env={SMS_ACCESS_TOKEN:'a'.repeat(32),TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'test',TWILIO_FROM:'AWTAR',SMS_DATA_DIR:dir};
 const mock=async(url,opts)=>{calls++;assert.equal(opts.body.get('Body'),'اختبار');return new Response(JSON.stringify(calls===1?{sid:'SMtest',status:'queued'}:{code:21211}),{status:calls===1?201:400})};
 let server=createApp(env,mock);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let base='http://127.0.0.1:'+server.address().port;
 const payload={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',text:'اختبار',phones:['+9647701234567','+9647701234567','+9647801234567']};
 const send=(body=payload,token=env.SMS_ACCESS_TOKEN)=>fetch(base+'/api/sms',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{assert.equal((await send(payload,'wrong')).status,401);assert.equal((await send({...payload,phones:['bad']})).status,400);
 let response=await send();assert.equal(response.status,200);let result=await response.json();assert.equal(result.results.length,2);assert.equal(result.results[0].state,'accepted');assert.equal(result.results[1].state,'failed');await send();assert.equal(calls,2);
 assert.equal((await send({...payload,text:'different'})).status,409);
 await new Promise(r=>server.close(r));server=createApp(env,mock);await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;await send();assert.equal(calls,2);
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})}
});
test('unconfigured service does not send',async()=>{let server=createApp({},()=>{throw Error('must not call')});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/api/sms',{method:'POST'})).status,503)}finally{await new Promise(r=>server.close(r))}});
test('uncertain provider response is never retried automatically',async()=>{const dir=await mkdtemp(tmpdir()+'/awtar-');let calls=0;const env={SMS_ACCESS_TOKEN:'a'.repeat(32),TWILIO_ACCOUNT_SID:'AC'+'b'.repeat(32),TWILIO_AUTH_TOKEN:'test',TWILIO_FROM:'AWTAR',SMS_DATA_DIR:dir};const server=createApp(env,async()=>{calls++;throw Error('connection lost')});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const send=()=>fetch('http://127.0.0.1:'+server.address().port+'/api/sms',{method:'POST',headers:{Authorization:'Bearer '+env.SMS_ACCESS_TOKEN},body:JSON.stringify({id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',text:'اختبار',phones:['+9647701234567']})});assert.equal((await(await send()).json()).results[0].state,'unknown');await send();assert.equal(calls,1)}finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})}});
