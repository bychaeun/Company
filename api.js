(function () {
  'use strict';
  if (location.protocol === 'file:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    window.ZIP_LOCAL_PREVIEW = true;
    let records = [{noteId:'preview:2',category:'예시',subcategory:'사용 안내',title:'미리보기 메모',content:'이 항목은 화면 확인용 가상 예시입니다.',updatedAt:'',images:[],imageText:''}];
    let checklist = [{row:2,done:false,task:'로컬 미리보기 할 일',date:new Date().toISOString().slice(0,10),time:'09:00',note:'실제 캘린더에는 저장되지 않아요.',calendar:false}];
    const clone = value => JSON.parse(JSON.stringify(value));
    let specs = [],board=[],artboards=[{id:'default',title:'기본 대지'}];
    window.ZIP_API = {
      async request(action,payload={}) {
        if(action==='board')return {ok:true,items:clone(board),artboards:clone(artboards)};
        if(action==='saveBoard'){board=board.filter(n=>n.id!==payload.id).concat(clone(payload));return {ok:true};}
        if(action==='deleteBoard'){board=board.filter(n=>n.id!==payload.id);return {ok:true};}
        if(action==='deleteBoards'){board=board.filter(n=>!payload.ids.includes(n.id));return {ok:true};}
        if(action==='saveArtboard'){artboards=artboards.filter(b=>b.id!==payload.id).concat(clone(payload));return {ok:true,...payload};}
        if(action==='specs')return {ok:true,items:clone(specs)};
        if(action==='saveSpec'){const item={...payload,id:payload.id||String(Date.now())};const index=specs.findIndex(x=>x.id===item.id);if(index<0)specs.push(item);else specs[index]=item;return {ok:true,id:item.id};}
        if(action==='deleteSpec'){specs=specs.filter(x=>x.id!==payload.id);return {ok:true};}
        if(action==='geocodeSpec')return {ok:true,configured:false,locations:[]};
        if(action==='me')return {ok:true,user:{sub:'local-preview',email:'로컬 파일 미리보기',name:'채은',role:'admin',status:'approved'}};
        if(action==='notes')return {ok:true,records:clone(records),syncedAt:new Date().toISOString(),syncMode:'preview'};
        if(action==='createNote'){const noteId=`preview:${Date.now()}`;records.push({...payload,noteId,updatedAt:new Date().toISOString().slice(0,10),images:[]});return {ok:true,noteId};}
        if(action==='updateNote'){const index=records.findIndex(item=>item.noteId===payload.noteId);if(index>=0)records[index]={...records[index],...payload,updatedAt:new Date().toISOString().slice(0,10)};return {ok:true,noteId:payload.noteId};}
        if(action==='deleteNotes'){records=records.filter(item=>!payload.noteIds.includes(item.noteId));return {ok:true};}
        if(action==='deleteNote'){records=records.filter(item=>item.noteId!==payload.noteId);return {ok:true};}
        if(action==='uploadNoteImage')return {ok:true,fileId:`preview-image-${Date.now()}`};
        if(action==='checklist')return {ok:true,items:clone(checklist)};
        if(action==='addChecklist'){checklist.push({row:Date.now(),done:false,task:payload.task,date:payload.date,time:payload.time,note:payload.note,calendar:false});return {ok:true};}
        if(action==='toggleChecklist'){const item=checklist.find(entry=>entry.row===payload.row);if(item)item.done=payload.done;return {ok:true};}
        if(action==='deleteChecklist'){checklist=checklist.filter(entry=>entry.row!==payload.row);return {ok:true};}
        if(action==='users')return {ok:true,users:[]};
        return {ok:true};
      },
      async image(){return '';}, setToken(){}, clearImages(){}, get hasSession(){return true;},
      async config(){return {ok:true,configured:true,clientId:'local-preview'};}
    };
    return;
  }
  const endpoint = window.COMPANY_CONFIG.API_URL;
  const sessionKey = 'chae-session';
  const userHintKey='chae-user-hint';
  let token = localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey) || '';
  if (token) localStorage.setItem(sessionKey, token);
  sessionStorage.removeItem(sessionKey);
  const imageCache = new Map();
  let generation = 0;
  let sessionVersion = 0;
  const reads=new Map();
  function rememberUser(user){try{if(user?.status==='approved'&&token)localStorage.setItem(userHintKey,JSON.stringify({sessionTag:token.slice(-20),user}));else localStorage.removeItem(userHintKey);}catch{}}
  function rememberedUser(){try{const hint=JSON.parse(localStorage.getItem(userHintKey)||'null');return token&&hint?.sessionTag===token.slice(-20)&&hint.user?.status==='approved'?hint.user:null;}catch{return null;}}
  function request(action,payload={},anonymous=false){
    if(!['me','notes','specs','board','checklist'].includes(action))return send(action,payload,anonymous);
    const key=JSON.stringify([sessionVersion,action,payload,anonymous]);if(reads.has(key))return reads.get(key);
    const promise=send(action,payload,anonymous).finally(()=>reads.delete(key));reads.set(key,promise);return promise;
  }
  async function send(action, payload = {}, anonymous = false) {
    const version = sessionVersion;
    const response = await fetch(endpoint, { method:'POST', redirect:'follow', cache:'no-store', credentials:'omit',
      headers:{'content-type':'text/plain;charset=utf-8'}, signal:AbortSignal.timeout(['createNote','updateNote','uploadNoteImage'].includes(action)?90000:40000),
      body:JSON.stringify({ ...payload, action, sessionToken:anonymous ? undefined : token }) });
    if (!response.ok) throw new Error('Google 연결을 확인할 수 없어요.');
    const data = await response.json();
    if (!anonymous && version !== sessionVersion) throw Object.assign(new Error('이전 로그인 요청입니다.'), {code:'STALE_SESSION'});
    if (!data.ok) {
      if (!anonymous && version === sessionVersion) {
        if (data.code === 'AUTH_REQUIRED') { setToken(''); window.dispatchEvent(new Event('access-expired')); }
        if (data.code === 'FORBIDDEN') {rememberUser(null);window.dispatchEvent(new Event('access-expired'));}
      }
      const error = new Error(data.error || '요청에 실패했어요.');
      error.code = data.code;
      throw error;
    }
    return data;
  }
  function clearImages() { generation++; imageCache.forEach(p => p.then(url => { if(url)URL.revokeObjectURL(url); }).catch(()=>{})); imageCache.clear(); }
  function setToken(value) { sessionVersion++; token=value;rememberUser(null);if(value)localStorage.setItem(sessionKey,value); else localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey); clearImages(); }
  window.addEventListener('storage', event => {
    if (event.key !== sessionKey && event.key !== null) return;
    token = localStorage.getItem(sessionKey) || ''; sessionVersion++; clearImages();
    window.dispatchEvent(new Event(token ? 'session-restored' : 'access-expired'));
  });
  async function image(fileId) {
    if(!/^[-\w]{10,200}$/.test(fileId))return '';
    if(!imageCache.has(fileId)) {
      const version = generation;
      const promise = request('image',{fileId}).then(data=>{
        if(!/^image\/(png|jpeg|webp|gif)$/.test(data.mime)||version!==generation)return '';
        const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));
        return URL.createObjectURL(new Blob([bytes],{type:data.mime}));
      }).catch(error=>{imageCache.delete(fileId);throw error;});
      imageCache.set(fileId,promise);
    }
    return imageCache.get(fileId);
  }
  window.ZIP_API = { request, image, setToken, clearImages, rememberUser,get rememberedUser(){return rememberedUser();},get hasSession(){return !!token;},
    async config(){ const response=await fetch(endpoint+'?action=config',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)}); if(!response.ok)throw new Error(); return response.json(); } };
})();

