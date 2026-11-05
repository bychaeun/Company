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
  const sh={data,formulas,validations,getName:()=>name,getLastColumn:()=>Math.max(...data.map(r=>r.length)),getLastRow:()=>data.length,getMaxColumns:()=>26,getMaxRows:()=>500,insertColumnsAfter(){},insertRowsAfter(){},hideColumns(){},setColumnWidth(){},hideSheet(){sh.hidden=true;},getFilter:()=>filter,
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
 const numbers=sheet('스펙번호 관리',['종이넘버','스펙넘버','경면','비고']),sites=sheet('내 스펙관리',['현장명','종이넘버','스펙넘버','경면','모델하우스 예정일','본납 예정일','설계사','진행상태','비고']);
 const c={zipSheet_:()=>({getSheetByName:n=>store.get(n)}),zipHash_:s=>createHash('sha256').update(s).digest('hex'),zipSpecs_:()=>[],Utilities:{getUuid:()=>`00000000-0000-0000-0000-${String(++next).padStart(12,'0')}`},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},SpreadsheetApp:{DataValidationCriteria:{VALUE_IN_LIST:'list'},flush(){}},console};vm.createContext(c);vm.runInContext(source,c);return {c,numbers,sites,sheet};
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
test('number list exposes only paper, specification, memo and preserves legacy mirror values',()=>{
 const {c,numbers}=setup();numbers.data.push(['001','CE-001','HM','기존 비고']);let item=c.zipRegistryData_().lists.numbers.items[0];assert.deepEqual(Array.from(item.values),['001','CE-001','기존 비고']);assert.deepEqual(Array.from(c.zipRegistryData_().lists.numbers.headers),['종이넘버','스펙넘버','비고']);c.zipSaveRegistry_({kind:'numbers',...item,values:['001','CE-001','새 비고']});assert.equal(numbers.data[1][2],'HM');assert.equal(numbers.data[1][3],'새 비고');
});
test('entering either paper or specification fills the matching pair; ambiguity never chooses randomly',()=>{
 const {c,numbers}=setup();numbers.data.push(['001','CE-001','',''],['002','CE-002','','']);c.zipRegistryData_();
 const input=(id,paper,spec)=>({kind:'sites',id,values:['현장',paper,spec,'HM','','','','','']});
 assert.equal(c.zipSaveRegistry_(input('12345678-1234-1234-1234-123456789010','001','')).item.values[2],'CE-001');
 assert.equal(c.zipSaveRegistry_(input('12345678-1234-1234-1234-123456789011','','CE-002')).item.values[1],'002');
 numbers.data.push(['001','CE-003','','']);assert.equal(c.zipSaveRegistry_(input('12345678-1234-1234-1234-123456789012','001','')).item.values[2],'');
});
test('multiple specifications auto-fill in order and mirror counts are validated',()=>{
 const {c,numbers}=setup();numbers.data.push(['001','CE-1','',''],['002','CE-2','','']);c.zipRegistryData_();const values=['현장','','CE-2, CE-1','SM, HM','','','','',''];const item=c.zipSaveRegistry_({kind:'sites',id:'12345678-1234-1234-1234-123456789012',values}).item;assert.equal(item.values[1],'002\n001');assert.equal(item.values[2],'CE-2\nCE-1');assert.throws(()=>c.zipValidateSiteLists_(['현장','','a,b','HM,SM,XX']));
});
test('migration keeps the original map sheet, coordinates, photos, IDs and builder and is safe to repeat',()=>{
 const {c,sheet}=setup();vm.runInContext(readFileSync(new URL('../apps-script/Specs.gs',import.meta.url),'utf8'),c);c.zipInvalidateRead_=()=>{};
 const target=sheet('내 스펙관리',Array.from(c.ZIP_SPEC_HEADERS)),id='12345678-1234-1234-1234-123456789012';target.data.push([id,'현장 A','서울','설계','담당','건설','2027-01','2028-02','37.5','127','photo-file-id-123',JSON.stringify([{number:'001',spec:'1001',mirror:'HM'}]),'2026-11-05','']);
 const old=sheet('현장별 관리',Array.from(c.ZIP_REGISTRY.sites.headers));old.data.push(['현장 B','002','1002','SM','','','','','원본 비고']);
 c.migrateUnifiedSites();assert.equal(old.hidden,true);assert.notEqual(target.hidden,true);assert.equal(target.data.length,3);const item=c.zipSpecs_().find(v=>v.id===id);assert.equal(item.address,'서울');assert.equal(item.lat,37.5);assert.equal(item.builder,'건설');assert.equal(item.images[0],'photo-file-id-123');assert.equal(item.papers[0].mirror,'HM');c.migrateUnifiedSites();assert.equal(target.data.length,3);
 const cols=c.zipUnifiedSiteSheet_().columns;target.data[1][cols[2]-1]='1002\n1003';target.data[1][cols[3]-1]='SM\nHM';target.data[1][cols[1]-1]='002\n003';assert.deepEqual(Array.from(c.zipSpecs_().find(v=>v.id===id).papers,p=>p.spec+'('+p.mirror+')'),['1002(SM)','1003(HM)']);
});
test('same-name conflicting specifications remain separate and source data is never deleted',()=>{
 const {c,sites,sheet}=setup();vm.runInContext(readFileSync(new URL('../apps-script/Specs.gs',import.meta.url),'utf8'),c);c.zipInvalidateRead_=()=>{};sites.data.push(['현장 A','007','SPEC-7','SM','2027-02','','설계','','기존 비고']);
 const old=sheet('현장별 관리',Array.from(c.ZIP_REGISTRY.sites.headers));old.data.push(['현장 A','001','SPEC-1','HM','','','','','']);c.migrateUnifiedSites();assert.equal(sites.data.length,3);assert.equal(sites.data[1][1],'007');assert.equal(sites.data[1][8],'기존 비고');assert.equal(old.data.length,2);assert.deepEqual(Array.from(c.zipSpecs_(),v=>v.papers[0].spec),['SPEC-7','SPEC-1']);
});
test('photo URLs use newlines, preserve commas, and reject executable protocols',()=>{const {c}=setup();vm.runInContext(readFileSync(new URL('../apps-script/Specs.gs',import.meta.url),'utf8'),c);assert.deepEqual(Array.from(c.zipPhotoUrls_('https://example.com/a,b.jpg\nhttps://example.com/c.png')),['https://example.com/a,b.jpg','https://example.com/c.png']);assert.throws(()=>c.zipPhotoUrls_('javascript:alert(1)'));assert.throws(()=>c.zipPhotoUrls_(Array(13).fill('https://example.com/a.jpg')));});
test('a malformed sheet photo does not prevent valid photos and sites from loading',()=>{const {c}=setup();vm.runInContext(readFileSync(new URL('../apps-script/Specs.gs',import.meta.url),'utf8'),c);assert.deepEqual(Array.from(c.zipReadablePhotoUrls_('bad URL\nhttps://example.com/a.jpg\njavascript:alert(1)')),['https://example.com/a.jpg']);});
test('blank mirror lines keep their position next to multiple specifications',()=>{const {c}=setup();vm.runInContext(readFileSync(new URL('../apps-script/Specs.gs',import.meta.url),'utf8'),c);const row=Array(21).fill('');row[2]='1001\n1002';row[3]='\nHM';assert.deepEqual(Array.from(c.zipSitePapers_(row),p=>p.mirror),['','HM']);});

test('deleting the optional master mirror column preserves IDs, notes, writes and deletion',()=>{
 const {c,numbers}=setup();numbers.data.push(['001','SPEC-1','HM','기존 비고']);const before=c.zipRegistryData_().lists.numbers.items[0];numbers.data.forEach(row=>row.splice(2,1));
 const item=c.zipRegistryData_().lists.numbers.items[0];assert.equal(item.id,before.id);assert.deepEqual(Array.from(item.values),['001','SPEC-1','기존 비고']);
 const saved=c.zipSaveRegistry_({kind:'numbers',...item,values:['001','SPEC-2','수정 비고']}).item;assert.equal(numbers.data[1][2],'수정 비고');assert.equal(numbers.data[0].includes('경면'),false);c.zipDeleteRegistry_({kind:'numbers',...saved});assert.equal(c.zipRegistryData_().lists.numbers.items.length,0);
});
test('reordered master headers and custom columns keep reads and updates mapped correctly',()=>{
 const {c,sheet}=setup(),master=sheet('스펙번호 관리',['사용자 열','비고','스펙넘버','종이넘버']);master.data.push(['그대로','메모','SPEC-1','0001']);
 const item=c.zipRegistryData_().lists.numbers.items[0];assert.deepEqual(Array.from(item.values),['0001','SPEC-1','메모']);c.zipSaveRegistry_({kind:'numbers',...item,values:['0001','SPEC-2','새 메모']});assert.deepEqual(master.data[1].slice(0,4),['그대로','새 메모','SPEC-2','0001']);
});
test('duplicate or missing required headings fail before adding or overwriting any columns',()=>{
 for(const headers of [['종이넘버','비고'],['종이넘버','스펙넘버','비고',' 스펙 넘버 ']]){const {c,sheet}=setup(),master=sheet('스펙번호 관리',headers),before=JSON.stringify(master.data);assert.throws(()=>c.zipRegistrySheet_('numbers'),e=>e.zipCode==='REGISTRY_HEADERS');assert.equal(JSON.stringify(master.data),before);}
});
test('map saves and direct sheet auto-fill follow headers after every site column is reordered',()=>{
 const {c,sites,numbers}=setup();vm.runInContext(readFileSync(new URL('../apps-script/Specs.gs',import.meta.url),'utf8'),c);c.zipInvalidateRead_=()=>{};c.zipSafeCell_=v=>String(v);numbers.data.push(['001','SPEC-1','','']);sites.data.push(['현장 A','001','SPEC-1','HM','','','','','']);c.migrateUnifiedSites();
 const width=sites.data[0].length;sites.data.forEach(row=>{while(row.length<width)row.push('');row.reverse();});const columns=c.zipUnifiedSiteSheet_().columns;sites.data[1][columns[12]-1]='서울';sites.data[1][columns[15]-1]='37.5';sites.data[1][columns[16]-1]='127';
 const item=c.zipSpecs_()[0];c.zipSaveSpec_({...item,builder:'건설사 이름',papers:[{spec:'SPEC-2',mirror:'SM',specMode:true}]});const updated=c.zipSpecs_()[0];assert.equal(updated.builder,'건설사 이름');assert.equal(updated.papers[0].spec,'SPEC-2');assert.equal(sites.data[1][columns[14]-1],'건설사 이름');
 sites.data[1][columns[1]-1]='001';c.zipAutofillRegistrySheet_({range:{getSheet:()=>sites,getRow:()=>2,getNumRows:()=>1,getColumn:()=>columns[1],getLastColumn:()=>columns[1],getLastRow:()=>2}});assert.equal(sites.data[1][columns[2]-1],'SPEC-1');
});
test('builder added under a matching heading is reused and not duplicated during migration',()=>{
 const {c,sheet}=setup();vm.runInContext(readFileSync(new URL('../apps-script/Specs.gs',import.meta.url),'utf8'),c);c.zipInvalidateRead_=()=>{};
 const headers=Array.from(c.ZIP_SPEC_HEADERS);headers[5]='건설사 이름';const target=sheet('내 스펙관리',headers);target.data.push(['12345678-1234-1234-1234-123456789012','현장 A','서울','','','직접 추가한 건설사','','','37','127','','[]','','']);c.migrateUnifiedSites();assert.equal(c.zipSpecs_()[0].builder,'직접 추가한 건설사');assert.equal(target.data[0].includes('건설사'),false);assert.notEqual(target.hidden,true);
});
test('map save completes either number from the master and returns the completed pair',()=>{
 const {c,numbers}=setup();vm.runInContext(readFileSync(new URL('../apps-script/Specs.gs',import.meta.url),'utf8'),c);c.zipInvalidateRead_=()=>{};c.migrateUnifiedSites();numbers.data.push(['001','SPEC-1','','']);
 for(const paper of [{number:'001',spec:'',specMode:true},{number:'',spec:'SPEC-1',specMode:true}]){const result=c.zipSaveSpec_({name:'현장',address:'서울',lat:37.5,lng:127,papers:[paper],images:[]});assert.equal(result.papers[0].number,'001');assert.equal(result.papers[0].spec,'SPEC-1');}
});
test('URL photos save after the old photo ID column is deleted without recreating it',()=>{
 const {c,sites}=setup();vm.runInContext(readFileSync(new URL('../apps-script/Specs.gs',import.meta.url),'utf8'),c);c.zipInvalidateRead_=()=>{};c.migrateUnifiedSites();assert.equal(sites.data[0].includes('사진 ID'),false);
 sites.data[0].push('사진 ID');sites.data[0].splice(sites.data[0].indexOf('사진 ID'),1);
 c.zipSaveSpec_({name:'URL 현장',address:'서울',lat:37.5,lng:127,papers:[{number:'001',spec:'SPEC-1',specMode:true}],images:[],imageUrls:['https://example.com/a.jpg','https://example.com/b.png']});const item=c.zipSpecs_()[0];assert.deepEqual(Array.from(item.imageUrls),['https://example.com/a.jpg','https://example.com/b.png']);assert.deepEqual(Array.from(item.images),[]);assert.equal(sites.data[0].includes('사진 ID'),false);
});
