// Both registries live in the existing COMPANY workbook. No public sheet export.
var ZIP_REGISTRY = {
  numbers:{name:'스펙번호 관리',headers:['종이넘버','스펙넘버','경면','비고']},
  sites:{name:'현장별 관리',headers:['현장명','종이넘버','스펙넘버','경면','모델하우스 예정일','본납 예정일','설계사','진행상태','비고']}
};
var ZIP_REGISTRY_META=['관리 ID','앱 수정일','앱 삭제일'];
function zipRegistryError_(code) {var error=new Error(code);error.zipCode=code;return error;}
function zipRegistryDefinition_(kind) {if(!Object.prototype.hasOwnProperty.call(ZIP_REGISTRY,kind))throw zipRegistryError_('REGISTRY_INPUT');return ZIP_REGISTRY[kind];}
function zipRegistrySheet_(kind) {
  var def=zipRegistryDefinition_(kind),sheet=zipSheet_().getSheetByName(def.name);
  if(!sheet)throw zipRegistryError_('REGISTRY_SETUP');
  var count=def.headers.length,headers=sheet.getRange(1,1,1,Math.max(count+3,sheet.getLastColumn())).getDisplayValues()[0];
  if(!def.headers.every(function(h,i){return headers[i]===h;}))throw zipRegistryError_('REGISTRY_HEADERS');
  ZIP_REGISTRY_META.forEach(function(h,i){if(headers[count+i]&&headers[count+i]!==h)throw zipRegistryError_('REGISTRY_HEADERS');});
  if(!ZIP_REGISTRY_META.every(function(h,i){return headers[count+i]===h;})) {
    if(sheet.getMaxColumns()<count+3)sheet.insertColumnsAfter(sheet.getMaxColumns(),count+3-sheet.getMaxColumns());
    sheet.getRange(1,count+1,1,3).setValues([ZIP_REGISTRY_META]);
    sheet.hideColumns(count+1,3);
    // Normal header-filter sorting includes the stable ID and soft-delete columns.
    var filter=sheet.getFilter(),criteria=[];
    if(filter){for(var c=1;c<=count;c++)criteria[c]=filter.getColumnFilterCriteria(c);filter.remove();}
    var nextFilter=sheet.getRange(1,1,Math.max(2,sheet.getMaxRows()),count+3).createFilter();
    criteria.forEach(function(rule,i){if(rule)nextFilter.setColumnFilterCriteria(i,rule);});
  }
  if(sheet.getLastRow()>10001)throw zipRegistryError_('REGISTRY_LIMIT');
  var length=Math.max(0,sheet.getLastRow()-1),rows=length?sheet.getRange(2,1,length,count+3).getDisplayValues():[],seen={};
  rows.forEach(function(row,i){
    if(!row.slice(0,count).some(function(v){return v!=='';}))return;
    if(!row[count]){row[count]=Utilities.getUuid();sheet.getRange(i+2,count+1).setValue(row[count]);}
    if(!/^[a-zA-Z0-9-]{20,80}$/.test(row[count])||seen[row[count]])throw zipRegistryError_('REGISTRY_IDS');
    seen[row[count]]=true;
  });
  return {sheet:sheet,rows:rows,count:count,definition:def};
}
function zipRegistryVersion_(row,count) {return zipHash_(JSON.stringify(row.slice(0,count).concat(row[count+2]||'')));}
function zipRegistryItem_(row,count) {return {id:row[count],values:row.slice(0,count),version:zipRegistryVersion_(row,count)};}
function zipRegistryData_() {
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    var result={ok:true,syncedAt:new Date().toISOString(),lists:{},statuses:[]};
    Object.keys(ZIP_REGISTRY).forEach(function(kind){var data=zipRegistrySheet_(kind);result.lists[kind]={headers:data.definition.headers,items:data.rows.filter(function(r){return r[data.count]&&!r[data.count+2]&&r.slice(0,data.count).some(function(v){return v!=='';});}).map(function(r){return zipRegistryItem_(r,data.count);})};
      if(kind==='sites'){var rule=data.sheet.getRange(2,8).getDataValidation();if(rule&&rule.getCriteriaType()===SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST)result.statuses=rule.getCriteriaValues()[0];}
    });result.mapItems=zipSpecs_();return result;
  }finally{lock.releaseLock();}
}
function zipRegistryInput_(body) {
  var def=zipRegistryDefinition_(body.kind);
  if(!/^[a-zA-Z0-9-]{20,80}$/.test(body.id||'')||!Array.isArray(body.values)||body.values.length!==def.headers.length)throw zipRegistryError_('REGISTRY_INPUT');
  var values=body.values.map(function(v){if(typeof v!=='string'||v.length>4000)throw zipRegistryError_('REGISTRY_INPUT');return v.trim();});
  if(!values[0]||!values[1])throw zipRegistryError_('REGISTRY_INPUT');
  return values;
}
function zipSaveRegistry_(body) {
  var values=zipRegistryInput_(body),lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    var data=zipRegistrySheet_(body.kind),rowIndex=data.rows.findIndex(function(r){return r[data.count]===body.id;}),previous=rowIndex<0?null:data.rows[rowIndex];
    if(previous&&previous[data.count+2])throw zipRegistryError_('REGISTRY_CONFLICT');
    // Safe response-loss retries: an identical write with the same UUID is a no-op.
    if(previous&&JSON.stringify(previous.slice(0,data.count))===JSON.stringify(values))return {ok:true,item:zipRegistryItem_(previous,data.count)};
    if(previous&&body.version!==zipRegistryVersion_(previous,data.count))throw zipRegistryError_('REGISTRY_CONFLICT');
    if(!previous&&body.version)throw zipRegistryError_('REGISTRY_CONFLICT');
    var row=rowIndex<0?Math.max(2,data.sheet.getLastRow()+1):rowIndex+2;
    if(row>data.sheet.getMaxRows())data.sheet.insertRowsAfter(data.sheet.getMaxRows(),1);
    var range=data.sheet.getRange(row,1,1,data.count),formulas=range.getFormulas()[0],rules=range.getDataValidations()[0];
    values.forEach(function(value,i){
      if(previous&&value===previous[i])return;
      if(formulas[i])throw zipRegistryError_('REGISTRY_FORMULA');
      var rule=rules[i];
      if(value&&rule&&rule.getCriteriaType()===SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST&&rule.getCriteriaValues()[0].indexOf(value)<0)throw zipRegistryError_('REGISTRY_VALIDATION');
    });
    values.forEach(function(value,i){if(previous&&value===previous[i])return;
      var cell=data.sheet.getRange(row,i+1);cell.setNumberFormat('@').setValue(/^[=+@-]/.test(value)?"'"+value:value);
    });
    data.sheet.getRange(row,data.count+1,1,3).setValues([[body.id,new Date().toISOString(),'']]);
    SpreadsheetApp.flush();var saved=data.sheet.getRange(row,1,1,data.count+3).getDisplayValues()[0];
    return {ok:true,item:zipRegistryItem_(saved,data.count)};
  }finally{lock.releaseLock();}
}
function zipDeleteRegistry_(body) {
  zipRegistryDefinition_(body.kind);if(!/^[a-zA-Z0-9-]{20,80}$/.test(body.id||''))throw zipRegistryError_('REGISTRY_INPUT');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var data=zipRegistrySheet_(body.kind),index=data.rows.findIndex(function(r){return r[data.count]===body.id;});if(index<0)throw zipRegistryError_('REGISTRY_CONFLICT');var row=data.rows[index];
    if(row[data.count+2])return {ok:true};if(body.version!==zipRegistryVersion_(row,data.count))throw zipRegistryError_('REGISTRY_CONFLICT');
    data.sheet.getRange(index+2,data.count+3).setValue(new Date().toISOString());return {ok:true};
  }finally{lock.releaseLock();}
}
function syncSpecRegistryDaily() {var data=zipRegistryData_();PropertiesService.getScriptProperties().setProperty('registry-synced-at',data.syncedAt);}
function setupSpecRegistryDaily() {
  // Does not change existing note/checklist triggers.
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='syncSpecRegistryDaily';}))ScriptApp.newTrigger('syncSpecRegistryDaily').timeBased().everyDays(1).atHour(7).create();
  syncSpecRegistryDaily();
}
