// 영업 관리: 업체 · 담당자 · 현장별로 언제 어떻게 대응했는지 날짜순으로 쌓고, 나중에 찾아본다.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id), api = window.ZIP_API;
  const view = $('sales-view'), nav = $('sales-nav-button');
  if (!view || !nav || !api) return;
  const admin = () => window.CHAE_AUTH?.user?.role === 'admin';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = (v) => String(v ?? '').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const dayLabel = (k) => { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${m}.${pad(d)} (${DAYS[dt.getDay()]})`; };
  let items = [], types = ['미팅', '전화', '방문', '샘플 발송', '제안', '견적', '기타'], loaded = false, loading = false, version = 0;
  let company = '', contact = '', site = '', query = '', siteNames = [], siteCompanies = [];

  // 다른 화면에 쓰인 현장명·건설사·설계사도 입력 추천에 넣는다.
  window.addEventListener('spec-map-data', (e) => { if (!Array.isArray(e.detail)) return; siteNames = [...new Set(e.detail.map((s) => s.name).filter(Boolean))]; siteCompanies = [...new Set(e.detail.flatMap((s) => [s.builder, s.designer]).filter(Boolean))]; });

  view.innerHTML = `
    <header class="specs-heading sales-heading"><div><p class="eyebrow">SALES</p><h1 id="sales-title">영업 관리</h1></div><button id="sales-add" class="view-tabs-add" type="button"><span aria-hidden="true">＋</span> 기록 추가</button></header>
    <div class="sales-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><label class="sr-only" for="sales-search">영업 기록 검색</label><input id="sales-search" type="search" autocomplete="off" placeholder="업체 · 담당자 · 현장 · 내용 검색"></div>
    <p id="sales-message" class="sales-message" role="status"></p>
    <div class="sales-layout">
      <nav class="sales-companies" aria-label="업체"></nav>
      <div class="sales-main"><div class="sales-filters"></div><ol class="sales-timeline" aria-label="대응 기록"></ol></div>
    </div>`;

  const editor = document.createElement('dialog'); editor.className = 'specs-dialog sales-editor'; editor.setAttribute('aria-labelledby', 'sales-editor-title');
  editor.innerHTML = `<h2 id="sales-editor-title">영업 기록</h2><form id="sales-form" autocomplete="off">
    <div class="sales-form-grid">
      <label>날짜 *<input name="date" type="date" required></label>
      <fieldset class="sales-types"><legend>유형</legend><div></div></fieldset>
      <label>업체 *<input name="company" list="sales-company-list" maxlength="100" required placeholder="예: 현대건설"></label>
      <label>담당자<input name="contact" list="sales-contact-list" maxlength="100" placeholder="예: 최수지 과장"></label>
      <label class="sales-wide">현장<input name="site" list="sales-site-list" maxlength="200" placeholder="예: 평택 센트럴"></label>
      <label class="sales-wide">대응 내용<textarea name="content" rows="4" maxlength="4000" placeholder="어떻게 대응했는지 적어 두세요"></textarea></label>
      <label>다음 할 일<input name="next" maxlength="1000" placeholder="예: 샘플북 2권 발송"></label>
      <label>다음 일정<input name="nextDate" type="date"></label>
      <label class="sales-wide sales-check"><input type="checkbox" name="toSchedule"> 다음 일정을 스케줄(구글 캘린더)에도 추가</label>
    </div>
    <datalist id="sales-company-list"></datalist><datalist id="sales-contact-list"></datalist><datalist id="sales-site-list"></datalist>
    <p class="sales-editor-message" role="status"></p>
    <div class="specs-actions"><button type="button" class="install-button" data-delete hidden>삭제</button><button type="button" class="install-button" data-cancel>취소</button><button type="submit" class="view-tabs-add">저장</button></div></form>`;
  document.body.append(editor);
  const form = editor.querySelector('form'), emsg = editor.querySelector('.sales-editor-message');
  let editing = null, editType = '';

  const hl = (text) => { const raw = String(text || ''); if (!query) return esc(raw); const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); let out = '', last = 0; raw.replace(re, (m, i) => { out += esc(raw.slice(last, i)) + `<mark class="board-hit">${esc(m)}</mark>`; last = i + m.length; return m; }); return out + esc(raw.slice(last)); };
  const matches = (x) => !query || [x.company, x.contact, x.site, x.type, x.content, x.next].some((v) => String(v || '').toLocaleLowerCase('ko').includes(query.toLocaleLowerCase('ko')));
  const same = (a, b) => fold(a) === fold(b);

  function render() {
    const found = items.filter(matches);
    // 업체 목록: 기록 수 · 마지막 대응일, 최근 대응 순
    const byCompany = new Map();
    for (const x of found) { const k = fold(x.company); const g = byCompany.get(k) || { name: x.company, count: 0, last: '' }; g.count++; if (x.date > g.last) g.last = x.date; byCompany.set(k, g); }
    const companies = [...byCompany.values()].sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name, 'ko'));
    if (company && !companies.some((c) => same(c.name, company))) { company = ''; contact = ''; site = ''; }
    view.querySelector('.sales-companies').innerHTML = `<button type="button" data-company="" aria-pressed="${!company}"><b>전체 업체</b><span>${found.length}건</span></button>` +
      companies.map((c) => `<button type="button" data-company="${esc(c.name)}" aria-pressed="${same(c.name, company)}"><b>${hl(c.name)}</b><span>${c.count}건 · ${esc(dayLabel(c.last))}</span></button>`).join('');
    const inCompany = found.filter((x) => !company || same(x.company, company));
    const contacts = [...new Set(inCompany.map((x) => x.contact).filter(Boolean))], sites = [...new Set(inCompany.map((x) => x.site).filter(Boolean))];
    if (contact && !contacts.some((v) => same(v, contact))) contact = '';
    if (site && !sites.some((v) => same(v, site))) site = '';
    view.querySelector('.sales-filters').innerHTML = company ? `
      ${contacts.length ? `<div class="sales-chips" aria-label="담당자"><span>담당자</span><button type="button" data-contact="" aria-pressed="${!contact}">전체</button>${contacts.map((v) => `<button type="button" data-contact="${esc(v)}" aria-pressed="${same(v, contact)}">${hl(v)}</button>`).join('')}</div>` : ''}
      ${sites.length ? `<div class="sales-chips" aria-label="현장"><span>현장</span><button type="button" data-site="" aria-pressed="${!site}">전체</button>${sites.map((v) => `<button type="button" data-site="${esc(v)}" aria-pressed="${same(v, site)}">${hl(v)}</button>`).join('')}</div>` : ''}` : '';
    const rows = inCompany.filter((x) => (!contact || same(x.contact, contact)) && (!site || same(x.site, site)))
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.created).localeCompare(String(a.created)));
    let month = '', html = '';
    const today = todayKey();
    for (const x of rows) {
      const m = x.date.slice(0, 7); if (m !== month) { month = m; html += `<li class="sales-month">${Number(m.slice(0, 4))}년 ${Number(m.slice(5))}월</li>`; }
      const due = x.nextDate ? (x.nextDate < today ? 'is-late' : x.nextDate === today ? 'is-today' : '') : '';
      html += `<li class="sales-entry ${x.pending ? 'is-pending' : ''}"><button type="button" data-open="${esc(x.id)}">
        <span class="sales-date">${esc(dayLabel(x.date))}</span>
        <span class="sales-body"><span class="sales-line">${x.type ? `<em>${esc(x.type)}</em>` : ''}<b>${hl(x.company)}</b>${x.contact ? `<span>${hl(x.contact)}</span>` : ''}${x.site ? `<span class="sales-site">⌖ ${hl(x.site)}</span>` : ''}</span>
        ${x.content ? `<span class="sales-content">${hl(x.content)}</span>` : ''}
        ${x.next ? `<span class="sales-next ${due}">다음 · ${hl(x.next)}${x.nextDate ? ` <time>${esc(dayLabel(x.nextDate))}</time>` : ''}</span>` : ''}
        ${x.pending ? '<span class="sales-pending">저장 중</span>' : ''}</span></button></li>`;
    }
    view.querySelector('.sales-timeline').innerHTML = !loaded ? '<li class="sales-empty">영업 기록을 불러오는 중이에요…</li>' : html || `<li class="sales-empty">${query ? '검색 결과가 없어요.' : '아직 기록이 없어요. ＋ 기록 추가로 첫 대응을 남겨 보세요.'}</li>`;
  }

  async function load(force) {
    if (!admin() || loading || (loaded && !force)) { render(); return; }
    loading = true; const v = ++version;
    try { const r = await api.request('salesLog'); if (v !== version) return; items = r.items || []; if (Array.isArray(r.types) && r.types.length) types = r.types; loaded = true; $('sales-message').textContent = ''; }
    catch (e) { if (v === version) $('sales-message').textContent = e.message; }
    finally { loading = false; if (v === version) render(); }
  }

  function fillLists() {
    const companies = [...new Set([...items.map((x) => x.company), ...siteCompanies].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('sales-company-list').innerHTML = companies.map((v) => `<option value="${esc(v)}">`).join('');
    const c = form.elements.company.value;
    $('sales-contact-list').innerHTML = [...new Set(items.filter((x) => !c || same(x.company, c)).map((x) => x.contact).filter(Boolean))].map((v) => `<option value="${esc(v)}">`).join('');
    $('sales-site-list').innerHTML = [...new Set([...items.filter((x) => !c || same(x.company, c)).map((x) => x.site), ...siteNames].filter(Boolean))].map((v) => `<option value="${esc(v)}">`).join('');
  }
  function drawTypes() { editor.querySelector('.sales-types div').innerHTML = types.map((t) => `<button type="button" data-type="${esc(t)}" aria-pressed="${t === editType}">${esc(t)}</button>`).join(''); }
  function edit(x = null) {
    if (!admin()) return;
    if (x?.pending) { $('sales-message').textContent = '아직 시트에 저장하는 중이에요. 잠시 후 다시 열어 주세요.'; return; }
    editing = x; editType = x?.type || '';
    form.reset();
    form.elements.date.value = x?.date || todayKey();
    for (const k of ['company', 'contact', 'site', 'content', 'next', 'nextDate']) form.elements[k].value = x?.[k] || (k === 'company' && !x ? company : k === 'contact' && !x ? contact : k === 'site' && !x ? site : '');
    editor.querySelector('#sales-editor-title').textContent = x ? '영업 기록 수정' : '영업 기록 추가';
    editor.querySelector('[data-delete]').hidden = !x; emsg.textContent = '';
    drawTypes(); fillLists(); editor.showModal();
    form.elements[x ? 'content' : 'company'].focus();
  }
  editor.addEventListener('click', (e) => {
    const t = e.target.closest('[data-type]'); if (t) { editType = editType === t.dataset.type ? '' : t.dataset.type; drawTypes(); return; }
    if (e.target.closest('[data-cancel]')) editor.close();
    if (e.target.closest('[data-delete]')) remove(editing);
  });
  form.elements.company.addEventListener('change', fillLists);

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!admin()) return;
    const data = { id: editing?.id || crypto.randomUUID(), type: editType };
    for (const k of ['date', 'company', 'contact', 'site', 'content', 'next', 'nextDate']) data[k] = form.elements[k].value.trim();
    if (!data.date || !data.company) { emsg.textContent = '날짜와 업체는 꼭 넣어 주세요.'; return; }
    const toSchedule = form.elements.toSchedule.checked && data.nextDate && data.next;
    // 바로 반영하고 시트 저장은 뒤에서. 실패하면 되돌리고 입력한 그대로 창을 다시 연다.
    const before = items, wasEditing = editing;
    items = items.filter((x) => x.id !== data.id).concat({ ...data, created: editing?.created || new Date().toISOString(), pending: true });
    editor.close(); $('sales-message').textContent = '시트에 저장하고 있어요…'; render();
    window.ZIP_PENDING_SAVES = (window.ZIP_PENDING_SAVES || 0) + 1;
    try {
      const r = await api.request('saveSalesLog', data);
      items = items.map((x) => x.id === data.id ? { ...data, created: r.item?.created || x.created } : x);
      let note = wasEditing ? '기록을 수정했어요.' : '기록을 저장했어요.';
      if (toSchedule) {
        try { await api.request('addChecklist', { task: `[${data.company}] ${data.next}`.slice(0, 160), date: data.nextDate, time: '', note: [data.contact, data.site].filter(Boolean).join(' · ').slice(0, 1000) }); note += ' 스케줄에도 넣었어요.'; window.dispatchEvent(new Event('checklist-refresh')); }
        catch (err) { note += ' 스케줄 추가는 실패했어요: ' + err.message; }
      }
      $('sales-message').textContent = note;
    } catch (err) {
      items = before; render();
      $('sales-message').textContent = '저장하지 못했어요: ' + err.message;
      if (!editor.open) { editing = wasEditing; editor.showModal(); emsg.textContent = '저장하지 못했어요: ' + err.message + ' 입력 내용은 그대로예요.'; }
    } finally { window.ZIP_PENDING_SAVES--; render(); }
  });

  async function remove(x) {
    if (!x || !window.confirm(`${x.company} ${dayLabel(x.date)} 기록을 삭제할까요? 시트에서도 지워져요.`)) return;
    editor.close(); const before = items; items = items.filter((i) => i.id !== x.id); render();
    try { await api.request('deleteSalesLog', { id: x.id }); $('sales-message').textContent = '삭제했어요.'; }
    catch (err) { items = before; render(); $('sales-message').textContent = '삭제하지 못했어요: ' + err.message; }
  }

  view.addEventListener('click', (e) => {
    const c = e.target.closest('[data-company]'); if (c) { company = c.dataset.company; contact = ''; site = ''; render(); return; }
    const p = e.target.closest('[data-contact]'); if (p) { contact = p.dataset.contact; render(); return; }
    const s = e.target.closest('[data-site]'); if (s) { site = s.dataset.site; render(); return; }
    const o = e.target.closest('[data-open]'); if (o) { edit(items.find((x) => x.id === o.dataset.open)); return; }
    if (e.target.closest('#sales-add')) edit(null);
  });
  let timer = 0;
  $('sales-search').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { query = e.target.value.trim(); render(); }, 150); });

  function show() {
    if (!admin()) return;
    window.dispatchEvent(new Event('show-notes'));
    for (const id of ['notes-view', 'checklist-view', 'specs-view', 'board-view']) { const el = $(id); if (el) el.hidden = true; }
    const add = $('add-note-button'); if (add) add.hidden = true;
    view.hidden = false; nav.classList.add('active'); load(false);
  }
  function hide() { view.hidden = true; nav.classList.remove('active'); }
  nav.addEventListener('click', show);
  window.addEventListener('show-notes', () => { if (!view.hidden) hide(); });
  for (const id of ['category-nav', 'checklist-nav-button', 'specs-nav-button', 'board-nav-button']) $(id)?.addEventListener('click', hide);
  document.querySelector('.brand')?.addEventListener('click', hide);
  window.addEventListener('access-change', () => { nav.hidden = !admin(); if (!admin()) { version++; items = []; loaded = false; hide(); } });
  nav.hidden = !admin();
  render();

  // 보드·영업 검색창의 지우기(×): 브라우저 기본 파란 × 대신 회색 동그라미. 글자가 있을 때만 보인다.
  function addClear(input) {
    if (!input || input.dataset.clear) return; input.dataset.clear = '1';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'search-clear'; b.hidden = true; b.setAttribute('aria-label', '검색어 지우기');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
    input.after(b);
    const sync = () => { b.hidden = !input.value; };
    input.addEventListener('input', sync);
    b.addEventListener('click', () => { input.value = ''; sync(); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); });
  }
  addClear(document.getElementById('board-search-input'));
  addClear(document.getElementById('sales-search'));
})();
