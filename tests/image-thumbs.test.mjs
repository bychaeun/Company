import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8'),client=readFileSync(new URL('../api.js',import.meta.url),'utf8');
const A='aaaaaaaaaaaa',B='bbbbbbbbbbbb',C='cccccccccccc';

function serverEnv(files){
 const cache=new Map(),opened=[];
 const blob=(bytes,type)=>({getBytes:()=>Buffer.from(bytes),getContentType:()=>type});
 const c={Utilities:{base64Encode:b=>Buffer.from(b).toString('base64')},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},
  DriveApp:{getFileById(id){opened.push(id);const f=files[id];return {getMimeType:()=>f.mime,getSize:()=>f.size,getThumbnail:()=>f.thumb?blob(f.thumb,'image/png'):null,getBlob:()=>blob('full','image/jpeg')};}}};
 vm.createContext(c);vm.runInContext(server,c);c.zipNotes_=()=>[{images:[A,B]}];return {c,opened,cache};
}
test('previews are only served for images referenced by notes and are cached server-side',()=>{
 const {c,opened}=serverEnv({[A]:{mime:'image/jpeg',size:900000,thumb:'small'},[B]:{mime:'image/jpeg',size:900000,thumb:null},[C]:{mime:'image/jpeg',size:1,thumb:'x'}});
 const first=c.zipThumbs_([A,B,C]);
 assert.equal(Buffer.from(first.images[A].base64,'base64').toString(),'small');
 assert.equal(first.images[B],undefined,'large image without a thumbnail is left to the full-size path');
 assert.equal(first.images[C],undefined,'unreferenced image is never opened');
 assert.ok(!opened.includes(C));
 opened.length=0;c.zipThumbs_([A]);assert.deepEqual(opened,[],'second request uses the cache');
 assert.throws(()=>c.zipThumbs_([]));assert.throws(()=>c.zipThumbs_(new Array(25).fill(A)));
});

function clientEnv(){
 const calls=[],store=new Map([['chae-session','test-session-123456789012345678901234']]);
 const c={COMPANY_CONFIG:{API_URL:'https://example.test/api'},location:{protocol:'https:',hostname:'example.test',href:'https://example.test/'},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},sessionStorage:{getItem:()=>null,removeItem(){}},
  AbortSignal:{timeout(){}},Date,URL:Object.assign(class extends URL{},{createObjectURL:b=>'blob:'+b.type,revokeObjectURL(){}}),Blob,Uint8Array,atob,setTimeout,clearTimeout,Promise,
  fetch(url,options){let resolve;const p=new Promise(r=>resolve=r);calls.push({body:JSON.parse(options.body),resolve});return p;},addEventListener(){},dispatchEvent(){},Event:class{}};
 c.window=c;vm.createContext(c);vm.runInContext(client,c);
 const reply=(i,data)=>calls[i].resolve({ok:true,json:async()=>data});
 const until=async n=>{for(let i=0;i<50&&calls.length<n;i++)await new Promise(r=>setTimeout(r,5));};
 return {api:c.ZIP_API,calls,reply,until};
}
const png=Buffer.from('p').toString('base64');
test('card previews for several notes share one request',async()=>{
 const e=clientEnv();const loads=[A,B].map(id=>e.api.image(id,{thumb:true}));await e.until(1);
 assert.equal(e.calls.length,1);assert.equal(e.calls[0].body.action,'thumbs');assert.deepEqual(e.calls[0].body.fileIds,[A,B]);
 e.reply(0,{ok:true,images:{[A]:{mime:'image/png',base64:png},[B]:{mime:'image/png',base64:png}}});
 assert.deepEqual(await Promise.all(loads),['blob:image/png','blob:image/png']);
 assert.equal(await e.api.image(A,{thumb:true}),'blob:image/png');assert.equal(e.calls.length,1,'memory cache reused');
});
test('an older server without previews falls back to full images',async()=>{
 const e=clientEnv();const load=e.api.image(A,{thumb:true});await e.until(1);
 e.reply(0,{ok:false,code:'REQUEST_FAILED',error:'지원하지 않는 요청입니다.'});await e.until(2);
 assert.equal(e.calls[1].body.action,'image');e.reply(1,{ok:true,mime:'image/jpeg',base64:png});
 assert.equal(await load,'blob:image/jpeg');
 const next=e.api.image(B,{thumb:true});await e.until(3);assert.equal(e.calls[2].body.action,'image','no repeated preview attempts');e.reply(2,{ok:true,mime:'image/jpeg',base64:png});await next;
});
