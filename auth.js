(function () {
  'use strict';
  const $=id=>document.getElementById(id), api=window.ZIP_API;
  let currentUser=null, checking=null, loginReady=false, configured=false;
  let authVersion=0, lastCheck=0;
  let rendering=null, loginBusy=false;
  let loginSetup=null, retryTimer=null, retryDelay=2000;
  function restoring(message='저장된 로그인으로 연결하고 있어요. 다시 로그인할 필요 없어요.') {
    document.body.classList.remove('auth-checking');
    $('auth-panel').hidden=false;
    $('private-app').hidden=true;
    $('google-login').hidden=true;
    $('check-approval').hidden=true;
    $('auth-title').textContent='다시 오셨네요 🍮';
    $('auth-message').textContent=message;
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer=setTimeout(()=>{retryTimer=null;if(api.hasSession)check();},retryDelay);
    retryDelay=Math.min(retryDelay*2,15000);
  }
  async function ensureLoginReady() {
    if(configured && window.google?.accounts?.id)return;
    if(loginSetup)return loginSetup;
    loginSetup=(async()=>{
      const cfg=await api.config();
      if(!cfg.ok||!cfg.configured||!cfg.clientId)throw new Error('Google 로그인 설정을 확인해 주세요.');
      configured=cfg;
      if(window.google?.accounts?.id)return;
      await new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src='https://accounts.google.com/gsi/client';script.async=true;
        const timeout=setTimeout(()=>{script.remove();reject(new Error('Google 연결이 지연돼요. 잠시 후 다시 시도해 주세요.'));},15000);
        script.onload=()=>{clearTimeout(timeout);resolve();};
        script.onerror=()=>{clearTimeout(timeout);script.remove();reject(new Error('Google 로그인 화면을 불러오지 못했어요.'));};
        document.head.append(script);
      });
    })().finally(()=>{loginSetup=null;});
    return loginSetup;
  }
  function update(user,message='') {
    document.body.classList.remove('auth-checking');
    currentUser=user;
    const approved=user?.status==='approved';
    $('private-app').hidden=!approved; $('auth-panel').hidden=approved;
    $('logout-button').hidden=!user; $('admin-button').hidden=user?.role!=='admin';
    $('checklist-nav-button').hidden=user?.role!=='admin';
    $('google-login').hidden=!!user; $('check-approval').hidden=!user;
    document.querySelector('.sync-state').hidden=!approved;
    $('auth-title').textContent=!user?'채은 지식 저장소':user.status==='rejected'?'접근이 제한된 계정이에요':'채은님의 승인을 기다리고 있어요';
    $('auth-message').textContent=message||(user?`${user.email} · 채은님이 승인하면 메모를 볼 수 있어요.`:'Google 계정으로 로그인하고 메모를 만나보세요.');
    if(!approved){$('detail-dialog').close();$('admin-dialog').close();api.clearImages();window.dispatchEvent(new Event('show-notes'));}
    window.dispatchEvent(new CustomEvent('access-change',{detail:user}));
  }
  async function renderLogin() {
    if(currentUser || api.hasSession || loginBusy)return;
    if(rendering)return rendering;
    rendering=(async()=>{await ensureLoginReady();if(!currentUser && !api.hasSession && !loginBusy)await prepareLogin();})().finally(()=>{rendering=null;});return rendering;
  }
  async function prepareLogin() {
    const {nonce}=await api.request('challenge',{},true);
    if(currentUser || api.hasSession || loginBusy)return;
    google.accounts.id.initialize({client_id:configured.clientId,nonce,auto_select:false,callback:async result=>{
      if(loginBusy)return;
      loginBusy=true;
      const version=++authVersion;
      $('auth-message').textContent='로그인과 승인 상태를 확인하고 있어요.';
      try {const data=await api.request('login',{idToken:result.credential,nonce},true);if(version!==authVersion)return;api.setToken(data.sessionToken);update(data.user);lastCheck=Date.now();}
      catch(error){if(version===authVersion)update(null,error.message);}
      finally{loginBusy=false;if(!currentUser)renderLogin().catch(()=>{});}
    }});
    $('google-login').replaceChildren();
    google.accounts.id.renderButton($('google-login'),{type:'standard',theme:'outline',size:'large',text:'signin_with',shape:'pill',locale:'ko'});
    loginReady=true;
  }
  async function check() {
    if(loginBusy)return currentUser;
    if(checking)return checking;
    const version=authVersion;
    checking=(async()=>{
      try {
        if(api.hasSession){const result=await api.request('me');if(version!==authVersion)return currentUser;lastCheck=Date.now();clearTimeout(retryTimer);retryDelay=2000;update(result.user);return result.user;}
        update(null,configured?'Google 계정으로 로그인하고 메모를 만나보세요.':'Google 로그인 연결을 준비하고 있어요.');
        renderLogin().catch(error=>{if(!currentUser && !api.hasSession)update(null,error.message);});
      }catch(error){
        if(version!==authVersion || error.code==='STALE_SESSION')return currentUser;
        if(api.hasSession && error.code!=='AUTH_REQUIRED' && error.code!=='FORBIDDEN'){
          if(!currentUser)restoring('연결이 잠시 느려요. 로그인은 유지한 채 자동으로 다시 연결하고 있어요.');
          scheduleRetry();return currentUser;
        }
        update(null,api.hasSession?'연결이 지연되고 있어요. 저장된 로그인으로 다시 연결합니다.':error.message);
        if(!api.hasSession)renderLogin().catch(()=>{});
      }
      return null;
    })().finally(()=>{checking=null;});return checking;
  }
  async function loadUsers() {
    $('admin-message').textContent='접근관리 시트를 읽고 있어요.';
    try{
      const {users}=await api.request('users');$('admin-users').replaceChildren();
      for(const user of users){
        const row=document.createElement('section');row.className='access-user';
        const title=document.createElement('strong');title.textContent=`${user.name||''} · ${user.email}`;
        const label=document.createElement('p');label.textContent=user.admin?'관리자':`${user.status} · 최근 로그인 ${user.lastLogin||'-'}`;row.append(title,label);
        if(!user.admin)for(const status of ['승인','거절','차단']){
          const button=document.createElement('button');button.className='install-button';button.textContent=status;
          button.onclick=async()=>{button.disabled=true;try{await api.request('setStatus',{sub:user.sub,status});await loadUsers();}catch(e){$('admin-message').textContent=e.message;button.disabled=false;}};
          row.append(button);
        }
        $('admin-users').append(row);
      }
      $('admin-message').textContent=`로그인한 계정 ${users.length}개 · 변경사항은 시트에도 저장돼요.`;
    }catch(error){$('admin-message').textContent=error.message;}
  }
  $('check-approval').onclick=check;
  $('logout-button').onclick=async()=>{
    authVersion++;
    clearTimeout(retryTimer);
    const revoke=api.request('logout').catch(()=>{});
    api.setToken('');window.google?.accounts?.id?.disableAutoSelect();update(null);renderLogin().catch(()=>{});
    await revoke;
  };
  $('admin-button').onclick=()=>{$('admin-dialog').showModal();loadUsers();};
  $('admin-close').onclick=()=>$('admin-dialog').close();
  $('admin-sync').onclick=()=>{window.dispatchEvent(new Event('notes-refresh'));$('admin-message').textContent='메모에서 최신 시트 자료를 다시 확인하고 있어요.';};
  window.addEventListener('access-expired',()=>{authVersion++;update(null,'승인 상태 또는 로그인 만료를 확인해 주세요.');renderLogin().catch(()=>{});});
  window.addEventListener('session-restored',()=>{authVersion++;check();});
  const checkOnResume=()=>{if(!document.hidden && Date.now()-lastCheck>=60000)check();};
  window.addEventListener('pageshow',checkOnResume);
  window.addEventListener('online',()=>{if(api.hasSession)check();});
  document.addEventListener('visibilitychange',checkOnResume);
  setInterval(()=>{if(!document.hidden)check();},60000);
  // A fresh nonce is required after a long idle period before attempting another login.
  setInterval(()=>{if(!currentUser&&loginReady&&!document.hidden)renderLogin().catch(()=>{});},240000);
  window.CHAE_AUTH={check,get user(){return currentUser;}};
  if(window.ZIP_LOCAL_PREVIEW){
    document.body.classList.add('local-preview');
    update({sub:'local-preview',email:'로컬 파일 미리보기',name:'채은',role:'admin',status:'approved'});
    document.querySelector('#logout-button').hidden=true;
    document.querySelector('#admin-button').hidden=true;
    document.querySelector('#sync-label').textContent='로컬 미리보기 · 시트에 저장되지 않음';
    return;
  }
  // Existing sessions need only one server check, not Google config/GSI/challenge.
  if(api.hasSession)restoring();
  check();
})();

