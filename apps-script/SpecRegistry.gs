// Both registries live in the existing COMPANY workbook. No public sheet export.
var ZIP_REGISTRY = {
  numbers:{name:'스펙번호 관리',headers:['종이넘버','스펙넘버','경면','비고']},
  sites:{name:'내 스펙관리',headers:['현장명','종이넘버','스펙넘버','경면','모델하우스 예정일','본납 예정일','설계사','진행상태','비고']}
};
var ZIP_REGISTRY_META=['관리 ID','앱 수정일','앱 삭제일'];
function zipRegistryError_(code) {var error=new Error(code);error.zipCode=code;return error;}
function zipRegistryDefinition_(kind) {if(!Object.prototype.hasOwnProperty.call(ZIP_REGISTRY,kind))throw zipRegistryError_('REGISTRY_INPUT');return ZIP_REGISTRY[kind];}
var ZIP_HEADER_ALIASES={'관리 ID':['ID'],'앱 수정일':['수정일'],'앱 삭제일':['삭제일'],'모델하우스 예정일':['M/H 오픈날'],'본납 예정일':['완공 연월'],'이전 스펙 상세(JSON)':['종이 목록(JSON)'],'건설사':['건설사 이름','건설사명']};
function zipHeaderKey_(value){return String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();}
// Resolve physical columns once; all row arrays below retain the stable logical field order.
function zipColumns_(sheet,names,optional,create){
  var width=Math.max(1,sheet.getLastColumn()),headers=sheet.getRange(1,1,1,width).getDisplayValues()[0],columns=[],missing=[];
  names.forEach(function(name,i){
    var keys=[name].concat(ZIP_HEADER_ALIASES[name]||[]).map(zipHeaderKey_),matches=[];
    headers.forEach(function(h,j){if(h&&keys.indexOf(zipHeaderKey_(h))>=0)matches.push(j+1);});
    if(matches.length>1)throw zipRegistryError_('REGISTRY_HEADERS');
    columns[i]=matches[0]||0;
    if(!columns[i]&&(optional||[]).indexOf(name)<0){if((create||[]).indexOf(name)<0)throw zipRegistryError_('REGISTRY_HEADERS');missing.push(i);}
  });
  // Validate the whole schema before appending; never overwrite user columns.
  missing.forEach(function(i){var col=++width;if(col>sheet.getMaxColumns())sheet.insertColumnsAfter(sheet.getMaxColumns(),col-sheet.getMaxColumns());sheet.getRange(1,col).setValue(names[i]);columns[i]=col;});
  return columns;
}
function zipMappedRows_(sheet,columns,start,length){
  if(!length)return [];var raw=sheet.getRange(start,1,length,Math.max.apply(null,columns)).getDisplayValues();
  return raw.map(function(row){return columns.map(function(col){return col?row[col-1]||'':'';});});
}
function zipWriteMapped_(sheet,columns,row,values){
  var before=zipMappedRows_(sheet,columns,row,1)[0],changes=[];
  values.forEach(function(value,i){if(!columns[i]||String(value)===before[i])return;var cell=sheet.getRange(row,columns[i]);if(cell.getFormulas()[0][0])throw zipRegistryError_('REGISTRY_FORMULA');changes.push({cell:cell,value:String(value)});});
  changes.forEach(function(change){change.cell.setNumberFormat('@').setValue(/^[=+@-]/.test(change.value)?"'"+change.value:change.value);});
}
function zipRegistrySheet_(kind,setup) {
  var def=zipRegistryDefinition_(kind),sheet=zipSheet_().getSheetByName(def.name);
  if(!sheet)throw zipRegistryError_('REGISTRY_SETUP');
  var count=def.headers.length,names=def.headers.concat(ZIP_REGISTRY_META),columns=zipColumns_(sheet,names,kind==='numbers'?['경면']:[],setup?names:ZIP_REGISTRY_META);
  if(kind==='numbers'&&columns[2])sheet.hideColumns(columns[2]);
  ZIP_REGISTRY_META.forEach(function(_,i){sheet.hideColumns(columns[count+i]);});
  if(sheet.getLastRow()>10001)throw zipRegistryError_('REGISTRY_LIMIT');
  var length=Math.max(0,sheet.getLastRow()-1),rows=zipMappedRows_(sheet,columns,2,length),seen={};
  rows.forEach(function(row,i){
    if(!row.slice(0,count).some(function(v){return v!=='';}))return;
    if(!row[count]){row[count]=Utilities.getUuid();sheet.getRange(i+2,columns[count]).setValue(row[count]);}
    if(!/^[a-zA-Z0-9-]{20,80}$/.test(row[count])||seen[row[count]])throw zipRegistryError_('REGISTRY_IDS');
    seen[row[count]]=true;
  });
  return {sheet:sheet,rows:rows,count:count,definition:def,columns:columns};
}
function zipRegistryVersion_(row,count) {return zipHash_(JSON.stringify(row.slice(0,count).concat(row[count+2]||'')));}
function zipRegistryItem_(row,count) {return {id:row[count],values:count===4?[row[0],row[1],row[3]]:row.slice(0,count),version:zipRegistryVersion_(row,count)};}
function zipRegistryData_() {
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    var result={ok:true,syncedAt:new Date().toISOString(),lists:{},statuses:[]};
    Object.keys(ZIP_REGISTRY).forEach(function(kind){var data=zipRegistrySheet_(kind);result.lists[kind]={headers:kind==='numbers'?['종이넘버','스펙넘버','비고']:data.definition.headers,items:data.rows.filter(function(r){return r[data.count]&&!r[data.count+2]&&r.slice(0,data.count).some(function(v){return v!=='';});}).map(function(r){return zipRegistryItem_(r,data.count);})};
      if(kind==='sites'){var rule=data.sheet.getRange(2,data.columns[7]).getDataValidation();if(rule&&rule.getCriteriaType()===SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST)result.statuses=rule.getCriteriaValues()[0];}
    });result.mapItems=zipSpecs_();result.unifiedSites=true;return result;
  }finally{lock.releaseLock();}
}
function zipRegistryInput_(body) {
  var def=zipRegistryDefinition_(body.kind);
  if(!/^[a-zA-Z0-9-]{20,80}$/.test(body.id||'')||!Array.isArray(body.values)||(body.values.length!==def.headers.length&&!(body.kind==='numbers'&&body.values.length===3)))throw zipRegistryError_('REGISTRY_INPUT');
  var values=body.values.map(function(v){if(typeof v!=='string'||v.length>4000)throw zipRegistryError_('REGISTRY_INPUT');return v.trim();});
  if(!values[0]||(body.kind==='sites'?!values[1]&&!values[2]:!values[1]))throw zipRegistryError_('REGISTRY_INPUT');
  return values;
}
function zipSaveRegistry_(body) {
  var values=zipRegistryInput_(body),lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    var data=zipRegistrySheet_(body.kind),rowIndex=data.rows.findIndex(function(r){return r[data.count]===body.id;}),previous=rowIndex<0?null:data.rows[rowIndex];
    if(body.kind==='numbers'&&values.length===3)values=[values[0],values[1],previous?previous[2]:'',values[2]];
    if(body.kind==='sites'){values=zipFillRegistryPair_(values);zipValidateSiteLists_(values);}
    if(previous&&previous[data.count+2])throw zipRegistryError_('REGISTRY_CONFLICT');
    // Safe response-loss retries: an identical write with the same UUID is a no-op.
    if(previous&&JSON.stringify(previous.slice(0,data.count))===JSON.stringify(values))return {ok:true,item:zipRegistryItem_(previous,data.count)};
    if(previous&&body.version!==zipRegistryVersion_(previous,data.count))throw zipRegistryError_('REGISTRY_CONFLICT');
    if(!previous&&body.version)throw zipRegistryError_('REGISTRY_CONFLICT');
    var row=rowIndex<0?Math.max(2,data.sheet.getLastRow()+1):rowIndex+2;
    if(row>data.sheet.getMaxRows())data.sheet.insertRowsAfter(data.sheet.getMaxRows(),1);
    values.forEach(function(value,i){
      if(!data.columns[i]||previous&&value===previous[i])return;
      var cell=data.sheet.getRange(row,data.columns[i]);if(cell.getFormulas()[0][0])throw zipRegistryError_('REGISTRY_FORMULA');
      var rule=cell.getDataValidation();
      if(value&&rule&&rule.getCriteriaType()===SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST&&rule.getCriteriaValues()[0].indexOf(value)<0)throw zipRegistryError_('REGISTRY_VALIDATION');
    });
    zipWriteMapped_(data.sheet,data.columns,row,values.concat([body.id,new Date().toISOString(),'']));
    SpreadsheetApp.flush();var saved=zipMappedRows_(data.sheet,data.columns,row,1)[0];
    return {ok:true,item:zipRegistryItem_(saved,data.count)};
  }finally{lock.releaseLock();}
}
function zipRegistryMatches_(paper,spec,rows) {
  var key=function(v){return String(v||'').normalize('NFKC').trim().toLowerCase();};
  return rows.filter(function(row){return !row[6]&&((paper&&key(row[0])===key(paper))||(spec&&key(row[1])===key(spec)));});
}
function zipFillRegistryPair_(values,masterRows) {
  if(values[1]&&values[2]||!values[1]&&!values[2])return values;
  var rows=masterRows||zipRegistrySheet_('numbers').rows,paper=!!values[1],tokens=String(paper?values[1]:values[2]).split(/[,\n\r]+/).map(function(s){return s.trim();}).filter(Boolean),matches=[];
  for(var i=0;i<tokens.length;i++){var pairs={};zipRegistryMatches_(paper?tokens[i]:'',paper?'':tokens[i],rows).forEach(function(r){pairs[JSON.stringify([r[0],r[1]])]=r;});var keys=Object.keys(pairs);if(keys.length!==1)return values;matches.push(pairs[keys[0]]);}
  values[1]=matches.map(function(r){return r[0];}).join('\n');values[2]=matches.map(function(r){return r[1];}).join('\n');return values;
}
function zipValidateSiteLists_(values){
  var split=function(v){return String(v||'').split(/[,\n\r]+/).map(function(s){return s.trim();}).filter(Boolean);},papers=split(values[1]),specs=split(values[2]),mirrors=split(values[3]);
  if(papers.length>50||specs.length>50||mirrors.length>50||papers.length&&specs.length&&papers.length!==specs.length)throw zipRegistryError_('REGISTRY_INPUT');
  if(mirrors.length>1&&mirrors.length!==Math.max(papers.length,specs.length))throw zipRegistryError_('REGISTRY_INPUT');
}
function zipAutofillRegistrySheet_(e) {
  var sheet=e.range.getSheet();if(sheet.getName()!==ZIP_REGISTRY.sites.name||e.range.getRow()<2||e.range.getNumRows()>200)return;
  var columns=zipColumns_(sheet,ZIP_REGISTRY.sites.headers,[],[]),column=e.range.getColumn(),last=e.range.getLastColumn(),paperEdited=columns[1]>=column&&columns[1]<=last,specEdited=columns[2]>=column&&columns[2]<=last;
  if(!paperEdited&&!specEdited)return;
  var master=zipRegistrySheet_('numbers').rows;
  for(var r=e.range.getRow();r<=e.range.getLastRow();r++){
    var values=zipMappedRows_(sheet,columns,r,1)[0],paper=paperEdited?values[1]:'',spec=paperEdited?'':values[2];
    if(paperEdited&&specEdited&&values[1]&&values[2])continue;
    var tokens=String(paper||spec).split(/[,\n\r]+/).map(function(v){return v.trim();}).filter(Boolean),filled=[],ambiguous=false;
    tokens.forEach(function(token){var pairs={};zipRegistryMatches_(paper?token:'',paper?'':token,master).forEach(function(v){pairs[JSON.stringify([v[0],v[1]])]=v;});var keys=Object.keys(pairs);if(keys.length!==1)ambiguous=true;else filled.push(pairs[keys[0]][paper?1:0]);});
    if(ambiguous||!tokens.length)continue;var target=paperEdited?columns[2]:columns[1],cell=sheet.getRange(r,target);if(cell.getFormulas()[0][0])continue;
    cell.setNumberFormat('@').setValue(zipSafeCell_(filled.join('\n')));
  }
}
function zipDeleteRegistry_(body) {
  zipRegistryDefinition_(body.kind);if(!/^[a-zA-Z0-9-]{20,80}$/.test(body.id||''))throw zipRegistryError_('REGISTRY_INPUT');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var data=zipRegistrySheet_(body.kind),index=data.rows.findIndex(function(r){return r[data.count]===body.id;});if(index<0)throw zipRegistryError_('REGISTRY_CONFLICT');var row=data.rows[index];
    if(row[data.count+2])return {ok:true};if(body.version!==zipRegistryVersion_(row,data.count))throw zipRegistryError_('REGISTRY_CONFLICT');
    data.sheet.getRange(index+2,data.columns[data.count+2]).setValue(new Date().toISOString());return {ok:true};
  }finally{lock.releaseLock();}
}
function syncSpecRegistryDaily() {var data=zipRegistryData_();PropertiesService.getScriptProperties().setProperty('registry-synced-at',data.syncedAt);if(typeof zipReadCache_==='function')zipReadCache_('registry',true,function(){return data;});if(typeof zipNotes_==='function')zipNotes_(true);}
function setupSpecRegistryDaily() {
  // Does not change existing note/checklist triggers.
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='syncSpecRegistryDaily';}))ScriptApp.newTrigger('syncSpecRegistryDaily').timeBased().everyDays(1).atHour(7).create();
  syncSpecRegistryDaily();
}
