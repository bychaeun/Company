// Both registries live in the existing COMPANY workbook. No public sheet export.
var ZIP_REGISTRY = {
  numbers:{name:'스펙번호 관리',headers:['종이넘버','스펙넘버','경면','비고']},
  sites:{name:'내 스펙관리',headers:['현장명','종이넘버','스펙넘버','경면','모델하우스 예정일','본납 예정일','설계사','진행상태','비고']}
};
var ZIP_REGISTRY_META=['관리 ID','앱 수정일','앱 삭제일'];
function zipRegistryError_(code) {var error=new Error(code);error.zipCode=code;return error;}
function zipRegistryDefinition_(kind) {if(!Object.prototype.hasOwnProperty.call(ZIP_REGISTRY,kind))throw zipRegistryError_('REGISTRY_INPUT');return ZIP_REGISTRY[kind];}
var ZIP_HEADER_ALIASES={'종이넘버':['종이번호','종이No','종이넘버(No)'],'스펙넘버':['스펙번호','스펙No'],'관리 ID':['ID'],'앱 수정일':['수정일'],'앱 삭제일':['삭제일'],'모델하우스 예정일':['M/H 오픈날'],'본납 예정일':['완공 연월'],'이전 스펙 상세(JSON)':['종이 목록(JSON)'],'건설사':['건설사 이름','건설사명']};
// Tab names are matched without spaces or case, so '스펙번호관리' and '스펙번호 관리' are the same tab.
function zipFindSheet_(name){
  var ss=zipSheet_(),exact=ss.getSheetByName(name);if(exact)return exact;
  var key=zipHeaderKey_(name),found=ss.getSheets().filter(function(sh){return zipHeaderKey_(sh.getName())===key;});
  return found.length===1?found[0]:null;
}
function zipHeaderKey_(value){return String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();}
// Resolve physical columns once; all row arrays below retain the stable logical field order.
function zipColumns_(sheet,names,optional,create){
  var width=Math.max(1,sheet.getLastColumn()),headers=sheet.getRange(1,1,1,width).getDisplayValues()[0],columns=[],missing=[];
  names.forEach(function(name,i){
    // The exact title wins; alternative titles are only used when the exact one is absent.
    var own=zipHeaderKey_(name),keys=(ZIP_HEADER_ALIASES[name]||[]).map(zipHeaderKey_),matches=[];
    headers.forEach(function(h,j){if(h&&zipHeaderKey_(h)===own)matches.push(j+1);});
    if(!matches.length)headers.forEach(function(h,j){if(h&&keys.indexOf(zipHeaderKey_(h))>=0)matches.push(j+1);});
    if(matches.length>1)throw zipRegistryError_('REGISTRY_HEADERS');
    columns[i]=matches[0]||0;
    if(!columns[i]&&(optional||[]).indexOf(name)<0){if((create||[]).indexOf(name)<0)throw zipRegistryError_('REGISTRY_HEADERS');missing.push(i);}
  });
  // Validate the whole schema before appending; never overwrite user columns.
  missing.forEach(function(i){var col=++width;if(col>sheet.getMaxColumns())sheet.insertColumnsAfter(sheet.getMaxColumns(),col-sheet.getMaxColumns());sheet.getRange(1,col).setValue(names[i]);columns[i]=col;if(ZIP_REGISTRY_META.indexOf(names[i])>=0)sheet.hideColumns(col);});
  return columns;
}
// Sort the record block together, leaving unrelated reference tables to its right alone.
function zipRegistryFilter_(sheet,columns){
  var end=Math.max.apply(null,columns),rows=sheet.getMaxRows(),filter=sheet.getFilter(),criteria=[];
  if(filter){if(typeof filter.getRange!=='function')return;var range=filter.getRange();if(range.getColumn()===1&&range.getLastColumn()===end&&range.getRow()===1&&range.getNumRows()===rows)return;
    for(var c=range.getColumn();c<=Math.min(end,range.getLastColumn());c++)criteria[c]=filter.getColumnFilterCriteria(c);filter.remove();}
  var full=sheet.getRange(1,1,rows,end).createFilter();criteria.forEach(function(rule,i){if(rule)full.setColumnFilterCriteria(i,rule);});
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
function zipRegistrySheet_(kind,setup,extras) {
  var def=zipRegistryDefinition_(kind),sheet=zipFindSheet_(def.name);
  if(!sheet)throw zipRegistryError_('REGISTRY_SETUP');
  var count=def.headers.length,names=def.headers.concat(ZIP_REGISTRY_META,extras||[]),optional=kind==='numbers'?['경면']:['사진 ID'],columns=zipColumns_(sheet,names,optional,setup?names:ZIP_REGISTRY_META.concat(extras||[]));
  if(setup){if(kind==='numbers'&&columns[2])sheet.hideColumns(columns[2]);ZIP_REGISTRY_META.forEach(function(_,i){sheet.hideColumns(columns[count+i]);});}
  if(sheet.getLastRow()>10001)throw zipRegistryError_('REGISTRY_LIMIT');
  var length=Math.max(0,sheet.getLastRow()-1),rows=zipMappedRows_(sheet,columns,2,length),seen={},fixed=[],restored=[];
  // Rows typed or pasted directly into the sheet get an ID here. A row copied together with the hidden
  // ID/삭제일 columns gets a fresh ID instead of breaking the whole list.
  rows.forEach(function(row,i){
    // The sheet is the source of truth: deleting in the app now removes the row, so an old hidden
    // '앱 삭제일' stamp from the previous soft-delete no longer hides a row that is still in the sheet.
    row[count+2]='';
    if(!row.slice(0,count).some(function(v){return v!=='';}))return;
    if(!row[count]){row[count]=Utilities.getUuid();fixed.push(i);}
    else if(!/^[a-zA-Z0-9-]{20,80}$/.test(row[count])||seen[row[count]]){row[count]=Utilities.getUuid();fixed.push(i);if(row[count+2]){row[count+2]='';restored.push(i);}}
    seen[row[count]]=true;
  });
  if(fixed.length){
    var idCol=columns[count],delCol=columns[count+2];
    sheet.getRange(2,idCol,rows.length,1).setValues(rows.map(function(r){return [r[count]];}));
    if(delCol)restored.forEach(function(i){sheet.getRange(i+2,delCol).setValue('');});
  }
  return {sheet:sheet,rows:rows,count:count,definition:def,columns:columns};
}
function zipRegistryVersion_(row,count) {return zipHash_(JSON.stringify(row.slice(0,count).concat(row[count+2]||'')));}
function zipRegistryItem_(row,count) {return {id:row[count],values:count===4?[row[0],row[1],row[3]]:row.slice(0,count),version:zipRegistryVersion_(row,count)};}
function zipRegistryData_() {
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    var result={ok:true,syncedAt:new Date().toISOString(),lists:{},statuses:[]};
    var siteData;
    Object.keys(ZIP_REGISTRY).forEach(function(kind){var data=kind==='sites'?zipUnifiedSiteSheet_():zipRegistrySheet_(kind,false,['종이 이미지 URL']);if(kind==='sites')siteData=data;result.lists[kind]={headers:kind==='numbers'?['종이넘버','스펙넘버','비고']:data.definition.headers,items:data.rows.filter(function(r){return r[data.count]&&!r[data.count+2]&&r.slice(0,data.count).some(function(v){return v!=='';});}).map(function(r){var item=zipRegistryItem_(r,data.count),raw=r[kind==='numbers'?7:20]||'';item.imageUrls=zipReadablePhotoUrls_(raw);item.photoVersion=zipHash_(raw);if(kind==='numbers'&&!item.imageUrls.length){var auto=zipHyosanPaperUrls_(item.values[0]);if(auto.length){item.imageUrls=auto;item.autoImages=true;}}return item;})};
      if(kind==='sites'){var rule=data.sheet.getRange(2,data.columns[7]).getDataValidation();if(rule&&rule.getCriteriaType()===SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST)result.statuses=rule.getCriteriaValues()[0];}
      if(kind==='numbers'){
        zipRegistryFilter_(data.sheet,data.columns);
        result.guide=zipRegistryGuide_(data.sheet,Math.max.apply(null,data.columns));
      }
    });result.hyosanNames=zipHyosanProductNames_();result.hyosanPapers=ZIP_HYOSAN_STATUS;result.mapItems=zipSpecItems_(siteData);result.unifiedSites=true;result.registryPhotoUrls=true;result.paperPhotoUrls=true;return result;
  }finally{lock.releaseLock();}
}
// A small reference table typed to the right of the number list (e.g. 단색 | HS00-HS19) is shown in the app.
function zipRegistryGuide_(sheet,width) {
  var lastCol=sheet.getLastColumn(),lastRow=sheet.getLastRow();if(lastCol<=width||lastRow<1)return [];
  var cols=Math.min(10,lastCol-width),values=sheet.getRange(1,width+1,Math.min(lastRow,100),cols).getDisplayValues();
  var used=[];for(var c=0;c<cols;c++)if(values.some(function(r){return String(r[c]).trim();}))used.push(c);
  return values.map(function(r){return used.map(function(c){return String(r[c]).trim();});}).filter(function(r){return r.some(Boolean);}).slice(0,50);
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
    var photos=null;
    if(Object.prototype.hasOwnProperty.call(body,'imageUrls')){
      if(!Array.isArray(body.imageUrls))throw zipRegistryError_('REGISTRY_INPUT');
      var urls;try{urls=zipPhotoUrls_(body.imageUrls);}catch(error){throw zipRegistryError_('REGISTRY_INPUT');}
      var photoHeader=body.kind==='numbers'?'종이 이미지 URL':'사진 URL',photoColumn=zipColumns_(data.sheet,[photoHeader],[],[photoHeader])[0],before=rowIndex<0?'':data.sheet.getRange(rowIndex+2,photoColumn).getDisplayValues()[0][0],after=urls.join('\n');
      if(previous&&after!==before&&body.photoVersion!==zipHash_(before))throw zipRegistryError_('REGISTRY_CONFLICT');
      photos={column:photoColumn,before:before,after:after,urls:urls};
    }
    if(body.kind==='numbers'&&(!photos||!photos.after)){
      // 종이 이미지가 비어 있으면 효산 저장소 시트에서 같은 종이넘버의 이미지를 가져와 채운다(직접 지운 이미지는 다시 채우지 않음).
      var autoUrls=zipHyosanPaperUrls_(values[0]);
      if(autoUrls.length){var autoColumn=photos?photos.column:zipColumns_(data.sheet,['종이 이미지 URL'],[],['종이 이미지 URL'])[0],autoBefore=photos?photos.before:(rowIndex<0?'':data.sheet.getRange(rowIndex+2,autoColumn).getDisplayValues()[0][0]);
        if(!autoBefore)photos={column:autoColumn,before:'',after:autoUrls.join('\n'),urls:autoUrls};}
    }
    if(previous&&previous[data.count+2])throw zipRegistryError_('REGISTRY_CONFLICT');
    // Safe response-loss retries: an identical write with the same UUID is a no-op.
    if(previous&&JSON.stringify(previous.slice(0,data.count))===JSON.stringify(values)&&(!photos||photos.before===photos.after))return {ok:true,item:zipRegistrySavedItem_(previous,data.count,photos)};
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
    zipWriteMapped_(data.sheet,photos?data.columns.concat([photos.column]):data.columns,row,values.concat([body.id,new Date().toISOString(),''],photos?[photos.after]:[]));
    SpreadsheetApp.flush();var saved=zipMappedRows_(data.sheet,data.columns,row,1)[0];
    return {ok:true,item:zipRegistrySavedItem_(saved,data.count,photos)};
  }finally{lock.releaseLock();}
}
function zipRegistryMatches_(paper,spec,rows) {
  var key=function(v){return String(v||'').normalize('NFKC').trim().toLowerCase();};
  return rows.filter(function(row){return !row[6]&&((paper&&key(row[0])===key(paper))||(spec&&key(row[1])===key(spec)));});
}
function zipRegistrySavedItem_(row,count,photos){var item=zipRegistryItem_(row,count);if(photos){item.imageUrls=photos.urls;item.photoVersion=zipHash_(photos.after);}return item;}
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
  var sheet=e.range.getSheet();if(zipHeaderKey_(sheet.getName())!==zipHeaderKey_(ZIP_REGISTRY.sites.name)||e.range.getRow()<2||e.range.getNumRows()>200)return;
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
  // The row is removed from the sheet. IDs are stable UUIDs, so other rows are unaffected; a retry after a
  // lost response finds nothing left to delete and succeeds.
  try{var data=zipRegistrySheet_(body.kind),index=data.rows.findIndex(function(r){return r[data.count]===body.id;});if(index<0)return {ok:true};var row=data.rows[index];
    if(!row[data.count+2]&&body.version!==zipRegistryVersion_(row,data.count))throw zipRegistryError_('REGISTRY_CONFLICT');
    var photo=zipColumns_(data.sheet,[body.kind==='numbers'?'종이 이미지 URL':'사진 URL'],[body.kind==='numbers'?'종이 이미지 URL':'사진 URL'],[])[0]||0;
    zipDeleteRows_(data.sheet,[index+2],Math.max.apply(null,data.columns.concat([photo])));SpreadsheetApp.flush();return {ok:true};
  }finally{lock.releaseLock();}
}
function syncSpecRegistryDaily() {try{if(typeof cleanupDeletedRows==='function')cleanupDeletedRows();}catch(ignore){}var data=zipRegistryData_();PropertiesService.getScriptProperties().setProperty('registry-synced-at',data.syncedAt);if(typeof zipReadCache_==='function')zipReadCache_('registry',true,function(){return data;});if(typeof zipNotes_==='function')zipNotes_(true);}
function setupSpecRegistryDaily() {
  // Does not change existing note/checklist triggers.
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='syncSpecRegistryDaily';}))ScriptApp.newTrigger('syncSpecRegistryDaily').timeBased().everyDays(1).atHour(7).create();
  syncSpecRegistryDaily();
}

// ── 효산 저장소 연동: 효산 LPM 시트(HYOSAN_LPM)의 PaperNumber → ImageURL ──
// 같은 Google 계정의 효산 시트를 읽어 종이넘버별 Drive 이미지 ID를 만든다. 1시간 캐시.
// 다른 시트를 쓰려면 스크립트 속성 HYOSAN_SPREADSHEET_ID에 시트 ID를 넣는다.
var ZIP_HYOSAN_SHEET_DEFAULT='1RC-6ibPA86zaWOGt1rzgmQf9tLpT4OcgdI6K9XcUPTI',ZIP_HYOSAN_PAPERS=null,ZIP_HYOSAN_STATUS={count:0,error:''};
function zipPaperKey_(value){return String(value||'').normalize('NFKC').replace(/\s+/g,'').toUpperCase();}
function zipHyosanPaperMap_(){
  if(ZIP_HYOSAN_PAPERS)return ZIP_HYOSAN_PAPERS;
  var cache=null,key='hyosan-papers-v4',failed=false;
  try{cache=CacheService.getScriptCache();var packed=zipCacheGetChunks_(cache,key);if(packed){ZIP_HYOSAN_PAPERS=JSON.parse(packed);ZIP_HYOSAN_STATUS={count:Object.keys(ZIP_HYOSAN_PAPERS).length,error:'',cached:true};return ZIP_HYOSAN_PAPERS;}}catch(ignore){}
  var map={};
  try{
    var id=PropertiesService.getScriptProperties().getProperty('HYOSAN_SPREADSHEET_ID')||ZIP_HYOSAN_SHEET_DEFAULT;
    var sheet=SpreadsheetApp.openById(id).getSheetByName('HYOSAN_LPM'),values=sheet?sheet.getDataRange().getDisplayValues():[];
    var headers=(values[0]||[]).map(function(h){return String(h).trim();}),pi=headers.indexOf('PaperNumber'),ii=headers.indexOf('ImageURL'),ai=headers.indexOf('Active'),ni=headers.indexOf('ProductName'),oi=headers.indexOf('PreviousNames'),ki=headers.indexOf('Category');
    if(!sheet)throw new Error('HYOSAN_LPM 시트를 찾지 못했어요');if(pi<0||ii<0)throw new Error('PaperNumber/ImageURL 열을 찾지 못했어요');
    values.slice(1).forEach(function(row){
      if(ai>=0&&String(row[ai]).trim().toUpperCase()==='FALSE')return;
      var ids=[];String(row[ii]||'').split(/[\r\n]+/).forEach(function(url){var found=zipDriveId_(url.trim());if(found&&ids.indexOf(found)<0)ids.push(found);});
      var name=ni>=0?String(row[ni]||'').trim():'',previous=oi>=0?String(row[oi]||'').trim():'',kind=ki>=0?String(row[ki]||'').trim().toUpperCase():'';
      if(!ids.length&&!name&&!previous&&!kind)return;
      // 종이넘버별 [이미지 ID 목록, 현재 제품명(ProductName), 이전 제품명(PreviousNames), 종류(Category: SOLID·WOOD·STONE·FABRIC·FANTASY)]
      String(row[pi]||'').split(/[\r\n,;|\/]+/).map(zipPaperKey_).filter(function(k){return k&&k!=='-';}).forEach(function(k){var e=map[k];if(!e)map[k]=[ids.slice(0,4),name,previous,kind];else{if(!e[0].length)e[0]=ids.slice(0,4);if(!e[1])e[1]=name;if(!e[2])e[2]=previous;if(!e[3])e[3]=kind;}});
    });
  }catch(error){map={};failed=true;ZIP_HYOSAN_STATUS={count:0,error:String(error&&error.message||error).slice(0,200)};}
  if(!failed){ZIP_HYOSAN_STATUS={count:Object.keys(map).length,error:''};if(cache)try{zipCachePutChunks_(cache,key,JSON.stringify(map),3600);}catch(ignore){}}   // 실패는 캐시하지 않고 다음 요청에서 다시 시도
  return ZIP_HYOSAN_PAPERS=map;
}
function zipHyosanPaperUrls_(paper){
  var key=zipPaperKey_(paper);if(!key)return [];
  return ((zipHyosanPaperMap_()[key]||[])[0]||[]).map(function(id){return 'https://drive.google.com/thumbnail?id='+id+'&sz=w1000';});   // 공개 미리보기: 브라우저가 바로 받아 빠르다
}
// 앱에서 종이넘버를 입력하면 바로 제품명을 채울 수 있게 종이넘버 → [현재 제품명, 이전 제품명] 표를 보낸다.
function zipHyosanProductNames_(){
  var map=zipHyosanPaperMap_(),names={};
  Object.keys(map).forEach(function(k){var e=map[k];if(e[1]||e[2]||e[3])names[k]=[e[1]||'',e[2]||'',e[3]||''];});   // [제품명, 이전 제품명, 종류]
  return names;
}
