// ── 영업 관리: 업체 · 담당자 · 현장별 대응 기록 ──
// COMPANY 시트의 '영업 기록' 탭에 한 줄 = 한 번의 대응(날짜, 업체, 담당자, 현장, 유형, 내용, 다음 할 일, 다음 일정)으로 쌓는다.
// 삭제하면 줄을 지운다. 업체·담당자 목록은 기록에서 모아 만든다.
var ZIP_SALES_SHEET='영업 기록';
var ZIP_SALES_HEADERS=['관리 ID','날짜','업체','담당자','현장','유형','내용','다음 할 일','다음 일정','등록일','수정일'];
var ZIP_SALES_TYPES=['미팅','전화','방문','샘플 발송','제안','견적','기타'];

function zipSalesError_(code){var e=new Error(code);e.zipCode=code;return e;}
function zipSalesSheet_(){
  var ss=zipSheet_(),sh=ss.getSheetByName(ZIP_SALES_SHEET);
  if(!sh){
    sh=ss.insertSheet(ZIP_SALES_SHEET);
    sh.getRange(1,1,1,ZIP_SALES_HEADERS.length).setValues([ZIP_SALES_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);sh.hideColumns(1);sh.getRange('B:B').setNumberFormat('yyyy-mm-dd');sh.getRange('I:I').setNumberFormat('yyyy-mm-dd');sh.getRange('G:H').setWrap(true);
    return sh;
  }
  var headers=sh.getRange(1,1,1,ZIP_SALES_HEADERS.length).getDisplayValues()[0];
  if(headers.join('|')!==ZIP_SALES_HEADERS.join('|'))throw zipSalesError_('SALES_HEADERS');
  return sh;
}
function zipSalesDay_(value){
  if(value instanceof Date&&!isNaN(value.getTime()))return Utilities.formatDate(value,Session.getScriptTimeZone(),'yyyy-MM-dd');
  var text=String(value||'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function zipSalesRows_(sh){
  if(sh.getLastRow()<2)return [];
  return sh.getRange(2,1,sh.getLastRow()-1,ZIP_SALES_HEADERS.length).getValues().map(function(r,i){
    return {row:i+2,id:String(r[0]||''),date:zipSalesDay_(r[1]),company:String(r[2]||''),contact:String(r[3]||''),site:String(r[4]||''),type:String(r[5]||''),content:String(r[6]||''),next:String(r[7]||''),nextDate:zipSalesDay_(r[8]),created:r[9] instanceof Date?r[9].toISOString():String(r[9]||'')};
  }).filter(function(x){return x.id&&x.date;});
}
function zipSalesLog_(){
  var items=zipSalesRows_(zipSalesSheet_()).map(function(x){delete x.row;return x;});
  items.sort(function(a,b){return b.date.localeCompare(a.date)||b.created.localeCompare(a.created);});
  return {ok:true,items:items,types:ZIP_SALES_TYPES};
}
function zipSalesInput_(b){
  var x={id:String(b.id||''),date:String(b.date||'').trim(),company:String(b.company||'').trim(),contact:String(b.contact||'').trim(),site:String(b.site||'').trim(),type:String(b.type||'').trim(),content:String(b.content||'').trim(),next:String(b.next||'').trim(),nextDate:String(b.nextDate||'').trim()};
  if(!/^[a-zA-Z0-9-]{20,80}$/.test(x.id)||!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||!x.company||x.company.length>100||x.contact.length>100||x.site.length>200||(x.type&&ZIP_SALES_TYPES.indexOf(x.type)<0)||x.content.length>4000||x.next.length>1000||(x.nextDate&&!/^\d{4}-\d{2}-\d{2}$/.test(x.nextDate)))throw zipSalesError_('SALES_INPUT');
  return x;
}
function zipSaveSalesLog_(body){
  var x=zipSalesInput_(body),lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var sh=zipSalesSheet_(),found=zipSalesRows_(sh).filter(function(r){return r.id===x.id;})[0],tz=Session.getScriptTimeZone(),now=new Date();
    var created=found&&found.created?new Date(found.created):now;
    var values=[[x.id,Utilities.parseDate(x.date,tz,'yyyy-MM-dd'),zipSafeCell_(x.company),zipSafeCell_(x.contact),zipSafeCell_(x.site),x.type,zipSafeCell_(x.content),zipSafeCell_(x.next),x.nextDate?Utilities.parseDate(x.nextDate,tz,'yyyy-MM-dd'):'',created,now]];
    sh.getRange(found?found.row:sh.getLastRow()+1,1,1,ZIP_SALES_HEADERS.length).setValues(values);SpreadsheetApp.flush();
    x.created=created.toISOString();return {ok:true,item:x};
  }finally{lock.releaseLock();}
}
function zipDeleteSalesLog_(id){
  id=String(id||'');if(!/^[a-zA-Z0-9-]{20,80}$/.test(id))throw zipSalesError_('SALES_INPUT');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var sh=zipSalesSheet_(),found=zipSalesRows_(sh).filter(function(r){return r.id===id;})[0];if(found){sh.deleteRow(found.row);SpreadsheetApp.flush();}return {ok:true};}
  finally{lock.releaseLock();}
}
