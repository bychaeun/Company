// Script properties: GOOGLE_CLIENT_ID, ADMIN_EMAILS, SPREADSHEET_ID (optional for bound scripts).
// Never enable anonymous note access. All private actions require a verified session.
var ZIP_USER_HEADERS = ['Google ID','이메일','이름','승인상태','최초 로그인','최근 로그인'];
var ZIP_CHECKLIST_HEADERS = ['완료','할 일','날짜','시간','메모','캘린더 이벤트 ID'];
var ZIP_NOTE_HEADERS = ['소분류','제목','주소','내용','이미지','수정일'];
var ZIP_IMAGE_FOLDER_ID = '1nmfiM9CwM-hoLiYNulMdouyndxHlj8NV';

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
    if (raw.length > 8 * 1024 * 1024) throw new Error('요청이 너무 큽니다.');
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
      if(user.status !== 'approved') return zipJson_({ok:false,code:'FORBIDDEN',error:'접근이 제한되었습니다.'});
      var image=zipImage_(body.fileId);
      return zipJson_(image);
    }
    if (user.role !== 'admin') return zipJson_({ok:false,code:'FORBIDDEN',error:'관리자만 사용할 수 있습니다.'});
    if (action === 'users') return zipJson_({ok:true,users:zipUsers_().map(function(row){return {sub:row[0],email:row[1],name:row[2],status:row[3],created:row[4],lastLogin:row[5],admin:zipAdmin_(row[0])};})});
    if (action === 'setStatus') return zipJson_(zipSetStatus_(body.sub,body.status));
    if (action === 'createNote') return zipJson_(zipCreateNote_(body));
    if (action === 'updateNote') return zipJson_(zipUpdateNote_(body));
    if (action === 'deleteNote') return zipJson_(zipDeleteNote_(body.noteId));
    if (action === 'uploadNoteImage') return zipJson_(zipUploadNoteImage_(body));
    if (action === 'checklist') return zipJson_({ok:true,items:zipChecklist_()});
    if (action === 'addChecklist') return zipJson_(zipAddChecklist_(body));
    if (action === 'toggleChecklist') return zipJson_(zipToggleChecklist_(body.row,body.done));
    if (action === 'deleteChecklist') return zipJson_(zipDeleteChecklist_(body.row));
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
function zipNoteSheets_() {
  var sheets = zipSheet_().getSheets().filter(function(sh){
    var name = sh.getName();
    return name !== '접근관리' && name !== '체크리스트' && name.indexOf('메모_백업') !== 0;
  });
  var categorySheets = sheets.filter(function(sh){return sh.getName() !== '메모';});
  return categorySheets.length ? categorySheets : sheets;
}
function zipNotes_() {
  return zipNoteSheets_().reduce(function(all,sh){
    var rows=sh.getDataRange().getDisplayValues(), headers=rows.shift()||[];
    if(!['소분류','제목','내용','이미지','수정일'].every(function(h){return headers.indexOf(h)>=0;}))return all;
    return all.concat(rows.map(function(r,index){
      var get=function(h){return r[headers.indexOf(h)]||'';};
      return {noteId:sh.getSheetId()+':'+(index+2),category:headers.indexOf('대분류')>=0?(get('대분류')||'기타'):sh.getName(),subcategory:get('소분류'),title:get('제목'),address:headers.indexOf('주소')>=0?get('주소'):'',content:get('내용'),updatedAt:get('수정일'),imageText:get('이미지'),images:get('이미지').split(/[|\n;]/).map(zipDriveId_).filter(Boolean)};
    }).filter(function(r){return r.title||r.content;}));
  },[]);
}

function zipNoteInput_(body) {
  var category=String(body.category||'').trim(), subcategory=String(body.subcategory||'').trim(), title=String(body.title||'').trim(), address=String(body.address||'').trim(), content=String(body.content||'').trim(), imageText=String(body.imageText||'').trim();
  if(!category||category.length>100||/[\\\/\?\*\[\]:]/.test(category)||['접근관리','체크리스트'].indexOf(category)>=0||category.indexOf('메모_백업')===0)throw new Error('Invalid note category');
  if(!title||title.length>200||subcategory.length>100||address.length>300||content.length>8000||imageText.length>2000)throw new Error('Invalid note');
  imageText.split(/[|\n;]/).map(function(v){return v.trim();}).filter(Boolean).forEach(function(v){if(!zipDriveId_(v)&&!/^[-\w]{10,200}$/.test(v))throw new Error('Invalid note image');});
  return {category:category,subcategory:subcategory,title:title,address:address,content:content,imageText:imageText};
}
function zipNoteSheet_(category) {
  var ss=zipSheet_(), sh=ss.getSheetByName(category);
  if(!sh){
    sh=ss.insertSheet(category);
    sh.getRange(1,1,1,ZIP_NOTE_HEADERS.length).setValues([ZIP_NOTE_HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,ZIP_NOTE_HEADERS.length).setFontWeight('bold').setBackground('#fce8f1');
    sh.setColumnWidths(1,1,150); sh.setColumnWidths(2,1,220); sh.setColumnWidths(3,1,260); sh.setColumnWidths(4,1,460); sh.setColumnWidths(5,1,240); sh.setColumnWidths(6,1,110);
  }
  var headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  if(headers.indexOf('주소')<0){
    var addressColumn=sh.getLastColumn()+1;
    sh.getRange(1,addressColumn).setValue('주소').setFontWeight('bold').setBackground('#fce8f1');
    sh.setColumnWidth(addressColumn,260);
    headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  }
  if(!ZIP_NOTE_HEADERS.every(function(h){return headers.indexOf(h)>=0;}))throw new Error('Invalid note headers');
  return sh;
}
function zipFindNote_(noteId) {
  var match=String(noteId||'').match(/^(\d+):(\d+)$/);
  if(!match)throw new Error('Invalid note id');
  var sheetId=Number(match[1]), row=Number(match[2]), sh=zipNoteSheets_().find(function(s){return s.getSheetId()===sheetId;});
  if(!sh||row<2||row>sh.getLastRow())throw new Error('Unknown note');
  var headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  var values=sh.getRange(row,1,1,headers.length).getDisplayValues()[0];
  if(!values[headers.indexOf('제목')]&&!values[headers.indexOf('내용')])throw new Error('Unknown note');
  return {sheet:sh,row:row};
}
function zipWriteNote_(sh,row,input) {
  var headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  if(headers.indexOf('주소')<0){
    var addressColumn=sh.getLastColumn()+1;
    sh.getRange(1,addressColumn).setValue('주소').setFontWeight('bold').setBackground('#fce8f1');
    sh.setColumnWidth(addressColumn,260);
    headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  }
  var values=row<=sh.getLastRow()?sh.getRange(row,1,1,headers.length).getValues()[0]:new Array(headers.length).fill('');
  values[headers.indexOf('소분류')]=zipSafeCell_(input.subcategory);
  values[headers.indexOf('제목')]=zipSafeCell_(input.title);
  values[headers.indexOf('주소')]=zipSafeCell_(input.address);
  values[headers.indexOf('내용')]=zipSafeCell_(input.content);
  values[headers.indexOf('이미지')]=zipSafeCell_(input.imageText);
  values[headers.indexOf('수정일')]=new Date();
  sh.getRange(row,1,1,headers.length).setValues([values]);
  sh.getRange(row,headers.indexOf('수정일')+1).setNumberFormat('yyyy-mm-dd');
}
function zipCreateNote_(body) {
  var input=zipNoteInput_(body), lock=LockService.getScriptLock(); lock.waitLock(10000);
  try{var sh=zipNoteSheet_(input.category), row=sh.getLastRow()+1; zipWriteNote_(sh,row,input); SpreadsheetApp.flush(); return {ok:true,noteId:sh.getSheetId()+':'+row};}finally{lock.releaseLock();}
}
function zipUpdateNote_(body) {
  var input=zipNoteInput_(body), lock=LockService.getScriptLock(); lock.waitLock(10000);
  try{
    var found=zipFindNote_(body.noteId);
    if(found.sheet.getName()===input.category)zipWriteNote_(found.sheet,found.row,input);
    else{var target=zipNoteSheet_(input.category), row=target.getLastRow()+1; zipWriteNote_(target,row,input); found.sheet.deleteRow(found.row);}
    SpreadsheetApp.flush(); return {ok:true};
  }finally{lock.releaseLock();}
}
function zipDeleteNote_(noteId) {
  var lock=LockService.getScriptLock(); lock.waitLock(10000);
  try{var found=zipFindNote_(noteId); found.sheet.deleteRow(found.row); SpreadsheetApp.flush(); return {ok:true};}finally{lock.releaseLock();}
}
function zipImageFolder_() {
  return DriveApp.getFolderById(ZIP_IMAGE_FOLDER_ID);
}
function zipUploadNoteImage_(body) {
  var mime=String(body.mime||''), base64=String(body.base64||''), name=String(body.name||'메모 사진.jpg').replace(/[\\/:*?"<>|]/g,'_').slice(0,120);
  if(!/^image\/(jpeg|png|webp)$/.test(mime)||!base64||base64.length>6*1024*1024||!/^[A-Za-z0-9+/=]+$/.test(base64))throw new Error('Invalid note image upload');
  var bytes=Utilities.base64Decode(base64);
  if(bytes.length>4*1024*1024)throw new Error('Image too large');
  var file=zipImageFolder_().createFile(Utilities.newBlob(bytes,mime,name));
  return {ok:true,fileId:file.getId()};
}
function zipImage_(fileId) {
  if(!/^[-\w]{10,200}$/.test(String(fileId)))throw new Error('Invalid image');
  if(!zipNotes_().some(function(r){return r.images.indexOf(fileId)>=0;}))throw new Error('Image not in notes');
  var file=DriveApp.getFileById(fileId), type=file.getMimeType();
  if(!/^image\/(png|jpeg|webp|gif)$/.test(type)||file.getSize()>4*1024*1024)throw new Error('Unsupported image');
  return {ok:true,mime:type,base64:Utilities.base64Encode(file.getBlob().getBytes())};
}

function zipChecklistSheet_() {
  var ss=zipSheet_(), sh=ss.getSheetByName('체크리스트');
  if(!sh){
    sh=ss.insertSheet('체크리스트');
    sh.getRange(1,1,1,ZIP_CHECKLIST_HEADERS.length).setValues([ZIP_CHECKLIST_HEADERS]);
    sh.setFrozenRows(1);
  }
  var headers=sh.getRange(1,1,1,ZIP_CHECKLIST_HEADERS.length).getDisplayValues()[0];
  if(!ZIP_CHECKLIST_HEADERS.every(function(h,i){return headers[i]===h;}))throw new Error('Invalid checklist headers');
  var extra=sh.getRange(1,7,1,2).getDisplayValues()[0];
  if(extra[0] && extra[0]!=='완료일시' || extra[1] && extra[1]!=='삭제일시')throw new Error('Unexpected checklist columns');
  if(!extra[0] || !extra[1])sh.getRange(1,7,1,2).setValues([['완료일시','삭제일시']]);
  sh.getRange(2,1,Math.max(1,sh.getMaxRows()-1),1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sh.getRange(2,3,Math.max(1,sh.getMaxRows()-1),1).setNumberFormat('yyyy-mm-dd');
  return sh;
}
function zipChecklist_() {
  var sh=zipChecklistSheet_();
  if(sh.getLastRow()<2)return [];
  var values=sh.getRange(2,1,sh.getLastRow()-1,8).getValues();
  var display=sh.getRange(2,1,sh.getLastRow()-1,6).getDisplayValues();
  return values.map(function(row,i){return {row:i+2,done:row[0]===true,task:String(display[i][1]||''),date:String(display[i][2]||''),time:String(display[i][3]||''),note:String(display[i][4]||''),calendar:!!display[i][5]};})
    .filter(function(item){var source=values[item.row-2];return item.task && !source[7] && !zipChecklistExpired_(item.done,source[6],Date.now());})
    .sort(function(a,b){return (a.done-b.done)||((a.date+' '+a.time).localeCompare(b.date+' '+b.time));});
}
function zipChecklistInput_(body) {
  var task=String(body.task||'').trim(), date=String(body.date||'').trim(), time=String(body.time||'').trim(), note=String(body.note||'').trim();
  if(!task||task.length>160||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||time&&!/^[0-9]{2}:[0-9]{2}$/.test(time)||note.length>1000)throw new Error('Invalid checklist item');
  var when=Utilities.parseDate(date+' '+(time||'09:00'),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm');
  if(isNaN(when.getTime()))throw new Error('Invalid checklist date');
  return {task:task,date:date,time:time,note:note,when:when};
}
function zipAddChecklist_(body) {
  var item=zipChecklistInput_(body), lock=LockService.getScriptLock(); lock.waitLock(10000);
  try{
    var calendar=CalendarApp.getDefaultCalendar();
    var event=item.time?calendar.createEvent('☐ '+item.task,item.when,new Date(item.when.getTime()+60*60*1000)):calendar.createAllDayEvent('☐ '+item.task,item.when);
    event.setDescription(['CHAE EUN.ZIP 체크리스트',item.note].filter(Boolean).join('\n\n'));
    var sh=zipChecklistSheet_();
    sh.appendRow([false,zipSafeCell_(item.task),item.when,item.time,zipSafeCell_(item.note),event.getId()]);
    sh.getRange(sh.getLastRow(),3).setNumberFormat('yyyy-mm-dd');
    return {ok:true,item:{row:sh.getLastRow(),done:false,task:item.task,date:item.date,time:item.time,note:item.note,calendar:true}};
  }finally{lock.releaseLock();}
}
function zipToggleChecklist_(row,done) {
  row=Number(row);
  if(!Number.isInteger(row)||row<2||typeof done!=='boolean')throw new Error('Invalid checklist update');
  var lock=LockService.getScriptLock(); lock.waitLock(10000);
  try{
    var sh=zipChecklistSheet_();
    if(row>sh.getLastRow())throw new Error('Unknown checklist item');
    var values=sh.getRange(row,1,1,6).getDisplayValues()[0], task=values[1], eventId=values[5];
    if(!task)throw new Error('Unknown checklist item');
    if(sh.getRange(row,8).getValue())throw new Error('Deleted checklist item');
    var wasDone=sh.getRange(row,1).getValue()===true;
    sh.getRange(row,1).setValue(done);
    if(!done)sh.getRange(row,7).clearContent();
    else if(!wasDone || !sh.getRange(row,7).getValue())sh.getRange(row,7).setValue(new Date());
    if(eventId){var event=CalendarApp.getEventById(eventId);if(event)event.setTitle((done?'✓ ':'☐ ')+task);}
    return {ok:true};
  }finally{lock.releaseLock();}
}

function zipChecklistExpired_(done,completedAt,now) {
  if(!done || !completedAt)return false;
  var stamp=new Date(completedAt).getTime();
  return isFinite(stamp) && now-stamp>=7*24*60*60*1000;
}

function zipDeleteChecklist_(row) {
  row=Number(row);
  if(!Number.isInteger(row)||row<2)throw new Error('Invalid checklist row');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    var sh=zipChecklistSheet_();
    if(row>sh.getLastRow() || !sh.getRange(row,2).getValue())throw new Error('Unknown checklist item');
    if(!sh.getRange(row,8).getValue())sh.getRange(row,8).setValue(new Date());
    return {ok:true};
  }finally{lock.releaseLock();}
}

// Run once in the editor to create the required tabs and authorize Sheets, Drive and Calendar.
function setupChaeZip() { zipUserSheet_(); zipChecklistSheet_(); zipImageFolder_().getName(); CalendarApp.getDefaultCalendar().getId(); console.log('접근관리·이미지·체크리스트·캘린더 준비 완료'); }

