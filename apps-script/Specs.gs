// Private admin-only site specifications. KAKAO_REST_API_KEY is a Script Property, never public JS.
var ZIP_SPEC_HEADERS = ['ID','현장명','주소','설계사','담당자','건설사','M/H 오픈날','완공 연월','위도','경도','사진 ID','종이 목록(JSON)','수정일','삭제일'];
function zipSpecSheet_() {
  var ss=zipSheet_(), sh=ss.getSheetByName('내 스펙관리');
  if(!sh){sh=ss.insertSheet('내 스펙관리');sh.getRange(1,1,1,14).setValues([ZIP_SPEC_HEADERS]);sh.getRange('A:N').setNumberFormat('@');sh.setFrozenRows(1);}
  var headers=sh.getRange(1,1,1,14).getDisplayValues()[0];
  if(!ZIP_SPEC_HEADERS.every(function(h,i){return headers[i]===h;}))throw new Error('Invalid spec headers');
  return sh;
}
function zipSpecs_() {
  var data=zipUnifiedSiteSheet_(),sh=data.sheet;if(sh.getLastRow()<2)return [];
  return sh.getRange(2,1,sh.getLastRow()-1,21).getDisplayValues().filter(function(r){return r[9]&&!r[11]&&r[0];}).map(function(r){
    return {id:r[9],name:r[0],address:r[12],designer:r[6],contact:r[13],builder:r[14],openMonth:r[4].slice(0,7),completionMonth:r[5].slice(0,7),lat:r[15]===''?null:Number(r[15]),lng:r[16]===''?null:Number(r[16]),images:r[17].split('|').filter(Boolean),imageUrls:zipReadablePhotoUrls_(r[20]),papers:zipSitePapers_(r),updatedAt:r[10]};
  });
}
var ZIP_SITE_EXTRA=['주소','담당자','건설사','위도','경도','사진 ID','이전 스펙 상세(JSON)','통합 원본 ID','사진 URL'];
function zipSplitList_(value){return String(value||'').split(/[,\n\r]+/).map(function(v){return v.trim();}).filter(Boolean);}
function zipPhotoUrls_(value){var values=Array.isArray(value)?value:String(value||'').split(/[\r\n]+/).map(function(s){return s.trim();}).filter(Boolean);if(values.length>12)throw new Error('사진 URL은 최대 12장입니다.');return values.map(function(v){v=String(v).trim();if(v.length>2000||!/^https:\/\/[^\s<>"']+$/i.test(v))throw new Error('HTTPS 사진 URL을 입력해 주세요.');return v;});}
// A mistyped URL entered directly in Sheets must not prevent every site from loading.
function zipReadablePhotoUrls_(value){return String(value||'').split(/[\r\n]+/).map(function(v){return v.trim();}).filter(function(v){return v.length<=2000&&/^https:\/\/[^\s<>"']+$/i.test(v);}).slice(0,12);}
function zipSitePapers_(r){
  var numbers=zipSplitList_(r[1]),specs=zipSplitList_(r[2]),mirrors=zipSplitList_(r[3]),length=Math.max(numbers.length,specs.length),old=[];
  try{old=JSON.parse(r[18]||'[]');}catch(ignore){}
  var mirrorLines=String(r[3]||'').replace(/\r\n?/g,'\n').split('\n').map(function(v){return v.trim();});
  if(mirrorLines.length===length&&!String(r[3]||'').includes(','))mirrors=mirrorLines;
  return Array.from({length:length},function(_,i){return {number:numbers[i]||'',spec:specs[i]||numbers[i]||'',mirror:mirrors.length===1?mirrors[0]:mirrors[i]||'',area:old[i]?.area||'',specMode:true};});
}
function zipUnifiedSiteSheet_(){
  var data=zipRegistrySheet_('sites'),sheet=data.sheet;
  if(sheet.getMaxColumns()<21)sheet.insertColumnsAfter(sheet.getMaxColumns(),21-sheet.getMaxColumns());
  var headers=sheet.getRange(1,13,1,9).getDisplayValues()[0];
  if(!ZIP_SITE_EXTRA.every(function(h,i){return headers[i]===h;})){
    if(headers.some(function(v,i){return v&&v!==ZIP_SITE_EXTRA[i];}))throw new Error('현장별 관리 확장 열을 확인해 주세요.');
    if(sheet.getMaxColumns()<21)sheet.insertColumnsAfter(sheet.getMaxColumns(),21-sheet.getMaxColumns());
    sheet.getRange(1,13,1,9).setValues([ZIP_SITE_EXTRA]);sheet.hideColumns(18,3);sheet.setColumnWidth(21,280);
    var oldFilter=sheet.getFilter(),criteria=[];if(oldFilter){for(var c=1;c<=9;c++)criteria[c]=oldFilter.getColumnFilterCriteria(c);oldFilter.remove();}
    var filter=sheet.getRange(1,1,sheet.getMaxRows(),21).createFilter();criteria.forEach(function(rule,i){if(rule)filter.setColumnFilterCriteria(i,rule);});
  }return data;
}
function migrateUnifiedSites(){
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var data=zipUnifiedSiteSheet_(),target=data.sheet,old=zipSheet_().getSheetByName('내 스펙관리');if(!old)return;
    var existing=target.getLastRow()>1?target.getRange(2,1,target.getLastRow()-1,21).getDisplayValues():[];
    var source=old.getLastRow()>1?old.getRange(2,1,old.getLastRow()-1,14).getDisplayValues():[];
    source.filter(function(r){return r[0]&&!r[13];}).forEach(function(r){
      if(existing.some(function(v){return v[9]===r[0]||v[19]===r[0];}))return;
      var papers=[];try{papers=JSON.parse(r[11]||'[]');}catch(ignore){}
      var matches=existing.map(function(v,i){return {v:v,i:i};}).filter(function(x){return x.v[0]===r[1]&&!x.v[11];});
      var row=matches.length===1?matches[0].v.slice():Array(21).fill(''),at=matches.length===1?matches[0].i+2:target.getLastRow()+1;
      while(row.length<21)row.push('');
      var proposed=[r[1],papers.map(function(p){return p.number||'';}).join('\n'),papers.map(function(p){return p.spec||p.number||'';}).join('\n'),papers.map(function(p){return p.mirror||'';}).join('\n'),r[6],r[7],r[3]];
      proposed.forEach(function(v,i){if(!row[i])row[i]=v;});row[9]=row[9]||r[0];row[10]=row[10]||r[12];
      [r[2],r[4],r[5],r[8],r[9],r[10],r[11],r[0],''].forEach(function(v,i){if(!row[12+i])row[12+i]=v;});
      if(at>target.getMaxRows())target.insertRowsAfter(target.getMaxRows(),1);
      target.getRange(at,1,1,21).setNumberFormat('@').setValues([row.map(zipSafeCell_)]);if(matches.length===1)existing[matches[0].i]=row;else existing.push(row);
    });
    SpreadsheetApp.flush();old.hideSheet();zipInvalidateRead_(['specs','registry']);console.log('현장별 관리로 통합 완료. 원본은 숨김 보존했습니다.');
  }finally{lock.releaseLock();}
}
function zipSpecInput_(b) {
  var x={};['name','address','designer','contact','builder','openMonth','completionMonth'].forEach(function(k){x[k]=String(b[k]||'').trim();if(x[k].length>300)throw new Error('Too long');});
  if(!x.name||!x.address)throw new Error('Name and address required');
  ['openMonth','completionMonth'].forEach(function(k){if(x[k]&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(x[k]))throw new Error('Invalid month');});
  x.lat=Number(b.lat);x.lng=Number(b.lng);
  if(b.lat==null||b.lng==null||b.lat===''||b.lng===''||!isFinite(x.lat)||!isFinite(x.lng)||x.lat<32||x.lat>39.5||x.lng<124||x.lng>132.5)throw new Error('Select location in Korea');
  if(!Array.isArray(b.papers)||b.papers.length>50)throw new Error('Invalid papers');
  x.papers=b.papers.map(function(p){var row={};['number','area','spec','mirror'].forEach(function(k){row[k]=String(p[k]||'').trim();if(row[k].length>300)throw new Error('Too long');});if(p.specMode===true){if(!row.spec)throw new Error('Specification number required');row.specMode=true;}else if(!row.number)throw new Error('Paper number required');return row;});
  x.images=b.images||[];if(!Array.isArray(x.images)||x.images.length>4||x.images.some(function(v){return typeof v!=='string'||!/^[-\w]{10,200}$/.test(v);}))throw new Error('Invalid images');
  x.imageUrls=zipPhotoUrls_(b.imageUrls||[]);
  return x;
}
function zipSaveSpec_(b) {
  var x=zipSpecInput_(b),lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var sh=zipUnifiedSiteSheet_().sheet,id=String(b.id||''),row=sh.getLastRow()+1,previous=Array(21).fill('');
    if(id){var ids=sh.getRange(2,1,Math.max(1,sh.getLastRow()-1),21).getDisplayValues();var index=ids.findIndex(function(r){return r[9]===id&&!r[11];});if(index<0)throw new Error('Unknown spec');row=index+2;previous=ids[index];}else{id=Utilities.getUuid();}
    // Only images already stored in the configured private upload folder may be attached.
    var folderId=x.images.length?zipImageFolder_().getId():'';
    x.images.forEach(function(image){var parents=DriveApp.getFileById(image).getParents(),found=false;while(parents.hasNext()){if(parents.next().getId()===folderId)found=true;}if(!found)throw new Error('Foreign image');});
    var values=[x.name,x.papers.map(function(p){return p.number;}).join('\n'),x.papers.map(function(p){return p.spec||p.number;}).join('\n'),x.papers.map(function(p){return p.mirror;}).join('\n'),x.openMonth,x.completionMonth,x.designer,previous[7]||'',previous[8]||'',id,new Date().toISOString(),'',x.address,x.contact,x.builder,String(x.lat),String(x.lng),x.images.join('|'),JSON.stringify(x.papers),previous[19]||'',x.imageUrls.join('\n')];
    if(row>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),1);
    sh.getRange(row,1,1,21).setNumberFormat('@').setValues([values.map(zipSafeCell_)]);SpreadsheetApp.flush();
    return {ok:true,id:id};
  }finally{lock.releaseLock();}
}
function zipDeleteSpec_(id) {
  return zipDeleteRegistry_({kind:'sites',id:String(id),version:zipRegistryVersion_(zipUnifiedSiteSheet_().rows.find(function(r){return r[9]===String(id);})||[],9)});
}
function zipGeocodeSpec_(address) {
  address=String(address||'').trim();if(!address||address.length>300)throw new Error('Invalid address');
  var key=PropertiesService.getScriptProperties().getProperty('KAKAO_REST_API_KEY');
  if(!key)return {ok:true,configured:false,locations:[]};
  var cache=CacheService.getScriptCache(),cacheKey='specgeo:'+zipHash_(address),hit=cache.get(cacheKey);if(hit)return JSON.parse(hit);
  var response=UrlFetchApp.fetch('https://dapi.kakao.com/v2/local/search/address.json?query='+encodeURIComponent(address)+'&size=5',{headers:{Authorization:'KakaoAK '+key},muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('Geocoder unavailable');
  var result={ok:true,configured:true,locations:(JSON.parse(response.getContentText()).documents||[]).map(function(d){return {address:d.address_name,lat:Number(d.y),lng:Number(d.x)};})};
  cache.put(cacheKey,JSON.stringify(result),21600);return result;
}
function zipSpecImage_(id) {
  if(!/^[-\w]{10,200}$/.test(String(id))||!zipSpecs_().some(function(s){return s.images.indexOf(id)>=0;}))throw new Error('Unknown spec image');
  var file=DriveApp.getFileById(id),mime=file.getMimeType();if(!/^image\/(png|jpeg|webp)$/.test(mime)||file.getSize()>4*1024*1024)throw new Error('Invalid image');
  return {ok:true,mime:mime,base64:Utilities.base64Encode(file.getBlob().getBytes())};
}
