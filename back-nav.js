// 뒤로가기(휴대폰 뒤로 버튼 · 브라우저 뒤로): 앱이 바로 꺼지지 않고 앱 안에서 한 단계씩 되돌린다.
// 1) 열린 팝업이 있으면 팝업을 닫고, 2) 아니면 직전 화면(탭 · 영업 업체 페이지)으로 최대 5단계까지 돌아간다.
// 되돌릴 것이 없으면 그때 원래대로 앱을 나간다.
(function () {
  'use strict';
  const MAX = 5;
  const views = [['#notes-view', '.brand'], ['#checklist-view', '#checklist-nav-button'], ['#specs-view', '#specs-nav-button'], ['#board-view', '#board-nav-button'], ['#sales-view', '#sales-nav-button']];
  const $ = (s) => document.querySelector(s);
  const stack = [], dialogs = [];
  let armed = false, restoring = -1;

  const pending = () => dialogs.some((d) => d.open) || stack.length > 0;
  function arm() { if (armed) return; armed = true; try { history.pushState({ zipBack: true }, ''); } catch {} }
  function push(undo) { stack.push(undo); if (stack.length > MAX) stack.shift(); arm(); }

  // 화면(탭) 바뀜 기록
  const activeView = () => views.findIndex(([v]) => { const el = $(v); return el && !el.hidden; });
  let current = activeView();
  const viewWatch = new MutationObserver(() => {
    const now = activeView(); if (now < 0 || now === current) return;
    const prev = current; current = now;
    if (restoring === now) { restoring = -1; return; }
    if (prev < 0) return;
    push(() => { if (activeView() === prev) return false; restoring = prev; $(views[prev][1])?.click(); return true; });
  });
  views.forEach(([v]) => { const el = $(v); if (el) viewWatch.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });

  // 팝업 열림 기록(열린 순서대로, 맨 위부터 닫는다)
  const dialogWatch = new MutationObserver((records) => {
    for (const r of records) {
      const d = r.target; if (d.tagName !== 'DIALOG') continue;
      const i = dialogs.indexOf(d); if (i >= 0) dialogs.splice(i, 1);
      if (d.open) { dialogs.push(d); arm(); }
    }
  });
  dialogWatch.observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });

  function closeTop() {
    for (let i = dialogs.length - 1; i >= 0; i--) {
      const d = dialogs[i]; if (!d.open) { dialogs.splice(i, 1); continue; }
      // 작성 중인 편집창은 cancel 이벤트로 '내용 버리고 닫을까요?'를 먼저 묻는다.
      const ev = new Event('cancel', { cancelable: true });
      if (d.dispatchEvent(ev)) d.close();
      return true;
    }
    return false;
  }
  window.addEventListener('popstate', () => {
    armed = false;
    if (!closeTop()) { while (stack.length && !stack.pop()()) { /* 이미 되돌려진 단계는 건너뛴다 */ } }
    // 동작이 끝난 뒤에도 되돌릴 게 남아 있으면 다음 뒤로가기를 다시 받는다.
    setTimeout(() => { if (pending()) arm(); }, 0);
  });

  // 다른 화면 모듈이 '되돌리기'를 등록한다(예: 영업 업체 페이지 → 업체 목록). undo가 false를 돌려주면 건너뛴다.
  window.ZIP_BACK = { push };
})();
