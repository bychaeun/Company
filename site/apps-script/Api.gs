// Script properties: GOOGLE_CLIENT_ID, ADMIN_EMAILS, SPREADSHEET_ID (optional for bound scripts).
// Never enable anonymous note access. All private actions require a verified session.
var ZIP_USER_HEADERS = ['Google ID','이메일','이름','승인상태','최초 로그인','최근 로그인'];

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'config') {
    var p = PropertiesService.getScriptProperties();
    return zipJson_({ok:true, clientId:p.getProperty('GOOGLE_CLIENT_ID') || '', configured:!!(p.getProperty('GOOGLE_CLIENT_ID') && p.getProperty('ADMIN_EMAILS'))});
  }
  return zipJson_({ok:false,code:'AUTH_REQUIRED',error:'Google 로그인이 필요합니다.'});
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents || '{}';
    if (raw.length > 16000) throw new Error('요청이 너무 큽니다.');
    var body = JSON.parse(raw), action = body.action;
    if (action === 'challenge') {
      var nonce = Utilities.getUuid() + Utilities.getUuid();
      CacheService.getScriptCache().put('nonce:' + zipHash_(nonce), 'valid', 300);
      return zipJson_({ok:true,nonce:nonce});
    }
    if (action === 'login') return zipJson_(zipLogin_(body.idToken,body.nonce));
    var user = zipSession_(body.sessionToken);
    if (action === 'logout') {
      PropertiesService.getScriptProperties().deleteProperty('session:' + zipHash_(body.sessionToken));
      return zipJson_({ok:true});
    }
    if (action === 'me') return zipJson_({ok:true,user:user});
    if (user.status !== 'approved') return zipJson_({ok:false,code:'FORBIDDEN',error:'관리자 승인이 필요합니다.'});
    if (action === 'notes') return zipJson_({ok:true,records:zipNotes_(),syncedAt:new Date().toISOString(),syncMode:'scheduled'});
    if (action === 'image') {
      var image=zipImage_(body.fileId);
      if(zipSession_(body.sessionToken).status!=='approved')return zipJson_({ok:false,code:'FORBIDDEN',error:'접근이 제한되었습니다.'});
      return zipJson_(image);
    }
    if (user.role !== 'admin') return zipJson_({ok:false,code:'FORBIDDEN',error:'관리자만 사용할 수 있습니다.'});
    if (action === 'users') return zipJson_({ok:true,users:zipUsers_().map(function(row){return {sub:row[0],email:row[1],name:row[2],status:row[3],created:row[4],lastLogin:row[5],admin:zipAdmin_(row[0])};})});
    if (action === 'setStatus') return zipJson_(zipSetStatus_(body.sub,body.status));
    throw new Error('지원하지 않는 요청입니다.');
  } catch (error) {
    // No token, private note, raw upstream error or configuration secrets in public responses.
    return zipJson_({ok:false,code:error.zipCode || 'REQUEST_FAILED',error:error.zipCode === 'AUTH_REQUIRED' ? '로그인이 만료됐어요. 다시 로그인해 주세요.' : '요청을 완료하지 못했어요. 설정과 시트 권한을 확인해 주세요.'});
  }
}

function zipJson_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function zipHash_(text) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(text))).replace(/=+$/,''); }
function zipAuthError_() { var e = new Error('Authentication required'); e.zipCode = 'AUTH_REQUIRED'; return e; }
function zipSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  var sheet = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!sheet) throw new Error('No spreadsheet configured');
  return sheet;
}
function zipUserSheet_() {
  var ss = zipSheet_(), sheet = ss.getSheetByName('접근관리');
  if (!sheet) {
    sheet = ss.insertSheet('접근관리');
    sheet.getRange(1,1,1,6).setValues([ZIP_USER_HEADERS]);
    sheet.getRange('A:F').setNumberFormat('@');
    sheet.setFrozenRows(1);
    sheet.getRange(2,4,Math.max(1,sheet.getMaxRows()-1),1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['대기','승인','거절','차단'],true).setAllowInvalid(false).build());
  }
  var headers = sheet.getRange(1,1,1,6).getDisplayValues()[0];
  if (!ZIP_USER_HEADERS.every(function(h,i){return headers[i] === h;})) throw new Error('Invalid access headers');
  return sheet;
}
function zipUsers_() {
  var sh = zipUserSheet_();
  if (sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2,1,sh.getLastRow()-1,6).getDisplayValues().filter(function(r){return r[0];});
  var seen = {};
  rows.forEach(function(r){if(seen[r[0]]) throw new Error('Duplicate identity'); seen[r[0]]=true;});
  return rows;
}
function zipAdmins_() { return (PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '').toLowerCase().split(',').map(function(v){return v.trim();}).filter(Boolean); }
function zipAdmin_(sub) {
  var props = PropertiesService.getScriptProperties();
  return zipAdmins_().some(function(email){return props.getProperty('admin:' + zipHash_(email)) === sub;});
}
function zipPublicUser_(row) {
  var admin = zipAdmin_(row[0]);
  return {sub:row[0],email:row[1],name:row[2],role:admin?'admin':'member',status:admin||row[3]==='승인'?'approved':row[3]==='거절'||row[3]==='차단'?'rejected':'pending'};
}
function zipSession_(token) {
  if (typeof token !== 'string' || token.length > 200) throw zipAuthError_();
  var key = 'session:' + zipHash_(token), props = PropertiesService.getScriptProperties();
  var session = JSON.parse(props.getProperty(key) || 'null');
  if (!session || session.expires <= Date.now()) { props.deleteProperty(key); throw zipAuthError_(); }
  var row = zipUsers_().find(function(r){return r[0] === session.sub;});
  if (!row) throw zipAuthError_();
  return zipPublicUser_(row);
}
function zipSafeCell_(value) { value = String(value || ''); return /^[=+@-]/.test(value) ? "'" + value : value; }

function zipLogin_(idToken,nonce) {
  if (typeof idToken !== 'string' || idToken.length > 14000 || typeof nonce !== 'string' || nonce.length > 100) throw zipAuthError_();
  var props = PropertiesService.getScriptProperties(), client = props.getProperty('GOOGLE_CLIENT_ID');
  if (!client || !zipAdmins_().length) throw new Error('Login not configured');
  // Google verifies the signature. Validate audience, issuer, expiry, verified email, subject and our nonce too.
  // This endpoint can be rate-limited: deny login on errors, never decode an unverified token as a fallback.
  var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),{muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) throw zipAuthError_();
  var identity = JSON.parse(response.getContentText()), now = Math.floor(Date.now()/1000);
  if (identity.aud !== client || ['accounts.google.com','https://accounts.google.com'].indexOf(identity.iss) < 0 ||
      !isFinite(Number(identity.exp)) || Number(identity.exp) <= now || !isFinite(Number(identity.iat)) || Number(identity.iat) > now+60 || !identity.sub ||
      String(identity.email_verified) !== 'true' || !identity.email || identity.nonce !== nonce) throw zipAuthError_();
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var cache = CacheService.getScriptCache(), nonceKey = 'nonce:' + zipHash_(nonce);
    if (cache.get(nonceKey) !== 'valid') throw zipAuthError_();
    cache.remove(nonceKey);
    var email = identity.email.toLowerCase();
    if (zipAdmins_().indexOf(email) >= 0 && (/@gmail\.com$/.test(email) || identity.hd === email.split('@')[1])) {
      var adminKey = 'admin:' + zipHash_(email);
      if (!props.getProperty(adminKey)) props.setProperty(adminKey,identity.sub);
    }
    var sh = zipUserSheet_(), rows = zipUsers_(), row = rows.find(function(r){return r[0] === identity.sub;}), stamp = new Date().toISOString();
    if (!row) {
      row = [identity.sub,email,identity.name || email,'대기',stamp,stamp];
      sh.appendRow(row.map(zipSafeCell_));
    } else {
      var values = sh.getDataRange().getDisplayValues(), index = values.findIndex(function(r){return r[0] === identity.sub;})+1;
      row[1]=email; row[2]=identity.name || email; row[5]=stamp;
      sh.getRange(index,2,1,2).setValues([[zipSafeCell_(row[1]),zipSafeCell_(row[2])]]);
      sh.getRange(index,6).setValue(stamp);
    }
    var all = props.getProperties();
    Object.keys(all).filter(function(k){return k.indexOf('session:')===0;}).forEach(function(k){try{if(JSON.parse(all[k]).expires <= Date.now())props.deleteProperty(k);}catch(e){props.deleteProperty(k);}});
    var token = Utilities.getUuid()+Utilities.getUuid();
    props.setProperty('session:'+zipHash_(token),JSON.stringify({sub:identity.sub,expires:Date.now()+8*60*60*1000}));
    return {ok:true,sessionToken:token,user:zipPublicUser_(row)};
  } finally { lock.releaseLock(); }
}
function zipSetStatus_(sub,status) {
  if (['승인','대기','거절','차단'].indexOf(status)<0 || zipAdmin_(sub)) throw new Error('Invalid status change');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var sh=zipUserSheet_(), rows=sh.getDataRange().getDisplayValues();
    var i=rows.findIndex(function(r){return r[0]===sub;});
    if(i<1)throw new Error('Unknown user');
    sh.getRange(i+1,4).setValue(status);
    return {ok:true};
  } finally {lock.releaseLock();}
}
function zipDriveId_(value) {
  var text = String(value||'').trim();
  var match = text.match(/^https:\/\/drive\.google\.com\/file\/d\/([-\w]{10,200})(?:\/|$)/) || text.match(/^https:\/\/drive\.google\.com\/(?:open|uc|thumbnail)\?id=([-\w]{10,200})(?:&|$)/);
  return match ? match[1] : '';
}
function zipNotes_() {
  var sh=zipSheet_().getSheetByName('메모');
  if(!sh)throw new Error('Missing notes');
  var rows=sh.getDataRange().getDisplayValues(), headers=rows.shift()||[];
  if(!['대분류','소분류','제목','부제목','내용','이미지','수정일'].every(function(h){return headers.indexOf(h)>=0;}))throw new Error('Invalid note headers');
  return rows.map(function(r){
    var get=function(h){return r[headers.indexOf(h)]||'';};
    return {category:get('대분류')||'기타',subcategory:get('소분류'),title:get('제목'),subtitle:get('부제목'),content:get('내용'),updatedAt:get('수정일'),images:get('이미지').split(/[|\n;]/).map(zipDriveId_).filter(Boolean)};
  }).filter(function(r){return r.title||r.content;});
}
function zipImage_(fileId) {
  if(!/^[-\w]{10,200}$/.test(String(fileId)))throw new Error('Invalid image');
  if(!zipNotes_().some(function(r){return r.images.indexOf(fileId)>=0;}))throw new Error('Image not in notes');
  var file=DriveApp.getFileById(fileId), type=file.getMimeType();
  if(!/^image\/(png|jpeg|webp|gif)$/.test(type)||file.getSize()>4*1024*1024)throw new Error('Unsupported image');
  return {ok:true,mime:type,base64:Utilities.base64Encode(file.getBlob().getBytes())};
}

// Run once in the editor to create the access-management tab and authorize Sheets/Drive.
function setupChaeZip() { zipUserSheet_(); DriveApp.getRootFolder().getId(); console.log('접근관리 준비 완료'); }
