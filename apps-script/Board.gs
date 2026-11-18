var ZIP_BOARD_HEADERS=['ID','제목','내용','사이트','색상','X','Y','연결 ID','수정일','삭제일','대지 ID','사이트 목록(JSON)','너비','높이','이미지 목록(JSON)'];
var ZIP_BOARD_COLS=ZIP_BOARD_HEADERS.length;
var ZIP_ARTBOARD_HEADERS=['ID','제목','수정일','삭제일'];
function zipBoardSheet_(){
  var ss=zipSheet_(),sh=ss.getSheetByName('디자인 보드');
  if(!sh){sh=ss.insertSheet('디자인 보드');sh.getRange(1,1,1,ZIP_BOARD_COLS).setValues([ZIP_BOARD_HEADERS]);sh.setFrozenRows(1);}
  var headers=sh.getRange(1,1,1,ZIP_BOARD_COLS).getDisplayValues()[0];
  if(!ZIP_BOARD_HEADERS.every(function(h,i){return i>=10&&!headers[i]||h===headers[i];}))throw new Error('Invalid board headers');
  // Columns added later (대지, 사이트 목록, 크기, 이미지) are filled in once on older sheets.
  if(headers.slice(10).some(function(h){return !h;}))sh.getRange(1,11,1,ZIP_BOARD_COLS-10).setValues([ZIP_BOARD_HEADERS.slice(10)]);return sh;
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
// Note images: HTTPS links (Drive photos taken in the app or pasted image addresses), at most 12.
function zipBoardImages_(images){
  if(!Array.isArray(images)||images.length>12)throw new Error('Invalid board images');
  return images.reduce(function(all,url){if(typeof url!=='string')throw new Error('Invalid board image');url=url.trim();if(!url)return all;if(url.length>2000||!/^https:\/\/[^\s<>"']+$/i.test(url))throw new Error('Invalid board image');if(all.indexOf(url)<0)all.push(url);return all;},[]);
}
// 0 means the default size (260px wide, height follows the content).
function zipBoardSize_(value,min,max){
  if(value===''||value===null||value===0||value==='0')return 0;var n=Math.round(Number(value));
  if(!isFinite(n)||n<min||n>max)throw new Error('Invalid board size');return n;
}
function zipBoardRow_(r){
  var urls,images;try{urls=zipBoardUrls_(r[11]?JSON.parse(r[11]):undefined,r[3]);}catch(e){urls=[];}
  try{images=r[14]?zipBoardImages_(JSON.parse(r[14])):[];}catch(e){images=[];}
  var width,height;try{width=zipBoardSize_(r[12],ZIP_BOARD_MIN_W,ZIP_BOARD_MAX_W);}catch(e){width=0;}try{height=zipBoardSize_(r[13],ZIP_BOARD_MIN_H,ZIP_BOARD_MAX_H);}catch(e){height=0;}
  return {id:r[0],title:r[1],content:r[2],url:urls[0]||'',urls:urls,color:r[4]||'cream',x:Number(r[5])||0,y:Number(r[6])||0,link:r[7],boardId:r[10]||'default',updatedAt:r[8],width:width,height:height,images:images};
}
var ZIP_BOARD_MIN_W=180,ZIP_BOARD_MAX_W=1600,ZIP_BOARD_MIN_H=120,ZIP_BOARD_MAX_H=2400;
function zipBoard_(){var sh=zipBoardSheet_();if(sh.getLastRow()<2)return [];return sh.getRange(2,1,sh.getLastRow()-1,ZIP_BOARD_COLS).getDisplayValues().filter(function(r){return r[0]&&!r[9];}).map(zipBoardRow_);}
function zipBoardInput_(b){
  var x={};['id','title','content','url','color','link'].forEach(function(k){x[k]=String(b[k]||'').trim();});x.boardId=String(b.boardId||'default');x.urls=zipBoardUrls_(b.urls,x.url);x.url=x.urls[0]||'';
  if(!/^[a-zA-Z0-9-]{20,80}$/.test(x.id)||!x.title||x.title.length>200||x.content.length>8000||!zipArtboardId_(x.boardId)||['cream','pink','mint','lavender','photo'].indexOf(x.color)<0||x.link&&!/^[a-zA-Z0-9-]{20,80}$/.test(x.link)||x.link===x.id)throw new Error('Invalid board note');
  x.x=Number(b.x);x.y=Number(b.y);if(!isFinite(x.x)||!isFinite(x.y)||Math.abs(x.x)>100000||Math.abs(x.y)>100000)throw new Error('Invalid board position');
  // Left undefined when an older app saves, so the stored size and images are kept.
  if(b.width!==undefined)x.width=zipBoardSize_(b.width,ZIP_BOARD_MIN_W,ZIP_BOARD_MAX_W);
  if(b.height!==undefined)x.height=zipBoardSize_(b.height,ZIP_BOARD_MIN_H,ZIP_BOARD_MAX_H);
  if(b.images!==undefined)x.images=zipBoardImages_(b.images);return x;
}
function zipSaveBoard_(body){
  var x=zipBoardInput_(body),lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var sh=zipBoardSheet_(),rows=sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,ZIP_BOARD_COLS).getDisplayValues(),index=rows.findIndex(function(r){return r[0]===x.id;});
    if(index>=0&&rows[index][9])throw new Error('Deleted board note');
    var old=index>=0?zipBoardRow_(rows[index]):{width:0,height:0,images:[]};
    if(index>=0){if(body.boardId===undefined)x.boardId=old.boardId;if(body.urls===undefined&&x.url===old.url)x.urls=old.urls;}
    ['width','height','images'].forEach(function(k){if(x[k]===undefined)x[k]=old[k];});
    if(x.boardId!=='default'&&!zipArtboards_().some(function(b){return b.id===x.boardId;}))throw new Error('Unknown artboard');
    if(x.link&&!rows.some(function(r){return r[0]===x.link&&!r[9]&&(r[10]||'default')===x.boardId;}))throw new Error('Invalid board connection');
    var stamp=new Date().toISOString();sh.getRange(index<0?sh.getLastRow()+1:index+2,1,1,ZIP_BOARD_COLS).setNumberFormat('@').setValues([[x.id,x.title,x.content,x.urls[0]||'',x.color,String(x.x),String(x.y),x.link,stamp,'',x.boardId,JSON.stringify(x.urls),x.width?String(x.width):'',x.height?String(x.height):'',x.images.length?JSON.stringify(x.images):''].map(zipSafeCell_)]);return {ok:true,updatedAt:stamp};
  }finally{lock.releaseLock();}
}
function zipDeleteBoard_(id){return zipDeleteBoards_([id]);}
function zipDeleteBoards_(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(function(id){return typeof id!=='string'||!/^[a-zA-Z0-9-]{20,80}$/.test(id);}))throw new Error('Invalid board selection');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{var sh=zipBoardSheet_(),rows=sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,ZIP_BOARD_COLS).getDisplayValues();
    var indices=ids.map(function(id){var i=rows.findIndex(function(r){return r[0]===id&&!r[9];});if(i<0)throw new Error('Unknown board note');return i;});
    zipDeleteRows_(sh,indices.map(function(i){return i+2;}));SpreadsheetApp.flush();return {ok:true};
  }finally{lock.releaseLock();}
}
// Photos added to board notes are private Drive files; admins read them only while a note still uses them.
function zipBoardImage_(id){
  id=String(id||'');if(!/^[-\w]{10,200}$/.test(id))throw new Error('Invalid image');
  var used=zipBoard_().some(function(n){return n.images.some(function(url){return zipDriveId_(url)===id;});});
  if(!used)throw new Error('Unknown board image');
  var file=DriveApp.getFileById(id),type=file.getMimeType();
  if(!/^image\/(png|jpeg|webp|gif)$/.test(type)||file.getSize()>4*1024*1024)throw new Error('Unsupported image');
  return {ok:true,mime:type,base64:Utilities.base64Encode(file.getBlob().getBytes())};
}
