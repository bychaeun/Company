import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../apps-script/SpecRegistry.gs',import.meta.url),'utf8');
const api=readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8');
function setup(){
 const store=new Map();let next=0;
 function sheet(name,headers){
  const data=[headers.slice()],formulas={},validations={};let filter=null;
  const sh={data,formulas,validations,getName:()=>name,getLastColumn:()=>Math.max(...data.map(r=>r.length)),getLastRow:()=>data.length,getMaxColumns:()=>26,getMaxRows:()=>500,insertColumnsAfter(){},insertRowsAfter(){},hideColumns(){},getFilter:()=>filter,
   getRange(row,col,n=1,m=1){const range={
    getDisplayValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>String(data[row+i-1]?.[col+j-1]??''))),
    setValues(values){values.forEach((r,i)=>{data[row+i-1]??=[];r.forEach((v,j)=>data[row+i-1][col+j-1]=v);});return range;},
    setValue(v){return range.setValues([[String(v).replace(/^'/,'')]]);},setNumberFormat(){return range;},
    getFormulas:()=>[Array.from({length:m},(_,i)=>formulas[`${row}:${col+i}`]||'')],
    getDataValidation:()=>validations[col]||null,getDataValidations:()=>[Array.from({length:m},(_,i)=>validations[col+i]||null)],
    createFilter(){filter={getColumnFilterCriteria:()=>null,setColumnFilterCriteria(){},remove(){filter=null;}};return filter;}
   };return range;}
  };store.set(name,sh);return sh;
 }
 const numbers=sheet('스펙번호 관리',['종이넘버','스펙넘버','경면','비고']),sites=sheet('현장별 관리',['현장명','종이넘버','스펙넘버','경면','모델하우스 예정일','본납 예정일','설계사','진행상태','비고']);
 const c={zipSheet_:()=>({getSheetByName:n=>store.get(n)}),zipHash_:s=>createHash('sha256').update(s).digest('hex'),zipSpecs_:()=>[],Utilities:{getUuid:()=>`00000000-0000-0000-0000-${String(++next).padStart(12,'0')}`},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},SpreadsheetApp:{DataValidationCriteria:{VALUE_IN_LIST:'list'},flush(){}},console};vm.createContext(c);vm.runInContext(source,c);return {c,numbers,sites};
}
test('reads append stable IDs without changing leading-zero numbers or original columns',()=>{
 const {c,numbers}=setup();numbers.data.push(['0012','0007','HM','그대로']);const result=c.zipRegistryData_();
 assert.deepEqual(numbers.data[1].slice(0,4),['0012','0007','HM','그대로']);assert.equal(result.lists.numbers.items[0].values[0],'0012');assert.equal(numbers.data[0][4],'관리 ID');assert.equal(c.zipRegistryData_().lists.numbers.items[0].id,result.lists.numbers.items[0].id);
});
test('save uses stable ID after sorting and response-loss retries cannot duplicate rows',()=>{
 const {c,numbers}=setup();numbers.data.push(['001','A','HM',''],['002','B','SM','']);const list=c.zipRegistryData_().lists.numbers.items;[numbers.data[1],numbers.data[2]]=[numbers.data[2],numbers.data[1]];
 const body={kind:'numbers',...list[0],values:['001','A2','HM','수정']};const result=c.zipSaveRegistry_(body);assert.equal(numbers.data[2][1],'A2');assert.equal(numbers.data[1][1],'B');assert.equal(c.zipSaveRegistry_(body).item.id,result.item.id);assert.equal(numbers.data.length,3);
});
test('direct sheet changes produce a conflict, never an overwrite',()=>{
 const {c,numbers}=setup();numbers.data.push(['001','A','','']);const item=c.zipRegistryData_().lists.numbers.items[0];numbers.data[1][1]='시트에서 수정';assert.throws(()=>c.zipSaveRegistry_({kind:'numbers',...item,values:['001','앱에서 수정','','']}),e=>e.zipCode==='REGISTRY_CONFLICT');assert.equal(numbers.data[1][1],'시트에서 수정');
});
test('formula fields are preserved when unchanged and cannot be overwritten',()=>{
 const {c,numbers}=setup();numbers.data.push(['001','계산값','','']);numbers.formulas['2:2']='=A2';let item=c.zipRegistryData_().lists.numbers.items[0];
 c.zipSaveRegistry_({kind:'numbers',...item,values:['001','계산값','','비고만 변경']});assert.equal(numbers.formulas['2:2'],'=A2');item=c.zipRegistryData_().lists.numbers.items[0];assert.throws(()=>c.zipSaveRegistry_({kind:'numbers',...item,values:['001','덮어쓰기','','']}),e=>e.zipCode==='REGISTRY_FORMULA');assert.equal(numbers.data[1][1],'계산값');
});
test('invalid statuses are rejected before any values change; formulas are escaped',()=>{
 const {c,sites,numbers}=setup();sites.validations[8]={getCriteriaType:()=> 'list',getCriteriaValues:()=>[['제안 중','본납 완료']]};
 assert.throws(()=>c.zipSaveRegistry_({kind:'sites',id:'12345678-1234-1234-1234-123456789012',values:['현장','001','','','','','','허용 안 함','']}),e=>e.zipCode==='REGISTRY_VALIDATION');assert.equal(sites.data.length,1);
 c.zipSaveRegistry_({kind:'numbers',id:'12345678-1234-1234-1234-123456789012',values:['001','=IMPORTXML(1)','','']});assert.equal(numbers.data[1][1],'=IMPORTXML(1)');
});
test('deletion is recoverable and stale writes cannot resurrect a deleted row',()=>{
 const {c,numbers}=setup();numbers.data.push(['001','A','','']);const item=c.zipRegistryData_().lists.numbers.items[0];c.zipDeleteRegistry_({kind:'numbers',...item});assert.ok(numbers.data[1][6]);assert.equal(c.zipRegistryData_().lists.numbers.items.length,0);assert.throws(()=>c.zipSaveRegistry_({kind:'numbers',...item}),e=>e.zipCode==='REGISTRY_CONFLICT');
});
test('unknown kinds and duplicate IDs fail safely',()=>{
 const {c,numbers}=setup();assert.throws(()=>c.zipRegistryInput_({kind:'__proto__'}));numbers.data.push(['1','a','',''],['2','b','','']);c.zipRegistryData_();numbers.data[2][4]=numbers.data[1][4];assert.throws(()=>c.zipRegistryData_(),e=>e.zipCode==='REGISTRY_IDS');
});
test('all registry reads and writes require approved admin sessions',()=>{
 const c={};vm.createContext(c);vm.runInContext(api,c);c.zipJson_=v=>v;
 for(const user of [{status:'pending',role:'admin'},{status:'approved',role:'member'}]){c.zipSession_=()=>user;for(const action of ['specRegistry','saveSpecRegistry','deleteSpecRegistry'])assert.equal(c.doPost({postData:{contents:JSON.stringify({action})}}).code,'FORBIDDEN');}
 assert.ok(api.includes("name !== '스펙번호 관리'"));assert.ok(api.includes("name !== '현장별 관리'"));
});
