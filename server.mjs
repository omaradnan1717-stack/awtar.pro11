import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {timingSafeEqual,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url);
export function createApp(env=process.env,providerFetch=fetch){
 let busy=false;
 const ready=()=>env.SMS_ACCESS_TOKEN?.length>=24&&/^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID||'')&&env.TWILIO_AUTH_TOKEN&&(env.TWILIO_FROM||env.TWILIO_MESSAGING_SERVICE_SID);
 return http.createServer(async(req,res)=>{
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 try{
 if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await readFile(new URL('index.html',root)));return}
 if(req.method!=='POST'||req.url!=='/api/sms'){json(404,{error:'غير موجود'});return}
 if(!ready()){json(503,{error:'خدمة SMS غير مفعّلة على الخادم بعد'});return}
 let supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+env.SMS_ACCESS_TOKEN);
 if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){json(401,{error:'رمز الإرسال غير صحيح'});return}
 if(req.headers.origin&&req.headers.origin!==`${env.PUBLIC_ORIGIN||'http://'+req.headers.host}`){json(403,{error:'مصدر الطلب غير مسموح'});return}
 let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>100000){json(413,{error:'حجم الطلب كبير'});return}}
 let data;try{data=JSON.parse(body)}catch{json(400,{error:'طلب غير صالح'});return}
 const {id,text,phones}=data;
 if(!/^[a-f0-9-]{36}$/i.test(id||'')||typeof text!=='string'||!text.trim()||text.length>1600||!Array.isArray(phones)||!phones.length||phones.length>500||phones.some(p=>typeof p!=='string'||!/^\+[1-9]\d{7,14}$/.test(p))){json(400,{error:'تحقق من النص والأرقام (حد الدفعة 500)'});return}
 if(busy){json(409,{error:'توجد دفعة قيد التنفيذ؛ انتظر ثم أعد المحاولة'});return}busy=true;
 try{
 const directory=env.SMS_DATA_DIR||fileURLToPath(new URL('./sms-data/',root));await mkdir(directory,{recursive:true,mode:0o700});
 const path=directory+'/'+id+'.json';const hash=createHash('sha256').update(JSON.stringify({text,phones})).digest('hex');
 let job;try{job=JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 if(job){if(job.hash!==hash){json(409,{error:'رقم الدفعة مستخدم لمحتوى مختلف'});return}json(200,{results:job.results});return}
 job={hash,results:[...new Set(phones)].map(phone=>({phone,state:'unknown'}))};
 const persist=()=>writeFile(path,JSON.stringify(job),{mode:0o600});await persist();
 for(const result of job.results){
 try{const form=new URLSearchParams({To:result.phone,Body:text});if(env.TWILIO_MESSAGING_SERVICE_SID)form.set('MessagingServiceSid',env.TWILIO_MESSAGING_SERVICE_SID);else form.set('From',env.TWILIO_FROM);
 const response=await providerFetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(20000)});
 const answer=await response.json();if(response.ok&&answer.sid){result.state=['failed','undelivered','canceled'].includes(answer.status)?'failed':'accepted';result.sid=answer.sid;result.providerStatus=answer.status}else if(response.status>=400&&response.status<500){result.state='failed';result.code=answer.code||response.status}
 }catch{}await persist();
 }
 json(200,{results:job.results});
 }finally{busy=false}
 }catch{if(!res.headersSent)json(500,{error:'تعذر تأكيد الطلب. راجع سجل الخدمة قبل أي إرسال جديد'});else res.end()}
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url))createApp().listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('AWTAR server ready'));
