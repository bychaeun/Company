import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../auth.js',import.meta.url),'utf8');
function boot(){
  const nodes=new Map(),calls=[],timers=[],events={};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',close(){},replaceChildren(){},classList:{add(){},remove(){}}});return nodes.get(id);};
  const api={hasSession:true,request:action=>new Promise((resolve,reject)=>calls.push({action,resolve,reject})),config(){throw Error('Existing session must not load Google config');},clearImages(){},setToken(v){this.hasSession=!!v;}};
  const window={ZIP_API:api,addEventListener:(n,f)=>events[n]=f,dispatchEvent(){}};
  vm.runInNewContext(source,{window,document:{getElementById:node,querySelector:node,body:node('body'),addEventListener(){},hidden:false},Event,CustomEvent:class{},setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout(){},setInterval(){}});
  return {api,window,node,calls,timers,events};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('saved session skips Google login setup and hides sign-in button during restore',async()=>{
  const b=boot();
  assert.deepEqual(b.calls.map(x=>x.action),['me']);
  assert.equal(b.node('google-login').hidden,true);
  assert.equal(b.node('private-app').hidden,true);
  b.calls[0].resolve({user:{status:'approved',role:'admin'}});
  await flush();
  assert.equal(b.node('auth-panel').hidden,true);
  assert.equal(b.node('private-app').hidden,false);
});
test('temporary startup failure keeps saved session and retries without sign-in screen',async()=>{
  const b=boot();b.calls[0].reject(Error('offline'));await flush();
  assert.equal(b.api.hasSession,true);
  assert.equal(b.node('google-login').hidden,true);
  assert.equal(b.node('private-app').hidden,true);
  b.timers.at(-1)();
  assert.equal(b.calls.length,2);
  b.calls[1].resolve({user:{status:'approved',role:'admin'}});await flush();
  assert.equal(b.node('auth-panel').hidden,true);
});
test('server rejection never exposes private app',async()=>{
  const b=boot();b.calls[0].resolve({user:{status:'rejected',role:'viewer'}});await flush();
  assert.equal(b.node('private-app').hidden,true);
  assert.equal(b.window.CHAE_AUTH.user.status,'rejected');
});

