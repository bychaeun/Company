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
  var data=zipUnifiedSiteSheet_();
  return data.rows.filter(function(r){return r[9]&&!r[11]&&r[0];}).map(function(r){
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
function zipUnifiedSiteSheet_(setup){
  var data=zipRegistrySheet_('sites',setup),sheet=data.sheet,names=data.definition.headers.concat(ZIP_REGISTRY_META,ZIP_SITE_EXTRA);
  data.columns=zipColumns_(sheet,names,['사진 ID'],setup?names:ZIP_SITE_EXTRA);
  data.rows=zipMappedRows_(sheet,data.columns,2,Math.max(0,sheet.getLastRow()-1));
  [17,18,19].forEach(function(i){if(data.columns[i])sheet.hideColumns(data.columns[i]);});
  return data;
}
function migrateUnifiedSites(){
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var data=zipUnifiedSiteSheet_(true),target=data.sheet,existing=data.rows,old=zipSheet_().getSheetByName('현장별 관리');
    // Preserve the original map sheet's IDs, coordinates, photos and manually added builder column.
    existing.forEach(function(row,i){var papers=[];try{papers=JSON.parse(row[18]||'[]');}catch(ignore){}if(!Array.isArray(papers))throw new Error('기존 종이 목록을 확인해 주세요.');
      [1,2,3].forEach(function(col){if(!row[col])row[col]=papers.map(function(p){return col===1?p.number||'':col===2?p.spec||p.number||'':p.mirror||'';}).join('\n');});
      zipWriteMapped_(target,data.columns,i+2,row);
    });
    var source=[],sourceColumns;
    if(old){
      var names=data.definition.headers.concat(ZIP_REGISTRY_META,ZIP_SITE_EXTRA);
      sourceColumns=zipColumns_(old,names,ZIP_SITE_EXTRA,ZIP_REGISTRY_META);
      source=zipMappedRows_(old,sourceColumns,2,Math.max(0,old.getLastRow()-1));
      source.forEach(function(row,i){if(!row[0]||row[11])return;if(!row[9]){row[9]=Utilities.getUuid();old.getRange(i+2,sourceColumns[9]).setValue(row[9]);}
        if(existing.some(function(v){return v[9]===row[9]||v[19]===row[9];}))return;
        // Merge matching names only when populated fields agree; retain separate conflicting records.
        var matches=existing.map(function(v,j){return {v:v,i:j};}).filter(function(x){return x.v[0]===row[0]&&!x.v[11];});
        var match=matches.length===1&&row.every(function(v,j){return [9,10,11,19].indexOf(j)>=0||!v||!matches[0].v[j]||v===matches[0].v[j];})?matches[0]:null;
        var merged=match?match.v.map(function(v,j){return v||row[j]||'';}):row.slice(),at=match?match.i+2:target.getLastRow()+1;merged[19]=row[9];
        if(at>target.getMaxRows())target.insertRowsAfter(target.getMaxRows(),1);
        zipWriteMapped_(target,data.columns,at,merged);if(match)existing[match.i]=merged;else existing.push(merged);
      });
    }
    SpreadsheetApp.flush();
    var verified=zipMappedRows_(target,data.columns,2,Math.max(0,target.getLastRow()-1));
    if(source.some(function(row){return row[0]&&!row[11]&&!verified.some(function(v){return v[9]===row[9]||v[19]===row[9];});}))throw new Error('통합 확인 실패. 원본 시트를 유지합니다.');
    if(old)old.hideSheet();if(typeof target.showSheet==='function')target.showSheet();zipInvalidateRead_(['specs','registry']);console.log('내 스펙관리로 통합 완료. 현장별 관리 원본은 숨김 보존했습니다.');
  }finally{lock.releaseLock();}
}
function zipSpecInput_(b) {
  var x={};['name','address','designer','contact','builder','openMonth','completionMonth'].forEach(function(k){x[k]=String(b[k]||'').trim();if(x[k].length>300)throw new Error('Too long');});
  if(!x.name||!x.address)throw new Error('Name and address required');
  ['openMonth','completionMonth'].forEach(function(k){if(x[k]&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(x[k]))throw new Error('Invalid month');});
  x.lat=Number(b.lat);x.lng=Number(b.lng);
  if(b.lat==null||b.lng==null||b.lat===''||b.lng===''||!isFinite(x.lat)||!isFinite(x.lng)||x.lat<32||x.lat>39.5||x.lng<124||x.lng>132.5)throw new Error('Select location in Korea');
  if(!Array.isArray(b.papers)||b.papers.length>50)throw new Error('Invalid papers');
  x.papers=b.papers.map(function(p){var row={};['number','area','spec','mirror'].forEach(function(k){row[k]=String(p[k]||'').trim();if(row[k].length>300)throw new Error('Too long');});if(p.specMode===true){if(!row.spec&&!row.number)throw new Error('Paper or specification number required');row.specMode=true;}else if(!row.number)throw new Error('Paper number required');return row;});
  x.images=b.images||[];if(!Array.isArray(x.images)||x.images.length>4||x.images.some(function(v){return typeof v!=='string'||!/^[-\w]{10,200}$/.test(v);}))throw new Error('Invalid images');
  x.imageUrls=zipPhotoUrls_(b.imageUrls||[]);
  return x;
}
function zipSaveSpec_(b) {
  var x=zipSpecInput_(b),lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var data=zipUnifiedSiteSheet_(),sh=data.sheet,id=String(b.id||''),row=sh.getLastRow()+1,previous=Array(21).fill('');
    if(x.images.length&&!data.columns[17])throw new Error('사진은 URL로 입력해 주세요.');
    var master=x.papers.some(function(p){return !p.number||!p.spec;})?zipRegistrySheet_('numbers').rows:null;
    x.papers.forEach(function(p){var values=zipFillRegistryPair_(['',p.number,p.spec],master);p.number=values[1];p.spec=values[2];});
    if(id){var index=data.rows.findIndex(function(r){return r[9]===id&&!r[11];});if(index<0)throw new Error('Unknown spec');row=index+2;previous=data.rows[index];}else{id=Utilities.getUuid();}
    // Only images already stored in the configured private upload folder may be attached.
    var folderId=x.images.length?zipImageFolder_().getId():'';
    x.images.forEach(function(image){var parents=DriveApp.getFileById(image).getParents(),found=false;while(parents.hasNext()){if(parents.next().getId()===folderId)found=true;}if(!found)throw new Error('Foreign image');});
    var values=[x.name,x.papers.map(function(p){return p.number;}).join('\n'),x.papers.map(function(p){return p.spec||p.number;}).join('\n'),x.papers.map(function(p){return p.mirror;}).join('\n'),x.openMonth,x.completionMonth,x.designer,previous[7]||'',previous[8]||'',id,new Date().toISOString(),'',x.address,x.contact,x.builder,String(x.lat),String(x.lng),x.images.join('|'),JSON.stringify(x.papers),previous[19]||'',x.imageUrls.join('\n')];
    if(row>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),1);
    zipWriteMapped_(sh,data.columns,row,values);SpreadsheetApp.flush();
    return {ok:true,id:id,papers:x.papers};
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
