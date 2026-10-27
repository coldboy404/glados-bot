import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture() {
 const store = new Map(), sent = [];
 const c = vm.createContext({Request,Response,URL,TextEncoder,crypto,console,Date,Intl,AbortSignal,
 setTimeout:()=>1,clearTimeout(){},fetch:async()=>Response.json({ok:true})});
 vm.runInContext(readFileSync('worker.js','utf8').replace('export default {','globalThis.worker = {'),c);
 c.tgSend = async (...args)=>sent.push(args[1]); c.tgEdit=async (...args)=>sent.push(args[2]);
 return {c,store,sent,env:{BOT_TOKEN:'dummy',GLADOS_DB:{get:async k=>store.get(k)??null,put:async(k,v)=>store.set(k,v),delete:async k=>store.delete(k)}}};
}
test('new gld and legacy koa cookies import separately and resolve real email',async()=>{
 const f=fixture();
 const raw='gld:sess=gld_dummy; gld:sess.sig=sig1\nkoa:sess=legacy; koa:sess.sig=sig2';
 assert.equal(f.c.extractGladosCookies(raw).length,2);
 f.store.set('TEMP_1','glados-facility.com');f.store.set('MSGID_1','1');
 let count=0;f.c.safeFetchJson=async()=>({code:0,data:{userInfo:{email:++count===1?'first@example.com':'second@example.com'}}});
 await f.c.processAddAccountInfo(1,1,raw,f.env);
 const accounts=JSON.parse(f.store.get('USER_1'));assert.deepEqual(accounts.map(a=>a.email),['first@example.com','second@example.com']);
 assert.equal(accounts[0].cookie,'gld:sess=gld_dummy; gld:sess.sig=sig1');
});
test('incomplete gld cookie never falls through to fake email import',async()=>{
 const f=fixture();f.store.set('TEMP_1','glados-facility.com');f.store.set('MSGID_1','1');
 await f.c.processAddAccountInfo(1,1,'gld:sess=dummy',f.env);
 assert.ok(!f.store.has('USER_1'));assert.match(f.sent.at(-1),/不完整/);
});
test('site UI uses stable provider name, never internal fallback host',async()=>{
 const f=fixture();
 await f.c.handleCallback({id:'x',from:{id:1},message:{chat:{id:1},message_id:1},data:'selsite_0'},f.env,'https://example.com');
 assert.match(f.sent.at(-1),/GLaDOS/); assert.ok(!f.sent.at(-1).includes('glados-facility.com'));
});
test('malformed KV records and preferences do not crash menus',async()=>{
 const f=fixture();
 for(const raw of ['{}','null','broken']){f.store.set('USER_1',raw);assert.equal((await f.c.getAccounts('1',f.env)).length,0);}
 f.store.set('USER_1','[null,{"domain":"glados.network","email":123}]');
 assert.equal((await f.c.getAccounts('1',f.env)).length,1);
 for(const raw of ['broken','null','{"checkinHour":99}']){f.store.set('PREF_1',raw);assert.equal((await f.c.getPref('1',f.env)).checkinHour,12);}
});
test('time input rejects parseInt prefix acceptance',async()=>{
 const f=fixture();
 for(const text of ['12abc','12.5','-1','24','']){
 await f.c.processCronTime(1,1,text,f.env);assert.ok(!f.store.has('PREF_1'));}
 await f.c.processCronTime(1,1,'08',f.env);assert.equal(JSON.parse(f.store.get('PREF_1')).checkinHour,8);
});
test('cookie update requires signature and leaves old cookie intact',async()=>{
 const f=fixture(); f.store.set('TEMP_1','0'); f.store.set('USER_1','[{"domain":"glados-facility.com","cookie":"old"}]');
 await f.c.processUpdateCookie(1,1,'koa:sess=new',f.env);
 assert.equal(JSON.parse(f.store.get('USER_1'))[0].cookie,'old');assert.match(f.sent.at(-1),/gld:sess.sig/);
});
test('subscription failure distinguishes readable status without subscription fields',async()=>{
 const f=fixture();f.c.safeFetchJson=async()=>({code:0,data:{leftDays:14}});
 const result=await f.c.getSubAndHost('glados-facility.com','dummy');
 assert.match(result,/账号状态可读取/);assert.ok(!result.includes('无法获取账号状态'));
});
test('status timeout remains unknown and skips traffic and points requests',async()=>{
 const f=fixture();const paths=[];
 f.c.gladosFetchJson=async(acc,path)=>{paths.push(path);return {domain:acc.domain,data:null};};
 const data=await f.c.getAccountDataObj({domain:'glados-facility.com'},false);
 assert.deepEqual(paths,['/api/user/status']);assert.equal(data.cookieValid,null);
 assert.match(f.c.formatAccountString({},1,1,{},data),/未能验证/);
});
test('successful observation logged is not misclassified as already checked in',async()=>{
 const f=fixture();
 f.c.gladosFetchJson=async(acc,path)=>({domain:acc.domain,data:path.endsWith('checkin')?{code:0,message:'Observation logged'}:path.endsWith('status')?{code:0,data:{leftDays:10,vip:21}}:{code:0,points:10,history:[]}});
 const data=await f.c.getAccountDataObj({domain:'glados-facility.com',cookie:'dummy'},true);
 assert.equal(data.checkinState,'success');
});
test('upstream HTML is escaped in Telegram result rendering',()=>{
 const f=fixture(); const row=f.c.formatCheckinResultRow({email:'x@example.com'},1,{}, {statusMsg:'❌ <bad>&',checkinState:'failed'});
 assert.ok(row.includes('&lt;bad&gt;&amp;'));assert.ok(!row.includes('<bad>'));
});
test('failed batch exchange is reported and never counted as success',async()=>{
 const f=fixture();f.c.setTimeout=fn=>{fn();return 1;};
 f.store.set('USER_1',JSON.stringify([{domain:'glados-facility.com',email:'x@example.com'}]));
 f.c.safeFetchJson=async(url)=>url.endsWith('/points')?{code:0,points:200}:{code:-1,message:'denied'};
 await f.c.executeTask({type:'batch_exchange',chatId:1,userId:1,startIndex:0,plan:'plan100',successList:[]},f.env,'https://example.com');
 assert.ok(f.sent.some(s=>s.includes('❌ 兑换失败')));assert.ok(!f.sent.some(s=>s.includes('成功进行了兑换')));
});
test('single exchange rejects missing accounts and reports business failure',async()=>{
 const f=fixture(); const cb={id:'x',from:{id:1},message:{chat:{id:1},message_id:1},data:'doexch_0_plan100'};
 await f.c.handleCallback(cb,f.env,'https://example.com');assert.match(f.sent.at(-1),/无效/);
 f.store.set('USER_1','[{"domain":"glados-facility.com","email":"x@example.com"}]');
 f.c.safeFetchJson=async()=>({code:-1,message:'<denied>'});f.c.getAccountDataObj=async()=>({});
 await f.c.handleCallback(cb,f.env,'https://example.com');assert.match(f.sent.at(-1),/❌ 兑换失败/);assert.ok(!f.sent.at(-1).includes('✅ 兑换'));
});
