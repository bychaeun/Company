(function () {
  'use strict';
  const $=id=>document.getElementById(id), api=window.ZIP_API;
  let currentUser=null, checking=null, loginReady=false, configured=false;
  function update(user,message='') {
    currentUser=user;
    const approved=user?.status==='approved';
    $('private-app').hidden=!approved; $('auth-panel').hidden=approved;
    $('logout-button').hidden=!user; $('admin-button').hidden=user?.role!=='admin';
    $('google-login').hidden=!!user; $('check-approval').hidden=!user;
    document.querySelector('.sync-state').hidden=!approved;
    $('auth-title').textContent=!user?'채은 지식 저장소':user.status==='rejected'?'접근이 제한된 계정이에요':'채은님의 승인을 기다리고 있어요';
    $('auth-message').textContent=message||(user?`${user.email} · 채은님이 승인하면 메모를 볼 수 있어요.`:'Google 계정으로 로그인하고 메모를 만나보세요.');
    if(!approved){$('detail-dialog').close();$('admin-dialog').close();api.clearImages();}
    window.dispatchEvent(new CustomEvent('access-change',{detail:user}));
  }
  async function renderLogin() {
    if(!configured || !window.google?.accounts?.id)return;
    const {nonce}=await api.request('challenge',{},true);
    google.accounts.id.initialize({client_id:configured.clientId,nonce,auto_select:false,callback:async result=>{
      $('auth-message').textContent='로그인과 승인 상태를 확인하고 있어요.';
      try {const data=await api.request('login',{idToken:result.credential,nonce},true);api.setToken(data.sessionToken);update(data.user);}
      catch(error){update(null,error.message); await renderLogin();}
    }});
    $('google-login').replaceChildren();
    google.accounts.id.renderButton($('google-login'),{type:'standard',theme:'outline',size:'large',text:'signin_with',shape:'pill',locale:'ko'});
    loginReady=true;
  }
  async function check() {
    if(checking)return checking;
    checking=(async()=>{
      try {
        if(api.hasSession){const result=await api.request('me');update(result.user);return result.user;}
        update(null,configured?'Google 계정으로 로그인하고 메모를 만나보세요.':'Google 로그인 연결을 준비하고 있어요.');
      }catch(error){update(null,error.message);}
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
    try{await api.request('logout');}catch(e){/* Drop this device's bearer even on offline logout. */}
    api.setToken('');window.google?.accounts?.id?.disableAutoSelect();update(null);renderLogin().catch(()=>{});
  };
  $('admin-button').onclick=()=>{$('admin-dialog').showModal();loadUsers();};
  $('admin-close').onclick=()=>$('admin-dialog').close();
  $('admin-sync').onclick=()=>{window.dispatchEvent(new Event('notes-refresh'));$('admin-message').textContent='메모에서 최신 시트 자료를 다시 확인하고 있어요.';};
  window.addEventListener('access-expired',()=>{update(null,'승인 상태 또는 로그인 만료를 확인해 주세요.');});
  window.addEventListener('pageshow',check);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
  setInterval(()=>{if(!document.hidden)check();},60000);
  // A fresh nonce is required after a long idle period before attempting another login.
  setInterval(()=>{if(!currentUser&&loginReady&&!document.hidden)renderLogin().catch(()=>{});},240000);
  window.CHAE_AUTH={check,get user(){return currentUser;}};
  (async()=>{
    try{
      const cfg=await api.config();
      if(!cfg.ok||!cfg.configured||!cfg.clientId)throw new Error('Google 로그인 연결을 준비하고 있어요. 관리자 설정 후 사용할 수 있습니다.');
      configured=cfg;
      const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
      script.onload=()=>renderLogin().catch(error=>update(null,error.message));
      script.onerror=()=>update(null,'Google 로그인 화면을 불러오지 못했어요. Chrome 또는 Safari에서 다시 열어 주세요.');
      document.head.append(script);await check();
    }catch(error){update(null,error.message||'Google 연결을 확인할 수 없어요.');}
  })();
})();
