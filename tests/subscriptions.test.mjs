import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
function fixture() {
 const c = vm.createContext({Request,Response,URL,TextEncoder,crypto,console,Date,Intl,AbortSignal,setTimeout:fn=>{fn();return 1;},clearTimeout(){},fetch:async()=>new Response('',{status:404})});
 vm.runInContext(readFileSync('worker.js','utf8').replace('export default {','globalThis.worker = {'),c);
 return c;
}
test('official configureId and hashed credentials produce distinct subscription formats',()=>{
 const c=fixture(); const links=c.subscriptionLinksFromStatus({configureId:'config-id',userId:'wrong-id',code:'secret',port:1234,hashed:'independent-hash'});
 assert.equal(links.mihomo,'https://update.glados-config.com/mihomo/config-id/secret/1234/glados.yaml');
 assert.equal(links.singbox,'https://update.glados-config.com/singbox/config-id/independent-hash');
 assert.equal(links.shadowrocket,'https://update.glados-config.com/subscribe/config-id/secret/1234/servers');
});
test('missing or hidden hash is never fabricated from the Mihomo credential',()=>{
 const c=fixture();for(const hashed of [undefined,'xxxx']) {
 const links=c.subscriptionLinksFromStatus({configureId:1,code:'secret',port:1234,hashed});
 assert.equal(links.singbox,null);assert.ok(links.shadowrocket);
 assert.match(c.formatSubscriptionLinks(links),/未返回所需参数/);
 }
});
test('single account fetch includes all formats even when Mihomo redirects successfully',async()=>{
 const c=fixture();let calls=0;
 c.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://update.glados-config.com/mihomo/id/code/123/glados.yaml'}});
 c.safeFetchJson=async()=>{calls++;return {code:0,data:{configureId:'id',code:'code',port:123,hashed:'hash'}};};
 const result=await c.getSubAndHost('glados-facility.com','dummy');
 assert.equal(calls,1);assert.match(result,/singbox\/id\/hash/);assert.match(result,/subscribe\/id\/code\/123\/servers/);assert.match(result,/Mihomo \/ Clash/);assert.match(result,/1\.14\.0/);
});
test('explicit subscription URLs are escaped and work without Mihomo',async()=>{
 const c=fixture();c.safeFetchJson=async()=>({code:0,data:{subscriptions:{singbox:'https://example.com/config?a=1&b=2',shadowrocket:'javascript:bad'}}});
 const result=await c.getSubAndHost('glados-facility.com','dummy');
 assert.match(result,/a=1&amp;b=2/);assert.ok(!result.includes('javascript:'));assert.match(result,/通用 \/ Shadowrocket/);
});
test('batch subscription delivery uses same multi-format renderer',async()=>{
 const c=fixture();const sent=[];
 c.getAccounts=async()=>[{domain:'glados-facility.com',cookie:'dummy',email:'a@example.com'}];c.getPref=async()=>({showEmail:true});
 c.safeFetchJson=async()=>({code:0,data:{configureId:'id',code:'code',port:123,hashed:'hash'}});
 c.tgSend=async(id,text)=>sent.push(text);
 await c.executeTask({type:'sub_all',chatId:1,userId:1,startIndex:0},{},'https://example.com');
 assert.match(sent[0],/singbox\/id\/hash/);assert.match(sent[0],/subscribe\/id\/code\/123\/servers/);
});
