import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../api.js',import.meta.url),'utf8');
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
function boot(local,session=storage()){
  const handlers={},calls=[];
  const window={COMPANY_CONFIG:{API_URL:'https://example.test'},addEventListener:(n,f)=>handlers[n]=f,dispatchEvent(){}};
  vm.runInNewContext(source,{window,location:{protocol:'https:',hostname:'example.test'},localStorage:local,sessionStorage:session,fetch:()=>new Promise(resolve=>calls.push(resolve)),AbortSignal,Event,URL,Blob,atob});
  return {api:window.ZIP_API,calls,handlers};
}
test('migrates old tab session and restores after browser restart; logout clears it',()=>{
  const local=storage(),session=storage();session.setItem('chae-session','legacy');
  assert.equal(boot(local,session).api.hasSession,true);assert.equal(session.getItem('chae-session'),null);
  const next=boot(local);assert.equal(next.api.hasSession,true);next.api.setToken('');assert.equal(boot(local).api.hasSession,false);
});
test('late response cannot invalidate a newer session',async()=>{
  const {api,calls}=boot(storage());api.setToken('old');const request=api.request('me');api.setToken('new');
  calls[0]({ok:true,json:async()=>({ok:false,code:'AUTH_REQUIRED'})});
  await assert.rejects(request,{code:'STALE_SESSION'});assert.equal(api.hasSession,true);
});
test('server keeps persistent sessions and still rejects expired legacy credentials',()=>{
  const context={PropertiesService:{getScriptProperties:()=>({getProperty:()=>JSON.stringify(context.session),setProperty:(k,v)=>context.session=JSON.parse(v),deleteProperty:()=>{}})}};
  vm.createContext(context);vm.runInContext(readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8'),context);
  context.zipHash_=v=>v;context.zipUsers_=()=>[['user']];context.zipPublicUser_=()=>({status:'approved'});
  context.session={sub:'user',expires:null};assert.equal(context.zipSession_('token').status,'approved');
  context.session={sub:'user',expires:Date.now()+60000};context.zipSession_('token');assert.equal(context.session.expires,null);
  context.session={sub:'user',expires:1};assert.throws(()=>context.zipSession_('token'));
  context.session={sub:'user',expires:null};context.zipUsers_=()=>[];assert.throws(()=>context.zipSession_('token'));
});
