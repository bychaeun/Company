import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function setup(){const c={};vm.createContext(c);for(const file of ['Api.gs','Board.gs'])vm.runInContext(readFileSync(new URL('../apps-script/'+file,import.meta.url),'utf8'),c);return c;}
const valid={id:'12345678-1234-1234-1234-123456789012',title:'디자인 자료',content:'메모',url:'https://fonts.google.com/',color:'cream',x:300,y:-20,link:''};
test('board input preserves text, URL and canvas placement',()=>{const c=setup(),n=c.zipBoardInput_(valid);assert.equal(n.x,300);assert.equal(n.y,-20);assert.equal(n.title,valid.title);});
test('board rejects executable URLs and invalid positions or links',()=>{const c=setup();for(const b of [{url:'javascript:alert(1)'},{x:Infinity},{x:100001},{link:valid.id},{title:''},{color:'red'}])assert.throws(()=>c.zipBoardInput_({...valid,...b}));});
test('board routes require approved admin and board sheet is excluded from notes',()=>{const c=setup();c.zipJson_=v=>v;c.zipSheet_=()=>({getSheets:()=>[{getName:()=> '디자인 보드'},{getName:()=> '업무'}]});assert.equal(c.zipNoteSheets_().length,1);for(const action of ['board','saveBoard','deleteBoard']){for(const user of [{status:'pending',role:'admin'},{status:'approved',role:'member'}]){c.zipSession_=()=>user;assert.equal(c.doPost({postData:{contents:JSON.stringify({action})}}).code,'FORBIDDEN');}}});
