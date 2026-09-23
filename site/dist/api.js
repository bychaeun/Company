(function () {
  'use strict';
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
