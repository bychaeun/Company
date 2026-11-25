(function () {
  'use strict';
  if (location.protocol === 'file:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    window.ZIP_LOCAL_PREVIEW = true;
    let records = [{noteId:'preview:2',category:'예시',subcategory:'사용 안내',title:'미리보기 메모',content:'이 항목은 화면 확인용 가상 예시입니다.',updatedAt:'',images:[],imageText:''}];
    let checklist = [{row:2,done:false,task:'로컬 미리보기 할 일',date:new Date().toISOString().slice(0,10),time:'09:00',note:'실제 캘린더에는 저장되지 않아요.',calendar:false}];
    const clone = value => JSON.parse(JSON.stringify(value));
    const previewImages = new Map();
    let sampleBooks=[];
    let specs = [],board=[],artboards=[{id:'default',title:'기본 대지'}];
    const registry={numbers:{headers:['종이넘버','스펙넘버','비고'],items:[]},sites:{headers:['현장명','종이넘버','스펙넘버','경면','모델하우스 예정일','본납 예정일','설계사','진행상태','비고'],items:[]}};
    window.ZIP_API = {
      async request(action,payload={}) {
        if(action==='specRegistry')return {ok:true,lists:clone(registry),mapItems:clone(specs),unifiedSites:false,registryPhotoUrls:true,paperPhotoUrls:true,statuses:['제안 중','스펙 확정','모델하우스 진행','본납 대기','본납 완료','보류'],syncedAt:new Date().toISOString()};
        if(action==='saveSpecRegistry'){const before=registry[payload.kind].items.find(r=>r.id===payload.id),urls=payload.imageUrls??before?.imageUrls??[];const item={id:payload.id,values:clone(payload.values),version:String(Date.now()),imageUrls:clone(urls),photoVersion:JSON.stringify(urls)};registry[payload.kind].items=registry[payload.kind].items.filter(r=>r.id!==item.id).concat(item);return {ok:true,item:clone(item)};}
        if(action==='deleteSpecRegistry'){registry[payload.kind].items=registry[payload.kind].items.filter(r=>r.id!==payload.id);return {ok:true};}
        if(action==='sampleBooks')return {ok:true,items:clone(sampleBooks),template:true};
        if(action==='saveSampleBook'){const item={...clone(payload),created:new Date().toISOString()};sampleBooks=sampleBooks.filter(r=>r.id!==item.id).concat(item);return {ok:true,item};}
        if(action==='deleteSampleBook'){sampleBooks=sampleBooks.filter(r=>r.id!==payload.id);return {ok:true};}
        if(action==='sampleBookReport')return {ok:true,name:'주간 샘플북 분출 리스트_미리보기.pdf',count:0,books:0,base64:btoa('%PDF-1.4 preview')};
        if(action==='board')return {ok:true,items:clone(board),artboards:clone(artboards),boardMedia:true};
        if(action==='saveBoard'){board=board.filter(n=>n.id!==payload.id).concat(clone(payload));return {ok:true};}
        if(action==='deleteBoard'){board=board.filter(n=>n.id!==payload.id);return {ok:true};}
        if(action==='deleteBoards'){board=board.filter(n=>!payload.ids.includes(n.id));return {ok:true};}
        if(action==='saveArtboard'){artboards=artboards.filter(b=>b.id!==payload.id).concat(clone(payload));return {ok:true,...payload};}
        if(action==='specs')return {ok:true,siteSchemaVersion:2,items:clone(specs)};
        if(action==='saveSpec'){const item={...payload,id:payload.id||String(Date.now()),updatedAt:new Date().toISOString()};if(item.lat===''||item.lat==null){item.lat=37.5665;item.lng=126.978;}item.papers=(item.papers||[]).map(p=>({...p,date:p.date||new Date().toISOString().slice(0,10)}));const index=specs.findIndex(x=>x.id===item.id);if(index<0)specs.push(item);else specs[index]=item;return {ok:true,id:item.id,papers:item.papers,lat:item.lat,lng:item.lng};}   // 미리보기: 위치를 안 고르면 서울로
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
      // Photos picked in preview stay on this page only.
      async image(fileId){return previewImages.get(fileId)||'';}, seedImage(fileId,blob){if(blob)previewImages.set(fileId,URL.createObjectURL(blob));}, setToken(){}, clearImages(){}, get hasSession(){return true;},
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
  const recentReads=new Map();let readRevision=0;
  const cacheable=['notes','specs','specRegistry','board','checklist'];
  const snapshotKey='chae-data-v1',snapshotAge=24*60*60*1000;
  function snapshot(){try{const saved=JSON.parse(localStorage.getItem(snapshotKey)||'null');return token&&saved?.sessionTag===token.slice(-20)?saved:{sessionTag:token.slice(-20),entries:{}};}catch{return {sessionTag:token.slice(-20),entries:{}};}}
  function stored(action){const entry=snapshot().entries?.[action];return entry&&Date.now()-entry.at<snapshotAge&&Date.now()>=entry.at?entry:null;}
  function cached(action){const user=window.CHAE_AUTH?.user;if(window.ZIP_AUTH_PENDING||user?.status!=='approved'||action!=='notes'&&user.role!=='admin')return null;const entry=stored(action);return entry?{...JSON.parse(JSON.stringify(entry.data)),clientSnapshot:true}:null;}
  function saveSnapshot(action,data){if(!token||!['notes','specs','specRegistry','board'].includes(action))return;try{const saved=snapshot();saved.entries[action]={at:Date.now(),data};const text=JSON.stringify(saved);if(text.length<=2000000)localStorage.setItem(snapshotKey,text);}catch{}}
  function clearReads(dropSaved=false){readRevision++;recentReads.clear();reads.clear();if(dropSaved)try{localStorage.removeItem(snapshotKey);}catch{}}
  function rememberUser(user){try{if(user?.status==='approved'&&token)localStorage.setItem(userHintKey,JSON.stringify({sessionTag:token.slice(-20),user}));else localStorage.removeItem(userHintKey);}catch{}}
  function rememberedUser(){try{const hint=JSON.parse(localStorage.getItem(userHintKey)||'null');return token&&hint?.sessionTag===token.slice(-20)&&hint.user?.status==='approved'?hint.user:null;}catch{return null;}}
  function request(action,payload={},anonymous=false){
    if(!anonymous&&window.ZIP_AUTH_PENDING&&action!=='me'&&cacheable.includes(action)&&window.CHAE_AUTH?.check){
      return window.CHAE_AUTH.check().then(user=>{if(window.ZIP_AUTH_PENDING)throw new Error('로그인 확인이 지연되고 있어요. 잠시 후 다시 시도해 주세요.');if(user?.status!=='approved')throw new Error('승인된 로그인이 필요합니다.');return request(action,payload,anonymous);});
    }
    if(!['me',...cacheable].includes(action)){
      const mutation=/^(createNote|updateNote|deleteNote|deleteNotes|saveSpec|deleteSpec|saveSpecRegistry|deleteSpecRegistry|saveBoard|deleteBoard|deleteBoards|saveArtboard|addChecklist|toggleChecklist|deleteChecklist)$/.test(action);
      if(mutation)clearReads(true);return send(action,payload,anonymous).finally(()=>{if(mutation)clearReads(true);});
    }
    if(payload.force)clearReads();
    const normalized={...payload};delete normalized.force;
    const version=sessionVersion,revision=readRevision,key=JSON.stringify([version,revision,action,normalized,anonymous]);
    const cached=recentReads.get(key);if(!payload.force&&cacheable.includes(action)&&cached&&Date.now()-cached.at<30000)return Promise.resolve({...cached.data,clientCacheHit:true});
    if(reads.has(key))return reads.get(key);
    const promise=send(action,payload,anonymous).then(data=>{
      if(version===sessionVersion&&revision===readRevision){
        if(cacheable.includes(action)){recentReads.set(key,{at:Date.now(),data});if(!anonymous)saveSnapshot(action,data);}
        if(action==='me'&&data.user?.status==='approved'&&Array.isArray(data.records)){recentReads.set(JSON.stringify([version,revision,'notes',{},false]),{at:Date.now(),data});saveSnapshot('notes',data);}
      }return data;
    }).finally(()=>reads.delete(key));reads.set(key,promise);return promise;
  }
  async function send(action, payload = {}, anonymous = false) {
    const version = sessionVersion;
    const response = await fetch(endpoint, { method:'POST', redirect:'follow', cache:'no-store', credentials:'omit',
      headers:{'content-type':'text/plain;charset=utf-8'}, signal:AbortSignal.timeout(['createNote','updateNote','uploadNoteImage','sampleBookReport'].includes(action)?90000:40000),
      body:JSON.stringify({ ...payload, action, sessionToken:anonymous ? undefined : token }) });
    if (!response.ok) throw new Error('Google 연결을 확인할 수 없어요.');
    const data = await response.json();
    if (!anonymous && version !== sessionVersion) throw Object.assign(new Error('이전 로그인 요청입니다.'), {code:'STALE_SESSION'});
    if (!data.ok) {
      if (!anonymous && version === sessionVersion) {
        if (data.code === 'AUTH_REQUIRED') { setToken(''); window.dispatchEvent(new Event('access-expired')); }
        if (data.code === 'FORBIDDEN') {clearReads(true);rememberUser(null);window.dispatchEvent(new Event('access-expired'));}
      }
      const error = new Error(data.error || '요청에 실패했어요.');
      error.code = data.code;
      throw error;
    }
    return data;
  }
  // Private images are cached on this device (like the notes snapshot) and dropped on logout or access change.
  const imageStore='chae-private-images-v1',imageTypes=/^image\/(png|jpeg|webp|gif)$/;
  const storeKey=key=>new URL('__private-image/'+encodeURIComponent(key),location.href).href;
  async function storedImage(key){try{if(!window.caches)return null;const hit=await (await caches.open(imageStore)).match(storeKey(key));if(!hit)return null;const blob=await hit.blob();return imageTypes.test(blob.type)?blob:null;}catch{return null;}}
  function storeImage(key,blob,version){if(!window.caches||version!==generation||!token)return;caches.open(imageStore).then(cache=>version===generation&&cache.put(storeKey(key),new Response(blob,{headers:{'content-type':blob.type}}))).catch(()=>{});}
  function toBlob(data){if(!data||!imageTypes.test(data.mime)||typeof data.base64!=='string')return null;const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));return new Blob([bytes],{type:data.mime});}
  function clearImages() { generation++; thumbQueue.clear(); imageCache.forEach(p => p.then(url => { if(url)URL.revokeObjectURL(url); }).catch(()=>{})); imageCache.clear(); try{window.caches?.delete(imageStore).catch(()=>{});}catch{} }
  function setToken(value) { sessionVersion++;clearReads(true);token=value;rememberUser(null);if(value)localStorage.setItem(sessionKey,value); else localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey); clearImages(); }
  window.addEventListener('storage', event => {
    if (event.key !== sessionKey && event.key !== null) return;
    token = localStorage.getItem(sessionKey) || ''; sessionVersion++;clearReads(true);clearImages();
    window.dispatchEvent(new Event(token ? 'session-restored' : 'access-expired'));
  });
  window.addEventListener('access-change',event=>{if(event.detail?.status!=='approved')clearReads(true);});
  // Card previews are batched: a page of 20 cards becomes a few small requests instead of 20 full-size ones.
  const thumbQueue=new Map();let thumbTimer=null,thumbsSupported=true;
  function queueThumb(fileId){return new Promise((resolve,reject)=>{if(!thumbQueue.has(fileId))thumbQueue.set(fileId,[]);thumbQueue.get(fileId).push({resolve,reject});if(!thumbTimer)thumbTimer=setTimeout(flushThumbs,30);});}
  function flushThumbs(){
    thumbTimer=null;const entries=[...thumbQueue.entries()];thumbQueue.clear();
    for(let i=0;i<entries.length;i+=6){
      const chunk=entries.slice(i,i+6);
      const settle=(id,waiters,data)=>waiters.forEach(w=>w.resolve(data||null));
      (thumbsSupported?request('thumbs',{fileIds:chunk.map(([id])=>id)}):Promise.reject(Object.assign(new Error('unsupported'),{code:'UNSUPPORTED'})))
        .then(data=>chunk.forEach(([id,waiters])=>settle(id,waiters,data.images?.[id])))
        .catch(error=>{if(error.code==='REQUEST_FAILED')thumbsSupported=false;chunk.forEach(([,waiters])=>waiters.forEach(w=>w.reject(error)));});
    }
  }
  const imageActions=['image','registryImage','boardImage'];
  function seedImage(fileId,blob,action='image'){if(!/^[-\w]{10,200}$/.test(fileId)||!imageActions.includes(action)||!imageTypes.test(blob?.type||''))return;const key=(action==='image'?'':action+':')+'f:'+fileId;imageCache.set(key,Promise.resolve(URL.createObjectURL(blob)));storeImage(key,blob,generation);}
  async function image(fileId,options={}) {
    if(!/^[-\w]{10,200}$/.test(fileId))return '';
    const action=imageActions.includes(options.action)?options.action:'image',thumb=!!options.thumb&&action==='image',key=(action==='image'?'':action+':')+(thumb?'t:':'f:')+fileId;
    // cachedOnly: answer from memory or this device only, never the network (used for instant placeholders).
    if(options.cachedOnly){if(imageCache.has(key))return imageCache.get(key);const blob=await storedImage(key);if(!blob)return '';if(!imageCache.has(key))imageCache.set(key,Promise.resolve(URL.createObjectURL(blob)));return imageCache.get(key);}
    if(!imageCache.has(key)) {
      const version = generation;
      const promise=(async()=>{
        let blob=await storedImage(key);
        if(!blob&&thumb)blob=await storedImage('f:'+fileId);
        if(!blob&&thumb){try{blob=toBlob(await queueThumb(fileId));}catch(error){if(['AUTH_REQUIRED','FORBIDDEN','STALE_SESSION'].includes(error.code))throw error;}if(blob)storeImage(key,blob,version);}
        if(!blob){const full=thumb?await image(fileId):null;if(thumb)return full;blob=toBlob(await request(action,{fileId}));if(blob)storeImage(key,blob,version);}
        if(!blob||version!==generation)return '';
        return URL.createObjectURL(blob);
      })().catch(error=>{imageCache.delete(key);throw error;});
      imageCache.set(key,promise);
    }
    return imageCache.get(key);
  }
  window.ZIP_API = { request, image, seedImage, setToken, clearImages, rememberUser,cached,get hasCachedNotes(){return !!stored('notes');},get rememberedUser(){return rememberedUser();},get hasSession(){return !!token;},
    async config(){ const response=await fetch(endpoint+'?action=config',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)}); if(!response.ok)throw new Error(); return response.json(); } };
})();

