// 상단 탭(PC)과 하단 바(모바일): 전체메모 · 스케줄 · 스펙관리 · 디자인 보드.
// 각 탭은 기존 메뉴 버튼을 대신 눌러 주므로 화면 전환·권한·불러오기 로직은 그대로 쓴다.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const app = $('#private-app'), main = $('.main-content');
  if (!app || !main) return;
  const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const views = [
    { view: '#notes-view', open: '.brand', source: null, label: '전체메모', short: '메모', icon: icon('M6 4h9l3 3v13H6zM9 10h6M9 14h6') },
    { view: '#checklist-view', open: '#checklist-nav-button', source: '#checklist-nav-button', label: '스케줄', short: '스케줄', icon: icon('M5 6h14v14H5zM5 10h14M9 3v4M15 3v4') },
    { view: '#specs-view', open: '#specs-nav-button', source: '#specs-nav-button', label: '스펙관리', short: '스펙', icon: icon('M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z') },
    { view: '#board-view', open: '#board-nav-button', source: '#board-nav-button', label: '디자인 보드', short: '보드', icon: icon('M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z') },
  ];

  const tabs = (cls, withIcons) => views.map((v, i) => withIcons
    ? `<button type="button" role="tab" class="${cls}" data-tab="${i}" aria-selected="false" aria-label="${v.label}" title="${v.label}">${v.icon}</button>`
    : `<button type="button" role="tab" class="${cls}" data-tab="${i}" aria-selected="false"><span>${v.label}</span></button>`).join('');
  const row = document.createElement('div');
  row.className = 'view-tabs-row';
  row.innerHTML = `<nav class="view-tabs" role="tablist" aria-label="화면 선택"><span class="view-tabs-indicator" aria-hidden="true"></span>${tabs('view-tab', false)}</nav><button type="button" class="view-tabs-add" data-add-note hidden><span aria-hidden="true">＋</span> 새 메모</button>`;
  main.prepend(row);
  const bottom = document.createElement('nav');
  bottom.className = 'bottom-tabs';
  bottom.setAttribute('role', 'tablist');
  bottom.setAttribute('aria-label', '화면 선택');
  bottom.innerHTML = `<span class="bottom-tabs-indicator" aria-hidden="true"></span>${tabs('bottom-tab', true)}`;
  app.append(bottom);

  const bars = [[row.querySelector('.view-tabs'), '.view-tabs-indicator'], [bottom, '.bottom-tabs-indicator']];
  const addNote = $('#add-note-button'), addButton = row.querySelector('[data-add-note]');

  function activeIndex() { const i = views.findIndex((v) => { const el = $(v.view); return el && !el.hidden; }); return i < 0 ? 0 : i; }
  let frame = 0;
  function sync() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const active = activeIndex();
      const shown = views.map((v) => !v.source || !$(v.source)?.hidden);
      const visibleCount = shown.filter(Boolean).length;
      document.body.classList.toggle('has-view-tabs', visibleCount > 1);
      bars.forEach(([bar, indicatorSel]) => {
        bar.hidden = visibleCount < 2;
        bar.querySelectorAll('[data-tab]').forEach((b) => { const i = +b.dataset.tab; b.hidden = !shown[i]; b.setAttribute('aria-selected', String(i === active)); b.tabIndex = i === active ? 0 : -1; });
        const on = bar.querySelector(`[data-tab="${active}"]`), indicator = bar.querySelector(indicatorSel);
        if (on && !bar.hidden && on.offsetWidth) { indicator.style.width = on.offsetWidth + 'px'; indicator.style.transform = `translateX(${on.offsetLeft}px)`; indicator.style.opacity = '1'; }
      });
      // 새 메모 버튼: 메모 화면에서, 메모를 쓸 수 있는 계정일 때만
      addButton.hidden = active !== 0 || !addNote || addNote.hidden;
      row.hidden = bars[0][0].hidden && addButton.hidden;
    });
  }

  function go(i) {
    const v = views[i];
    if (!v || activeIndex() === i && i !== 0) return;
    $(v.open)?.click();
    if (i === 0) window.scrollTo({ top: 0, behavior: 'smooth' });
    sync();
  }
  function onTabClick(event) { const b = event.target.closest('[data-tab]'); if (b) go(+b.dataset.tab); }
  function onTabKey(event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const list = [...event.currentTarget.querySelectorAll('[data-tab]:not([hidden])')], at = list.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    const next = list[(at + (event.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    next.focus(); go(+next.dataset.tab);
  }
  bars.forEach(([bar]) => { bar.addEventListener('click', onTabClick); bar.addEventListener('keydown', onTabKey); });
  addButton.addEventListener('click', () => addNote?.click());

  // 화면 전환·권한 변화를 감지해 탭 상태를 맞춘다.
  const watch = new MutationObserver(sync);
  [...views.map((v) => v.view), ...views.map((v) => v.source).filter(Boolean), '#add-note-button', '#private-app']
    .forEach((s) => { const el = $(s); if (el) watch.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
  window.addEventListener('resize', sync);
  window.addEventListener('show-notes', sync);
  sync();

  // 클릭할 때 생기는 진한 외곽선은 숨기고, 키보드(Tab)로 움직일 때만 보이게 한다.
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab') document.body.classList.add('keyboard-nav'); }, true);
  window.addEventListener('pointerdown', () => document.body.classList.remove('keyboard-nav'), true);
})();
