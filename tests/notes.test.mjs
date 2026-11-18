import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8');
function setup(){
 const sheets=[];
 const makeSheet=name=>{
  const data=[];const sh={getName:()=>name,getSheetId:()=>sheets.indexOf(sh)+1,getLastRow:()=>{let k=data.length;while(k>1&&!(data[k-1]||[]).some(v=>v!==''&&v!=null))k--;return k;},getLastColumn:()=>data[0]?.length||0,setFrozenRows(){},getMaxRows:()=>1000,getMaxColumns:()=>26,getFrozenRows:()=>1,deleteRow(row){data.splice(row-1,1);},setColumnWidths(){},setColumnWidth(){},
   getRange(row,col,n=1,m=1){const range={getDisplayValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>String(data[row-1+i]?.[col-1+j]??''))),getValues:()=>range.getDisplayValues(),setValues(values){values.forEach((r,i)=>{data[row-1+i]??=[];r.forEach((v,j)=>data[row-1+i][col-1+j]=v);});return range;},setValue(v){return range.setValues([[v]]);},clearContent(){return range.setValues(Array.from({length:n},()=>Array(m).fill('')));},moveTo(target){const src=Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>data[row-1+i]?.[col-1+j]??''));src.forEach((r,i)=>r.forEach((_,j)=>{if(data[row-1+i])data[row-1+i][col-1+j]='';}));target.setValues(src);},setFontWeight(){return range;},setBackground(){return range;},setNumberFormat(){return range;}};return range;},getDataRange(){return sh.getRange(1,1,data.length,sh.getLastColumn());}};
  sheets.push(sh);return sh;
 };
 const ctx={LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},SpreadsheetApp:{flush(){}}};vm.createContext(ctx);vm.runInContext(source,ctx);
 const allowSubcategory=ctx.zipAllowSubcategory_;ctx.zipAllowSubcategory_=(cell,value)=>{if(cell.getDataValidation)allowSubcategory(cell,value);};
 ctx.zipSheet_=()=>({getSheets:()=>sheets,getSheetByName:name=>sheets.find(s=>s.getName()===name),insertSheet:makeSheet});
 const properties={};ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>properties[k],setProperty:(k,v)=>properties[k]=v,getProperties:()=>({...properties}),deleteProperty:k=>delete properties[k]})};
 ctx.zipHash_=text=>createHash('sha256').update(text).digest('hex');
 ctx.zipJson_=v=>v;return ctx;
}
const input={category:'새 업체 특징',subcategory:'인테리어 설계',title:'테스트 메모',content:'내용',address:'',imageText:''};

test('new subcategory extends strict dropdown without disabling validation',()=>{
 const ctx={SpreadsheetApp:{DataValidationCriteria:{VALUE_IN_LIST:'list'}}};vm.createContext(ctx);vm.runInContext(source,ctx);
 let result;const existing=['유통업체'];const rule={getCriteriaType:()=> 'list',getCriteriaValues:()=>[existing,true],copy:()=>({requireValueInList(values,show){result={values,show,allowInvalid:false};return this;},build:()=>result})};
 const cell={getDataValidation:()=>rule,setDataValidation(value){result=value;}};
 ctx.zipAllowSubcategory_(cell,'프레스');assert.deepEqual(result.values,['유통업체','프레스']);assert.equal(result.allowInvalid,false);assert.deepEqual(existing,['유통업체']);
 result=null;ctx.zipAllowSubcategory_(cell,'유통업체');assert.equal(result,null);
});
test('retry after a lost response returns original note instead of duplicating it',()=>{
 const c=setup(),body={...input,requestId:'12345678-1234-1234-1234-123456789012',requestOwner:'admin'};
 const first=c.zipCreateNote_(body),retry=c.zipCreateNote_(body);assert.equal(first.noteId,retry.noteId);assert.equal(c.zipNotes_().length,1);
 const moved={...body,noteId:first.noteId,category:'이동한 분류'};const result=c.zipUpdateNote_(moved);assert.equal(c.zipUpdateNote_(moved).noteId,result.noteId);assert.equal(c.zipNotes_().length,1);
});
test('new Korean category and subcategory creates a sheet and persists note',()=>{
 const c=setup(),result=c.zipCreateNote_(input);assert.equal(result.noteId,'1:2');const notes=c.zipNotes_();assert.equal(notes[0].category,input.category);assert.equal(notes[0].subcategory,input.subcategory);
});
test('invalid and reserved categories return specific validation codes',()=>{
 const c=setup();for(const category of ['', '업체/설계','접근관리','내 스펙관리'])assert.throws(()=>c.zipNoteInput_({...input,category}),e=>e.zipCode==='NOTE_CATEGORY');
});
test('bulk deletion removes the sheet rows and validates all targets before deleting',()=>{
 const c=setup();const a=c.zipCreateNote_(input),b=c.zipCreateNote_({...input,title:'남길 메모'}),d=c.zipCreateNote_(input);
 assert.throws(()=>c.zipDeleteNotes_([a.noteId,'999:2']));assert.equal(c.zipNotes_().length,3);
 c.zipDeleteNotes_([a.noteId,d.noteId]);const left=c.zipNotes_();assert.equal(left.length,1);assert.equal(left[0].title,'남길 메모');assert.equal(left[0].noteId,'1:2','rows below moved up in the sheet');
});
test('category move deletes the old row and returns the new ID',()=>{
 const c=setup(),a=c.zipCreateNote_(input),b=c.zipCreateNote_({...input,title:'그대로'});const result=c.zipUpdateNote_({...input,noteId:a.noteId,category:'다른 대분류'});
 assert.equal(result.noteId,'2:2');assert.ok(c.zipNotes_().some(n=>n.title==='그대로'&&n.noteId==='1:2'));
});
test('a stale row ID never edits or deletes the note that moved into its place',()=>{
 const c=setup(),a=c.zipCreateNote_({...input,title:'첫째'}),b=c.zipCreateNote_({...input,title:'둘째'});c.zipDeleteNote_(a.noteId,'첫째');
 assert.throws(()=>c.zipDeleteNote_(b.noteId,'둘째'));assert.throws(()=>c.zipUpdateNote_({...input,noteId:a.noteId,expectedTitle:'첫째'}),e=>e.zipCode==='NOTE_MOVED');
 assert.equal(c.zipNotes_()[0].title,'둘째');c.zipDeleteNote_('1:2','둘째');assert.equal(c.zipNotes_().length,0);
});
test('startup bundles notes only for approved sessions and deletion requires admin',()=>{
 const c=setup();c.zipCreateNote_(input);
 c.zipSession_=()=>({status:'approved',role:'member'});
 const post=body=>c.doPost({postData:{contents:JSON.stringify(body)}});
 assert.equal(post({action:'me',includeNotes:true}).records.length,1);
 assert.equal(post({action:'deleteNotes',noteIds:['1:2']}).code,'FORBIDDEN');
 c.zipSession_=()=>({status:'pending',role:'member'});assert.equal(post({action:'me',includeNotes:true}).records,undefined);
});
