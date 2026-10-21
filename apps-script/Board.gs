var ZIP_BOARD_HEADERS=['ID','제목','내용','사이트','색상','X','Y','연결 ID','수정일','삭제일'];
function zipBoardSheet_(){
  var ss=zipSheet_(),sh=ss.getSheetByName('디자인 보드');
  if(!sh){sh=ss.insertSheet('디자인 보드');sh.getRange(1,1,1,10).setValues([ZIP_BOARD_HEADERS]);sh.setFrozenRows(1);}
  var headers=sh.getRange(1,1,1,10).getDisplayValues()[0];if(!ZIP_BOARD_HEADERS.every(function(h,i){return h===headers[i];}))throw new Error('Invalid board headers');return sh;
}
function zipBoard_(){var sh=zipBoardSheet_();if(sh.getLastRow()<2)return [];return sh.getRange(2,1,sh.getLastRow()-1,10).getDisplayValues().filter(function(r){return r[0]&&!r[9];}).map(function(r){return {id:r[0],title:r[1],content:r[2],url:r[3],color:r[4],x:Number(r[5])||0,y:Number(r[6])||0,link:r[7],updatedAt:r[8]};});}
function zipBoardInput_(b){
  var x={};['id','title','content','url','color','link'].forEach(function(k){x[k]=String(b[k]||'').trim();});
  if(!/^[a-zA-Z0-9-]{20,80}$/.test(x.id)||!x.title||x.title.length>200||x.content.length>8000||x.url.length>2000||x.url&&!/^https?:\/\/[^\s]+$/i.test(x.url)||['cream','pink','mint','lavender'].indexOf(x.color)<0||x.link&&!/^[a-zA-Z0-9-]{20,80}$/.test(x.link)||x.link===x.id)throw new Error('Invalid board note');
  x.x=Number(b.x);x.y=Number(b.y);if(!isFinite(x.x)||!isFinite(x.y)||Math.abs(x.x)>100000||Math.abs(x.y)>100000)throw new Error('Invalid board position');return x;
}
function zipSaveBoard_(body){
  var x=zipBoardInput_(body),lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var sh=zipBoardSheet_(),rows=sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,10).getDisplayValues(),index=rows.findIndex(function(r){return r[0]===x.id;});
    if(index>=0&&rows[index][9])throw new Error('Deleted board note');
    var stamp=new Date().toISOString();sh.getRange(index<0?sh.getLastRow()+1:index+2,1,1,10).setNumberFormat('@').setValues([[x.id,x.title,x.content,x.url,x.color,String(x.x),String(x.y),x.link,stamp,''].map(zipSafeCell_)]);return {ok:true,updatedAt:stamp};
  }finally{lock.releaseLock();}
}
function zipDeleteBoard_(id){var lock=LockService.getScriptLock();lock.waitLock(10000);try{var sh=zipBoardSheet_(),rows=sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,10).getDisplayValues(),index=rows.findIndex(function(r){return r[0]===String(id);});if(index<0)throw new Error('Unknown board note');sh.getRange(index+2,10).setValue(new Date().toISOString());return {ok:true};}finally{lock.releaseLock();}}
