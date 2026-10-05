(function () {
  'use strict';
  if (location.protocol === 'file:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    window.ZIP_LOCAL_PREVIEW = true;
    let records = [
      {noteId:'preview:2',category:'효산 LPL 기본',subcategory:'샘플',title:'샘플별 크기 사양',content:'사이즈\n\n100X100\n140X120\n300X300',updatedAt:'2026-10-05',images:[],imageText:''},
      {noteId:'preview:3',category:'효산 LPL 기본',subcategory:'유해물질',title:'유해물질 종류',content:'업무에서 자주 확인하는 유해물질 정보를 정리합니다.',updatedAt:'2026-10-05',images:[],imageText:''},
      {noteId:'preview:4',category:'효산 LPL 기본',subcategory:'프레스',title:'프레스 사이즈',content:'가장 큰게 4*9자 사이즈 밖에 없음.',updatedAt:'2026-10-05',images:[],imageText:''},
      {noteId:'preview:5',category:'업체별 특징',subcategory:'유통업체',title:'더하임',address:'서울 서초구 3층',content:'담당자와 거래 특징을 간단히 정리한 예시 메모입니다.',updatedAt:'2026-10-05',images:[],imageText:''},
      {noteId:'preview:6',category:'효산 LPL 기본',subcategory:'샘플',title:'샘플 각인 표기법',content:'효산 넘버 + 수입:S / 국산:O + 이름',updatedAt:'2026-10-05',images:[],imageText:''},
      {noteId:'preview:7',category:'효산 LPL 기본',subcategory:'지출결의서',title:'지출결의서',content:'매주 월요일에 제출한다.\n영수증은 꼭 챙겨서 뒤에 붙인다.',updatedAt:'2026-10-05',images:[],imageText:''},
      {noteId:'preview:8',category:'기계 사용법',subcategory:'연구실',title:'샘플 각인하는 법',content:'연구실 기계 사용 순서를 기록합니다.',updatedAt:'2026-10-05',images:[],imageText:''},
      {noteId:'preview:9',category:'용어 정리',subcategory:'LPM이란',title:'LPM 관련 용어 및 제조방식',content:'기공에 요소수지를 함침 후 건조하고 멜라민 코팅을 진행한다.',updatedAt:'2026-10-05',images:[],imageText:''}
    ];
    let checklist = [{row:2,done:false,task:'로컬 미리보기 할 일',date:new Date().toISOString().slice(0,10),time:'09:00',note:'실제 캘린더에는 저장되지 않아요.',calendar:false}];
    const clone = value => JSON.parse(JSON.stringify(value));
    window.ZIP_API = {
      async request(action,payload={}) {
        if(action==='me')return {ok:true,user:{sub:'local-preview',email:'로컬 파일 미리보기',name:'채은',role:'admin',status:'approved'}};
        if(action==='notes')return {ok:true,records:clone(records),syncedAt:new Date().toISOString(),syncMode:'preview'};
        if(action==='createNote'){records.push({...payload,noteId:`preview:${Date.now()}`,updatedAt:new Date().toISOString().slice(0,10),images:[]});return {ok:true};}
        if(action==='updateNote'){const index=records.findIndex(item=>item.noteId===payload.noteId);if(index>=0)records[index]={...records[index],...payload,updatedAt:new Date().toISOString().slice(0,10)};return {ok:true};}
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
  let token = sessionStorage.getItem('chae-session') || '';
  const imageCache = new Map();
  let generation = 0;
  async function request(action, payload = {}, anonymous = false) {
    const response = await fetch(endpoint, { method:'POST', redirect:'follow', cache:'no-store', credentials:'omit',
      headers:{'content-type':'text/plain;charset=utf-8'}, signal:AbortSignal.timeout(40000),
      body:JSON.stringify({ ...payload, action, sessionToken:anonymous ? undefined : token }) });
    if (!response.ok) throw new Error('Google 연결을 확인할 수 없어요.');
    const data = await response.json();
    if (!data.ok) {
      if (data.code === 'AUTH_REQUIRED') { setToken(''); window.dispatchEvent(new Event('access-expired')); }
      if (data.code === 'FORBIDDEN') window.dispatchEvent(new Event('access-expired'));
      throw new Error(data.error || '요청에 실패했어요.');
    }
    return data;
  }
  function clearImages() { generation++; imageCache.forEach(p => p.then(url => { if(url)URL.revokeObjectURL(url); }).catch(()=>{})); imageCache.clear(); }
  function setToken(value) { token=value; if(value)sessionStorage.setItem('chae-session',value); else sessionStorage.removeItem('chae-session'); clearImages(); }
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
  window.ZIP_API = { request, image, setToken, clearImages, get hasSession(){return !!token;},
    async config(){ const response=await fetch(endpoint+'?action=config',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)}); if(!response.ok)throw new Error(); return response.json(); } };
})();

