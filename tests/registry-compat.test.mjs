import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../spec-registry.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('  function normalizeNumbers('),source.indexOf('  function selectTab('));
test('old server master hides mirror while preserving it through edits',()=>{
  const c={data:null};vm.createContext(c);vm.runInContext(helper,c);
  c.data=c.normalizeNumbers({lists:{numbers:{headers:['종이','스펙','경면','비고'],items:[{id:'one',version:'v1',values:['001','SPEC-1','HM','원본']}]}},mapItems:[]});
  const row=c.data.lists.numbers.items[0];assert.deepEqual(Array.from(row.values),['001','SPEC-1','원본']);
  const write=c.numberWrite({...row,kind:'numbers',values:['001','SPEC-2','수정']});assert.deepEqual(Array.from(write.values),['001','SPEC-2','HM','수정']);assert.equal(write.version,'v1');
});
test('updated server uses three columns without rewriting the payload',()=>{
  const c={data:null};vm.createContext(c);vm.runInContext(helper,c);
  c.data=c.normalizeNumbers({lists:{numbers:{headers:['종이','스펙','비고'],items:[]}}});
  const row={kind:'numbers',values:['001','SPEC-1','비고']};assert.equal(c.numberWrite(row),row);
});
