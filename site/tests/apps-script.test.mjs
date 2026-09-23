import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8');
function context(){
  const properties=new Map([['GOOGLE_CLIENT_ID','client'],['ADMIN_EMAILS','owner@gmail.com']]);
  let payload={aud:'client',iss:'https://accounts.google.com',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),sub:'123',email_verified:'true',email:'member@gmail.com',nonce:'nonce'};
  const c=vm.createContext({Date,JSON,Math,Number,String,Object,Array,Error,isFinite,
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value),deleteProperty:key=>properties.delete(key)})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
    Utilities:{computeDigest:(_a,s)=>s,base64EncodeWebSafe:s=>String(s),DigestAlgorithm:{SHA_256:'sha256'}},
    UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(payload)})}
  });vm.runInContext(code,c);return {c,properties,setPayload:value=>{payload={...payload,...value};}};
}
test('anonymous data, missing session and malformed requests fail closed',()=>{
  const {c}=context();assert.equal(c.doGet({parameter:{action:'data'}}).ok,false);
  for(const action of ['notes','image','users','setStatus'])assert.equal(c.doPost({postData:{contents:JSON.stringify({action})}}).ok,false);
  assert.equal(c.doPost({postData:{contents:'not json'}}).ok,false);
});
test('Google identity rejects wrong audience, issuer, expiry, nonce, email verification',()=>{
  for(const value of [{aud:'other'},{iss:'https://evil.example'},{exp:0},{exp:'NaN'},{iat:'NaN'},{email_verified:'false'},{nonce:'other'},{sub:''}]){
    const {c,setPayload}=context();setPayload(value);assert.throws(()=>c.zipLogin_('token','nonce'),/Authentication required/);
  }
});
test('unknown sheet statuses are denied; only pinned administrators bypass sheet approval',()=>{
  const {c,properties}=context();
  for(const status of ['大承認','ADMIN','대기','', '거절','차단'])assert.notEqual(c.zipPublicUser_(['123','member@gmail.com','member',status]).status,'approved');
  assert.equal(c.zipPublicUser_(['123','member@gmail.com','member','승인']).status,'approved');
  properties.set('admin:owner@gmail.com','owner-sub');
  assert.equal(c.zipPublicUser_(['owner-sub','owner@gmail.com','owner','대기']).role,'admin');
  assert.equal(c.zipPublicUser_(['other-sub','owner@gmail.com','owner','대기']).role,'member');
});
test('Drive IDs are allowlisted; arbitrary or malformed URLs are rejected',()=>{
  const {c}=context();assert.equal(c.zipDriveId_('https://drive.google.com/file/d/abcdefghijk/view'),'abcdefghijk');
  for(const url of ['https://evil.example/file/d/abcdefghijk','http://drive.google.com/file/d/abcdefghijk','https://drive.google.com.evil/file/d/abcdefghijk','javascript:alert(1)'])assert.equal(c.zipDriveId_(url),'');
});
test('formula-leading user profile cells are escaped',()=>{
  const {c}=context();assert.equal(c.zipSafeCell_('=IMPORTXML("https://evil")'),'\'=IMPORTXML("https://evil")');
});
