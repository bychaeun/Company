(function () {
  'use strict';
  let csrf = '', currentUser = null, checking = null;
  const $ = id => document.getElementById(id);
  const canRead = user => user?.status === 'approved';
  function update(user, message, configured = true) {
    currentUser = user;
    $('private-app').hidden = !canRead(user);
    $('auth-panel').hidden = canRead(user);
    $('logout-button').hidden = !user;
    $('admin-button').hidden = user?.role !== 'admin';
    $('google-login').hidden = Boolean(user);
    $('google-login').setAttribute('aria-disabled', String(!configured));
    if (configured) $('google-login').setAttribute('href', '/auth/google');
    else $('google-login').removeAttribute('href');
    document.querySelector('.sync-state').hidden = !canRead(user);
    $('check-approval').hidden = !user;
    $('auth-title').textContent = !user ? '채은 지식 저장소' : user.status === 'rejected' ? '접근이 제한된 계정이에요' : '채은님의 승인을 기다리고 있어요';
    $('auth-message').textContent = message || (user ? `${user.email} · 승인 후 메모를 볼 수 있어요.` : 'Google 계정으로 로그인하고 메모를 만나보세요.');
    if (!canRead(user)) {
      $('detail-dialog').close(); $('admin-dialog').close();
    }
    window.dispatchEvent(new CustomEvent('access-change', { detail: user }));
  }
  async function check() {
    if (checking) return checking;
    checking = (async () => {
      try {
        const response = await fetch('/api/me', { cache: 'no-store' });
        if (!response.ok) throw new Error();
        const result = await response.json(); csrf = result.csrf || '';
        const failed = new URLSearchParams(location.search).get('auth') === 'failed';
        update(result.user, !result.configured ? 'Google 로그인 및 비공개 시트 서버 연결을 준비하고 있어요. 아직 로그인할 수 없습니다.' : failed ? '로그인을 완료하지 못했어요. 다시 시도하거나 관리자에게 연결 상태를 확인해 주세요.' : '', result.configured);
        if (location.search) history.replaceState(null, '', location.pathname);
        return result.user;
      } catch { update(null, '서버 연결을 확인할 수 없어 메모 접근을 잠시 제한했어요.', false); return null; }
    })().finally(() => { checking = null; });
    return checking;
  }
  async function post(path, data = {}) {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(data) });
    if (!response.ok) throw new Error((await response.json()).error || '요청을 완료하지 못했어요.');
    return response.json();
  }
  async function loadUsers() {
    $('admin-message').textContent = '계정 목록을 불러오는 중이에요.';
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store' });
      if (!response.ok) throw new Error('관리자 권한 또는 시트 연결을 확인해 주세요.');
      const { users } = await response.json();
      $('admin-users').replaceChildren();
      for (const user of users) {
        const row = document.createElement('section'); row.className = 'access-user';
        const title = document.createElement('strong'); title.textContent = `${user.name || ''} · ${user.email}`;
        const status = document.createElement('p'); status.textContent = user.admin ? '관리자' : `현재 상태: ${user.status || '대기'} · 최근 로그인: ${user.lastLogin || '-'}`;
        row.append(title, status);
        if (!user.admin) for (const value of ['승인','거절','차단']) {
          const button = document.createElement('button'); button.className = 'install-button'; button.textContent = value;
          button.addEventListener('click', async () => {
            button.disabled = true;
            try { await post('/api/admin/users', { sub: user.sub, status: value }); await loadUsers(); }
            catch (error) { $('admin-message').textContent = error.message; button.disabled = false; }
          });
          row.append(button);
        }
        $('admin-users').append(row);
      }
      $('admin-message').textContent = `로그인한 계정 ${users.length}개 · 변경 사항은 시트에도 저장됩니다.`;
    } catch (error) { $('admin-message').textContent = error.message; }
  }
  $('check-approval').addEventListener('click', check);
  $('logout-button').addEventListener('click', async () => {
    try { await post('/api/logout'); csrf = ''; update(null); }
    catch { update(null, '화면은 잠갔지만 로그아웃을 완료하지 못했어요. 연결 후 다시 시도해 주세요.', false); }
  });
  $('admin-button').addEventListener('click', () => { $('admin-dialog').showModal(); loadUsers(); });
  $('admin-close').addEventListener('click', () => $('admin-dialog').close());
  $('admin-sync').addEventListener('click', async () => {
    $('admin-sync').disabled = true;
    try { await post('/api/admin/sync'); $('admin-message').textContent = '시트 동기화를 완료했어요.'; window.dispatchEvent(new Event('notes-refresh')); }
    catch (error) { $('admin-message').textContent = error.message; }
    finally { $('admin-sync').disabled = false; }
  });
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  // UI forgets private data quickly after revocation; API denial is immediate on the next request.
  setInterval(() => { if (!document.hidden) check(); }, 60000);
  window.CHAE_AUTH = { check, get user() { return currentUser; } };
  check();
})();

