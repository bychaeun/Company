import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function setup(){const c={};vm.createContext(c);for(const file of ['Api.gs','Board.gs'])vm.runInContext(readFileSync(new URL('../apps-script/'+file,import.meta.url),'utf8'),c);return c;}
const valid={id:'12345678-1234-1234-1234-123456789012',title:'디자인 자료',content:'메모',url:'https://fonts.google.com/',color:'cream',x:300,y:-20,link:''};
test('board input preserves text, URL and canvas placement',()=>{const c=setup(),n=c.zipBoardInput_(valid);assert.equal(n.x,300);assert.equal(n.y,-20);assert.equal(n.title,valid.title);});
test('board rejects executable URLs and invalid positions or links',()=>{const c=setup();for(const b of [{url:'javascript:alert(1)'},{x:Infinity},{x:100001},{link:valid.id},{title:''},{color:'red'}])assert.throws(()=>c.zipBoardInput_({...valid,...b}));});
test('board routes require approved admin and board sheets are excluded from notes',()=>{const c=setup();c.zipJson_=v=>v;c.zipSheet_=()=>({getSheets:()=>['디자인 보드','디자인 대지','업무'].map(name=>({getName:()=>name}))});assert.equal(c.zipNoteSheets_().length,1);for(const action of ['board','saveBoard','deleteBoard','deleteBoards','saveArtboard']){for(const user of [{status:'pending',role:'admin'},{status:'approved',role:'member'}]){c.zipSession_=()=>user;assert.equal(c.doPost({postData:{contents:JSON.stringify({action})}}).code,'FORBIDDEN');}}});
function storage(){
 const c=setup(),sheets=new Map();
 function create(name,data=[]){const sh={data,getName:()=>name,getLastRow:()=>data.length,getLastColumn:()=>Math.max(0,...data.map(r=>r.length)),setFrozenRows(){},appendRow:r=>data.push([...r]),getRange(row,col,n=1,m=1){const range={getDisplayValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>String(data[row-1+i]?.[col-1+j]??''))),setValues(values){values.forEach((r,i)=>{data[row-1+i]??=[];r.forEach((v,j)=>data[row-1+i][col-1+j]=v);});return range;},setNumberFormat(){return range;}};return range;},getRangeList(ranges){return {setValue(value){for(const ref of ranges)data[Number(ref.slice(1))-1][9]=value;}};}};sheets.set(name,sh);return sh;}
 c.zipSheet_=()=>({getSheetByName:name=>sheets.get(name),insertSheet:create});c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};return {c,create,sheets};
}
test('legacy ten-column notes migrate without losing links, text, or placement',()=>{
 const {c,create,sheets}=storage();create('디자인 보드',[Array.from(c.ZIP_BOARD_HEADERS).slice(0,10),[valid.id,valid.title,valid.content,valid.url,'cream','300','-20','','','']]);
 const row=c.zipBoard_()[0];assert.equal(row.boardId,'default');assert.equal(row.urls[0],valid.url);assert.equal(row.content,valid.content);assert.equal(row.x,300);assert.equal(sheets.get('디자인 보드').data[0].length,12);assert.equal(c.zipArtboards_()[0].title,'기본 대지');
});
test('multiple artboards and URLs persist, old clients cannot erase extra links or board membership',()=>{
 const {c}=storage(),boardId='artboard-12345678901234567890';c.zipSaveArtboard_({id:boardId,title:'브랜드 자료'});
 c.zipSaveBoard_({...valid,boardId,urls:['https://fonts.google.com/','https://example.com/a']});
 c.zipSaveBoard_({...valid,title:'이전 버전에서 수정'});const row=c.zipBoard_()[0];assert.equal(row.boardId,boardId);assert.equal(row.urls.length,2);assert.equal(c.zipBoard_().length,1);
 assert.throws(()=>c.zipSaveBoard_({...valid,id:'different-12345678901234567',boardId:'default',link:valid.id}));
});
test('bulk deletion validates all IDs before writing and prevents deleted notes from resurfacing',()=>{
 const {c}=storage(),other='different-12345678901234567';c.zipSaveBoard_(valid);c.zipSaveBoard_({...valid,id:other,title:'남길 메모'});
 assert.throws(()=>c.zipDeleteBoards_([valid.id,'unknown-123456789012345678']));assert.equal(c.zipBoard_().length,2);
 c.zipDeleteBoards_([valid.id]);assert.equal(c.zipBoard_().length,1);assert.equal(c.zipBoard_()[0].id,other);assert.throws(()=>c.zipSaveBoard_(valid));
});
test('site arrays reject unsupported protocols, oversized lists and preserve distinct URLs',()=>{const c=setup();assert.throws(()=>c.zipBoardInput_({...valid,urls:['javascript:alert(1)']}));assert.throws(()=>c.zipBoardInput_({...valid,urls:Array(21).fill(valid.url)}));assert.equal(c.zipBoardInput_({...valid,urls:[valid.url,valid.url]}).urls.length,1);});
