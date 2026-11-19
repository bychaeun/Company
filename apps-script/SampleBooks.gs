// ── 샘플북 분출 기록 ──
// COMPANY 시트의 '샘플북' 탭에 저장하고, 주간 보고서는 '주간 샘플북 분출 리스트' 양식을 복사해 채운 뒤 PDF로 내보낸다.
// 분출 기간은 항상 월요일~금요일. 주말에 적은 기록은 그 주(월~일)에 포함한다.
// 다른 양식을 쓰려면 스크립트 속성 SAMPLE_REPORT_TEMPLATE_ID에 시트 ID를 넣는다.
var ZIP_SAMPLE_SHEET='샘플북';
var ZIP_SAMPLE_HEADERS=['관리 ID','날짜','업체명','업체담당자','방법','권수','등록일'];
var ZIP_SAMPLE_TEMPLATE_DEFAULT='1zyRp3nbfGuRLRSudl1wnZYjjJE1O32NY3HrWigsOqnA';
var ZIP_SAMPLE_METHODS=['직달','택배'];
// 양식 위치: 분출 기간 C5(월)·E5(금), 목록 8~22행(15칸) — A 번호, B 업체명, C(C:D 병합) 업체담당자, E 권수, F 직달, G 택배
var ZIP_SAMPLE_FIRST_ROW=8,ZIP_SAMPLE_SLOTS=15,ZIP_SAMPLE_LAST_TEMPLATE_ROW=26;

function zipSampleError_(code){var e=new Error(code);e.zipCode=code;return e;}
function zipSampleSheet_(){
  var ss=zipSheet_(),sh=ss.getSheetByName(ZIP_SAMPLE_SHEET);
  if(!sh){
    sh=ss.insertSheet(ZIP_SAMPLE_SHEET);
    sh.getRange(1,1,1,ZIP_SAMPLE_HEADERS.length).setValues([ZIP_SAMPLE_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);sh.hideColumns(1);sh.getRange('B:B').setNumberFormat('yyyy-mm-dd');sh.getRange('G:G').setNumberFormat('yyyy-mm-dd hh:mm');
    return sh;
  }
  var headers=sh.getRange(1,1,1,ZIP_SAMPLE_HEADERS.length).getDisplayValues()[0];
  if(headers.join('|')!==ZIP_SAMPLE_HEADERS.join('|'))throw zipSampleError_('SAMPLE_HEADERS');
  return sh;
}
function zipSampleDay_(value){
  var tz=Session.getScriptTimeZone();
  if(value instanceof Date&&!isNaN(value.getTime()))return Utilities.formatDate(value,tz,'yyyy-MM-dd');
  var text=String(value||'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function zipSampleRows_(sh){
  if(sh.getLastRow()<2)return [];
  return sh.getRange(2,1,sh.getLastRow()-1,ZIP_SAMPLE_HEADERS.length).getValues().map(function(r,i){
    return {row:i+2,id:String(r[0]||''),date:zipSampleDay_(r[1]),company:String(r[2]||''),contact:String(r[3]||''),method:String(r[4]||''),count:Number(r[5])||0,created:r[6] instanceof Date?r[6].toISOString():String(r[6]||'')};
  }).filter(function(item){return item.id&&item.date&&item.company;});
}
function zipSampleBooks_(){
  var items=zipSampleRows_(zipSampleSheet_()).map(function(item){delete item.row;return item;});
  items.sort(function(a,b){return b.date.localeCompare(a.date)||b.created.localeCompare(a.created);});
  return {ok:true,items:items,template:!!zipSampleTemplateId_()};
}
function zipSampleInput_(body){
  var item={id:String(body.id||''),date:String(body.date||'').trim(),company:String(body.company||'').trim(),contact:String(body.contact||'').trim(),method:String(body.method||'').trim(),count:Number(body.count)};
  if(!/^[a-zA-Z0-9-]{20,80}$/.test(item.id)||!/^\d{4}-\d{2}-\d{2}$/.test(item.date)||!item.company||item.company.length>100||item.contact.length>100||ZIP_SAMPLE_METHODS.indexOf(item.method)<0||!Number.isInteger(item.count)||item.count<1||item.count>999)throw zipSampleError_('SAMPLE_INPUT');
  return item;
}
function zipSaveSampleBook_(body){
  var item=zipSampleInput_(body),lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var sh=zipSampleSheet_(),found=zipSampleRows_(sh).filter(function(r){return r.id===item.id;})[0];
    var when=Utilities.parseDate(item.date,Session.getScriptTimeZone(),'yyyy-MM-dd'),created=found&&found.created?new Date(found.created):new Date();
    var values=[[item.id,when,zipSafeCell_(item.company),zipSafeCell_(item.contact),item.method,item.count,created]];
    var row=found?found.row:sh.getLastRow()+1;
    sh.getRange(row,1,1,ZIP_SAMPLE_HEADERS.length).setValues(values);SpreadsheetApp.flush();
    item.created=created.toISOString();return {ok:true,item:item};
  }finally{lock.releaseLock();}
}
// 삭제하면 시트에서 줄 자체를 지운다(샘플북 탭에는 옆에 둔 표가 없다).
function zipDeleteSampleBook_(id){
  id=String(id||'');if(!/^[a-zA-Z0-9-]{20,80}$/.test(id))throw zipSampleError_('SAMPLE_INPUT');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var sh=zipSampleSheet_(),found=zipSampleRows_(sh).filter(function(r){return r.id===id;})[0];if(found){sh.deleteRow(found.row);SpreadsheetApp.flush();}return {ok:true};}
  finally{lock.releaseLock();}
}
function zipSampleTemplateId_(){return PropertiesService.getScriptProperties().getProperty('SAMPLE_REPORT_TEMPLATE_ID')||ZIP_SAMPLE_TEMPLATE_DEFAULT;}
// weekStart(월요일) 주의 기록으로 보고서를 만들어 PDF(base64)로 돌려준다. 복사본은 바로 휴지통으로.
function zipSampleReport_(body){
  var tz=Session.getScriptTimeZone(),start=String(body.weekStart||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start))throw zipSampleError_('SAMPLE_INPUT');
  var monday=Utilities.parseDate(start,tz,'yyyy-MM-dd');if(Utilities.formatDate(monday,tz,'u')!=='1')throw zipSampleError_('SAMPLE_INPUT');
  var friday=new Date(monday.getTime()+4*864e5),sundayKey=Utilities.formatDate(new Date(monday.getTime()+6*864e5),tz,'yyyy-MM-dd');
  var items=zipSampleRows_(zipSampleSheet_()).filter(function(r){return r.date>=start&&r.date<=sundayKey;})
    .sort(function(a,b){return a.date.localeCompare(b.date)||a.created.localeCompare(b.created);});
  var name='주간 샘플북 분출 리스트_'+Utilities.formatDate(monday,tz,'yyyyMMdd')+'-'+Utilities.formatDate(friday,tz,'MMdd');
  var copy;
  try{copy=DriveApp.getFileById(zipSampleTemplateId_()).makeCopy(name);}catch(error){throw zipSampleError_('SAMPLE_TEMPLATE');}
  try{
    var sheet=SpreadsheetApp.openById(copy.getId()).getSheets()[0],first=ZIP_SAMPLE_FIRST_ROW,slots=ZIP_SAMPLE_SLOTS,extra=Math.max(0,items.length-slots);
    // 15건이 넘으면 목록 안쪽에 줄을 더해 합계 수식(SUM)이 자동으로 늘어나게 한다.
    if(extra){
      var lastSlot=first+slots-1;sheet.insertRowsAfter(lastSlot-1,extra);
      var template=sheet.getRange(lastSlot-1+extra+1,1,1,7);
      for(var k=0;k<extra;k++){var target=sheet.getRange(lastSlot+k,1,1,7);template.copyTo(target,SpreadsheetApp.CopyPasteType.PASTE_FORMAT,false);sheet.getRange(lastSlot+k,3,1,2).merge();}
    }
    var total=slots+extra;
    sheet.getRange(first,2,total,6).clearContent();   // 양식의 예시 업체·담당자 지우기
    sheet.getRange(first,1,total,1).setValues(Array.from({length:total},function(_,i){return [i+1];}));
    if(items.length)sheet.getRange(first,2,items.length,6).setValues(items.map(function(r){
      return [r.company,r.contact,'',r.count,r.method==='직달'?1:'',r.method==='택배'?1:''];   // 직달·택배 칸은 건수(1)로 표시해 합계에 잡힌다
    }));
    sheet.getRange('C5').setValue(monday);sheet.getRange('E5').setValue(friday);
    SpreadsheetApp.flush();
    var lastRow=ZIP_SAMPLE_LAST_TEMPLATE_ROW+extra;
    var url='https://docs.google.com/spreadsheets/d/'+copy.getId()+'/export?format=pdf&gid='+sheet.getSheetId()+'&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED&fzr=false&horizontal_alignment=CENTER&top_margin=0.6&bottom_margin=0.6&left_margin=0.5&right_margin=0.5&r1=0&c1=0&r2='+lastRow+'&c2=7';
    var response=UrlFetchApp.fetch(url,{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
    if(response.getResponseCode()!==200)throw zipSampleError_('SAMPLE_PDF');
    return {ok:true,name:name+'.pdf',count:items.length,books:items.reduce(function(s,r){return s+r.count;},0),base64:Utilities.base64Encode(response.getBlob().getBytes())};
  }finally{try{copy.setTrashed(true);}catch(ignore){}}
}
