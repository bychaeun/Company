var ZIP_BOARD_HEADERS=['ID','제목','내용','사이트','색상','X','Y','연결 ID','수정일','삭제일','대지 ID','사이트 목록(JSON)'];
var ZIP_ARTBOARD_HEADERS=['ID','제목','수정일','삭제일'];
function zipBoardSheet_(){
  var ss=zipSheet_(),sh=ss.getSheetByName('디자인 보드');
  if(!sh){sh=ss.insertSheet('디자인 보드');sh.getRange(1,1,1,12).setValues([ZIP_BOARD_HEADERS]);sh.setFrozenRows(1);}
  var headers=sh.getRange(1,1,1,12).getDisplayValues()[0];
  if(!ZIP_BOARD_HEADERS.every(function(h,i){return i>=10&&!headers[i]||h===headers[i];}))throw new Error('Invalid board headers');
  if(!headers[10]||!headers[11])sh.getRange(1,11,1,2).setValues([[ZIP_BOARD_HEADERS[10],ZIP_BOARD_HEADERS[11]]]);return sh;
}
function zipArtboardSheet_(){
  var ss=zipSheet_(),sh=ss.getSheetByName('디자인 대지');
  if(!sh){sh=ss.insertSheet('디자인 대지');sh.getRange(1,1,1,4).setValues([ZIP_ARTBOARD_HEADERS]);sh.setFrozenRows(1);}
  var headers=sh.getRange(1,1,1,4).getDisplayValues()[0];if(!ZIP_ARTBOARD_HEADERS.every(function(h,i){return h===headers[i];}))throw new Error('Invalid artboard headers');return sh;
}
function zipArtboards_(){
  var sh=zipArtboardSheet_(),rows=sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,4).getDisplayValues();
  if(!rows.some(function(r){return r[0]==='default';}))rows.unshift(['default','기본 대지','','']);
  return rows.filter(function(r){return r[0]&&!r[3];}).map(function(r){return {id:r[0],title:r[1]};});
}
function zipSaveArtboard_(b){
  var id=String(b.id||''),title=String(b.title||'').trim();
  if(!zipArtboardId_(id)||!title||title.length>200)throw new Error('Invalid artboard');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var sh=zipArtboardSheet_(),rows=sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,4).getDisplayValues(),i=rows.findIndex(function(r){return r[0]===id;});
    if(i>=0&&rows[i][3])throw new Error('Deleted artboard');sh.getRange(i<0?sh.getLastRow()+1:i+2,1,1,4).setNumberFormat('@').setValues([[id,zipSafeCell_(title),new Date().toISOString(),'']]);return {ok:true,id:id,title:title};
  }finally{lock.releaseLock();}
}
function zipArtboardId_(id){return id==='default'||/^[a-zA-Z0-9-]{20,80}$/.test(id);}
function zipBoardUrls_(urls,legacy){
  var values=urls===undefined?(legacy?[legacy]:[]):urls;
  if(!Array.isArray(values)||values.length>20)throw new Error('Invalid board URLs');
  return values.reduce(function(all,url){if(typeof url!=='string')throw new Error('Invalid board URL');url=url.trim();if(!url)return all;if(url.length>2000||!/^https?:\/\/[^\s/?#]+(?:[^\s]*)$/i.test(url))throw new Error('Invalid board URL');if(all.indexOf(url)<0)all.push(url);return all;},[]);
}
function zipBoardRow_(r){
  var urls;try{urls=zipBoardUrls_(r[11]?JSON.parse(r[11]):undefined,r[3]);}catch(e){urls=[];}
  return {id:r[0],title:r[1],content:r[2],url:urls[0]||'',urls:urls,color:r[4]||'cream',x:Number(r[5])||0,y:Number(r[6])||0,link:r[7],boardId:r[10]||'default',updatedAt:r[8]};
}
function zipBoard_(){var sh=zipBoardSheet_();if(sh.getLastRow()<2)return [];return sh.getRange(2,1,sh.getLastRow()-1,12).getDisplayValues().filter(function(r){return r[0]&&!r[9];}).map(zipBoardRow_);}
function zipBoardInput_(b){
  var x={};['id','title','content','url','color','link'].forEach(function(k){x[k]=String(b[k]||'').trim();});x.boardId=String(b.boardId||'default');x.urls=zipBoardUrls_(b.urls,x.url);x.url=x.urls[0]||'';
  if(!/^[a-zA-Z0-9-]{20,80}$/.test(x.id)||!x.title||x.title.length>200||x.content.length>8000||!zipArtboardId_(x.boardId)||['cream','pink','mint','lavender'].indexOf(x.color)<0||x.link&&!/^[a-zA-Z0-9-]{20,80}$/.test(x.link)||x.link===x.id)throw new Error('Invalid board note');
  x.x=Number(b.x);x.y=Number(b.y);if(!isFinite(x.x)||!isFinite(x.y)||Math.abs(x.x)>100000||Math.abs(x.y)>100000)throw new Error('Invalid board position');return x;
}
function zipSaveBoard_(body){
  var x=zipBoardInput_(body),lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var sh=zipBoardSheet_(),rows=sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,12).getDisplayValues(),index=rows.findIndex(function(r){return r[0]===x.id;});
    if(index>=0&&rows[index][9])throw new Error('Deleted board note');
    if(index>=0){var old=zipBoardRow_(rows[index]);if(body.boardId===undefined)x.boardId=old.boardId;if(body.urls===undefined&&x.url===old.url)x.urls=old.urls;}
    if(!zipArtboards_().some(function(b){return b.id===x.boardId;}))throw new Error('Unknown artboard');
    if(x.link&&!rows.some(function(r){return r[0]===x.link&&!r[9]&&(r[10]||'default')===x.boardId;}))throw new Error('Invalid board connection');
    var stamp=new Date().toISOString();sh.getRange(index<0?sh.getLastRow()+1:index+2,1,1,12).setNumberFormat('@').setValues([[x.id,x.title,x.content,x.urls[0]||'',x.color,String(x.x),String(x.y),x.link,stamp,'',x.boardId,JSON.stringify(x.urls)].map(zipSafeCell_)]);return {ok:true,updatedAt:stamp};
  }finally{lock.releaseLock();}
}
function zipDeleteBoard_(id){return zipDeleteBoards_([id]);}
function zipDeleteBoards_(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(function(id){return typeof id!=='string'||!/^[a-zA-Z0-9-]{20,80}$/.test(id);}))throw new Error('Invalid board selection');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var sh=zipBoardSheet_(),rows=sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,12).getDisplayValues();
    var indices=ids.map(function(id){var i=rows.findIndex(function(r){return r[0]===id&&!r[9];});if(i<0)throw new Error('Unknown board note');return i;});
    sh.getRangeList(indices.map(function(i){return 'J'+(i+2);})).setValue(new Date().toISOString());return {ok:true};
  }finally{lock.releaseLock();}
}
