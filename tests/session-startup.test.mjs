import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const auth=readFileSync(new URL('../auth.js',import.meta.url),'utf8'),apiSource=readFileSync(new URL('../api.js',import.meta.url),'utf8');
const user={sub:'admin',email:'test@example.com',role:'admin',status:'approved'};
function authEnv(){
 const elements=new Map(),events=[],handlers=new Map();let resolve;
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,close(){},classList:{remove(){},add(){}},addEventListener(){}});return elements.get(id);};
 const api={hasSession:true,rememberedUser:user,rememberUser(u){this.hint=u;},clearImages(){},request(action,payload){events.push({action,payload});return new Promise(r=>resolve=r);}};
 const c={ZIP_API:api,document:{body:{classList:{remove(){},add(){}}},getElementById:element,querySelector:element,addEventListener(){},hidden:false},setInterval(){},setTimeout(){},clearTimeout(){},Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},addEventListener(type,fn){handlers.set(type,fn);},dispatchEvent(e){events.push(e);handlers.get(e.type)?.(e);}};c.window=c;vm.createContext(c);vm.runInContext(auth,c);return {c,api,events,element,finish:result=>resolve(result)};
}
test('remembered approved account opens shell before network and requests one verified bootstrap',async()=>{
 const e=authEnv();assert.equal(e.element('private-app').hidden,false);assert.equal(e.element('auth-panel').hidden,true);assert.equal(e.c.ZIP_AUTH_PENDING,true);
 assert.equal(e.events.filter(x=>x.action==='me').length,1);assert.equal(e.events.find(x=>x.action==='me').payload.includeNotes,true);
 e.finish({ok:true,user,records:[]});await e.c.CHAE_AUTH.check();assert.equal(e.c.ZIP_AUTH_PENDING,false);assert.equal(e.api.hint,user);assert.ok(e.events.some(x=>x.type==='notes-bootstrap-ready'));
});
test('server rejection hides restored shell and clears remembered approval',async()=>{const e=authEnv();e.finish({ok:true,user:{...user,status:'rejected'}});await e.c.CHAE_AUTH.check();assert.equal(e.element('private-app').hidden,true);assert.equal(e.api.hint.status,'rejected');});
function apiEnv(){const values=new Map([['chae-session','session-123456789012345678901234567890']]),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};let resolve,calls=0;const c={COMPANY_CONFIG:{API_URL:'https://example.test/api'},location:{protocol:'https:',hostname:'example.test'},localStorage:storage,sessionStorage:{getItem:()=>null,removeItem(){}},AbortSignal:{timeout(){}},fetch(){calls++;return new Promise(r=>resolve=r);},addEventListener(){},dispatchEvent(){},Event:class{}};c.window=c;vm.createContext(c);vm.runInContext(apiSource,c);return {c,values,calls:()=>calls,respond:data=>resolve({ok:true,json:async()=>data})};}
test('concurrent identical reads share a request and logout clears the shell hint',async()=>{const e=apiEnv(),api=e.c.ZIP_API;api.rememberUser(user);assert.equal(api.rememberedUser.email,user.email);const a=api.request('notes'),b=api.request('notes');assert.equal(a,b);assert.equal(e.calls(),1);e.respond({ok:true,records:[]});await a;api.setToken('');assert.equal(api.rememberedUser,null);assert.equal(e.values.has('chae-user-hint'),false);});
