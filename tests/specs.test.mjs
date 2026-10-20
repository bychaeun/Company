import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ctx={};vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8'),ctx);
vm.runInContext(readFileSync(new URL('../apps-script/Specs.gs',import.meta.url),'utf8'),ctx);
const valid=()=>({name:'테스트 현장',address:'서울 테스트 주소',lat:37.5,lng:127,openMonth:'2026-10',completionMonth:'2028-01',papers:[{number:'001',area:'거실',spec:'샘플'},{number:'002',area:'주방',spec:'샘플 2'}],images:[]});
test('preserves multiple paper numbers, parts, names and both dates',()=>{
 const data=ctx.zipSpecInput_(valid());assert.equal(data.papers.length,2);assert.equal(data.papers[0].number,'001');assert.equal(data.openMonth,'2026-10');assert.equal(data.completionMonth,'2028-01');
});
test('rejects missing names, bad coordinates, invalid months, malformed paper rows',()=>{
 for(const extra of [{name:''},{address:''},{lat:null},{lat:0},{lng:Infinity},{openMonth:'2026-13'},{papers:[{number:''}]},{images:['https://example.test/image.png']}])assert.throws(()=>ctx.zipSpecInput_({...valid(),...extra}));
});
test('bounds photo and paper counts and safely quotes spreadsheet formulas',()=>{
 assert.throws(()=>ctx.zipSpecInput_({...valid(),images:Array(5).fill('abcdefghijk')}));
 assert.throws(()=>ctx.zipSpecInput_({...valid(),papers:Array(51).fill({number:'1'})}));
 assert.equal(ctx.zipSafeCell_('=IMPORTXML("bad")'),'\'=IMPORTXML("bad")');
});
test('all spec API actions are inaccessible to pending/member/anonymous sessions',()=>{
 ctx.zipJson_=v=>v;ctx.zipSpecs_=()=>{throw Error('must not execute');};
 for(const action of ['specs','saveSpec','deleteSpec','geocodeSpec','specImage']){
   ctx.zipSession_=()=>({status:'pending',role:'member'});assert.equal(ctx.doPost({postData:{contents:JSON.stringify({action})}}).code,'FORBIDDEN');
   ctx.zipSession_=()=>({status:'approved',role:'member'});assert.equal(ctx.doPost({postData:{contents:JSON.stringify({action})}}).code,'FORBIDDEN');
   ctx.zipSession_=()=>{throw ctx.zipAuthError_();};assert.equal(ctx.doPost({postData:{contents:JSON.stringify({action})}}).code,'AUTH_REQUIRED');
 }
});
test('no configured geocoder returns manual-pin mode without external request',()=>{
 ctx.PropertiesService={getScriptProperties:()=>({getProperty:()=>null})};
 const result=ctx.zipGeocodeSpec_('테스트 주소');assert.equal(result.configured,false);assert.equal(result.locations.length,0);
});
