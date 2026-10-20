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
  var sh=zipSpecSheet_();if(sh.getLastRow()<2)return [];
  return sh.getRange(2,1,sh.getLastRow()-1,14).getDisplayValues().filter(function(r){return r[0]&&!r[13];}).map(function(r){
    var papers;try{papers=JSON.parse(r[11]||'[]');}catch(e){papers=[];}
    return {id:r[0],name:r[1],address:r[2],designer:r[3],contact:r[4],builder:r[5],openMonth:r[6],completionMonth:r[7],lat:r[8]===''?null:Number(r[8]),lng:r[9]===''?null:Number(r[9]),images:r[10].split('|').filter(Boolean),papers:Array.isArray(papers)?papers:[],updatedAt:r[12]};
  });
}
function zipSpecInput_(b) {
  var x={};['name','address','designer','contact','builder','openMonth','completionMonth'].forEach(function(k){x[k]=String(b[k]||'').trim();if(x[k].length>300)throw new Error('Too long');});
  if(!x.name||!x.address)throw new Error('Name and address required');
  ['openMonth','completionMonth'].forEach(function(k){if(x[k]&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(x[k]))throw new Error('Invalid month');});
  x.lat=Number(b.lat);x.lng=Number(b.lng);
  if(b.lat==null||b.lng==null||b.lat===''||b.lng===''||!isFinite(x.lat)||!isFinite(x.lng)||x.lat<32||x.lat>39.5||x.lng<124||x.lng>132.5)throw new Error('Select location in Korea');
  if(!Array.isArray(b.papers)||b.papers.length>50)throw new Error('Invalid papers');
  x.papers=b.papers.map(function(p){var row={};['number','area','spec'].forEach(function(k){row[k]=String(p[k]||'').trim();if(row[k].length>300)throw new Error('Too long');});if(!row.number)throw new Error('Paper number required');return row;});
  x.images=b.images||[];if(!Array.isArray(x.images)||x.images.length>4||x.images.some(function(v){return typeof v!=='string'||!/^[-\w]{10,200}$/.test(v);}))throw new Error('Invalid images');
  return x;
}
function zipSaveSpec_(b) {
  var x=zipSpecInput_(b),lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var sh=zipSpecSheet_(),id=String(b.id||''),row=sh.getLastRow()+1;
    if(id){var ids=sh.getRange(2,1,Math.max(1,sh.getLastRow()-1),14).getDisplayValues();var index=ids.findIndex(function(r){return r[0]===id&&!r[13];});if(index<0)throw new Error('Unknown spec');row=index+2;}else{id=Utilities.getUuid();}
    // Only images already stored in the configured private upload folder may be attached.
    var folderId=zipImageFolder_().getId();
    x.images.forEach(function(image){var parents=DriveApp.getFileById(image).getParents(),found=false;while(parents.hasNext()){if(parents.next().getId()===folderId)found=true;}if(!found)throw new Error('Foreign image');});
    var values=[id,x.name,x.address,x.designer,x.contact,x.builder,x.openMonth,x.completionMonth,String(x.lat),String(x.lng),x.images.join('|'),JSON.stringify(x.papers),new Date().toISOString(),''];
    sh.getRange(row,1,1,14).setNumberFormat('@').setValues([values.map(zipSafeCell_)]);SpreadsheetApp.flush();
    return {ok:true,id:id};
  }finally{lock.releaseLock();}
}
function zipDeleteSpec_(id) {
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var sh=zipSpecSheet_(),rows=sh.getRange(2,1,Math.max(1,sh.getLastRow()-1),14).getDisplayValues();var index=rows.findIndex(function(r){return r[0]===String(id)&&!r[13];});if(index<0)throw new Error('Unknown spec');sh.getRange(index+2,14).setValue(new Date().toISOString());return {ok:true};}finally{lock.releaseLock();}
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
