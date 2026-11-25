// 내 스펙관리 › 그래프: 현장에 등록한 종이(패턴)를 많이 쓴 순서로 보여 준다.
// 분기 · 구분(요구/제안/실제 사용) · 부위(드레스룸 월/선반/가구, 여러 개) 로 거른다.
// 이름은 제품명이 기본이고, 제품명이 없으면 종이넘버(그것도 없으면 스펙넘버)로 쓴다.
(function () {
  'use strict';
  const panel = document.getElementById('spec-graph-panel');
  if (!panel) return;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const USAGES = [['', '전체'], ['요구', '요구'], ['제안', '제안'], ['사용', '실제 사용']];
  const PARTS = [['월', '드레스룸 월'], ['선반', '선반'], ['가구', '가구']];
  const TOP = 15;
  let sites = [], quarter = null, usage = '', parts = new Set();

  const quarterOf = (date) => { const m = /^(\d{4})-(\d{2})/.exec(String(date || '')); return m ? `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}` : ''; };
  const quarterLabel = (q) => q ? `${q.slice(0, 4)}년 ${q.slice(-1)}분기` : '전체 기간';
  const nowQuarter = () => { const d = new Date(); return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`; };
  function records() {
    const out = [];
    for (const site of sites) for (const p of site.papers || []) {
      if (!p.number && !p.spec) continue;
      out.push({ site: site.name, date: p.date || String(site.updatedAt || '').slice(0, 10), number: p.number || '', spec: p.spec || '', usage: p.usage || '', parts: Array.isArray(p.parts) ? p.parts : [] });
    }
    return out;
  }
  function labelOf(r) { const product = window.ZIP_SPEC_LOOKUP?.productNames(r.number)?.[0] || ''; return product || r.number || r.spec; }

  panel.innerHTML = `
    <div class="graph-filters">
      <label class="graph-quarter">분기<select data-quarter aria-label="분기"></select></label>
      <div class="graph-seg" role="group" aria-label="횟수 기준">${USAGES.map(([v, t]) => `<button type="button" data-usage="${v}">${t}</button>`).join('')}</div>
      <div class="graph-seg graph-parts" role="group" aria-label="부위 (여러 개 선택)">${PARTS.map(([v, t]) => `<button type="button" data-part="${v}" aria-pressed="false">${t}</button>`).join('')}</div>
    </div>
    <p class="graph-summary" data-summary></p>
    <ol class="graph-bars" data-bars aria-label="많이 사용된 패턴 순위"></ol>
    <div class="graph-tip" data-tip role="tooltip" hidden></div>`;
  const $ = (s) => panel.querySelector(s);

  function render() {
    const all = records();
    const quarters = [...new Set(all.map((r) => quarterOf(r.date)).filter(Boolean))].sort().reverse();
    if (quarter === null && all.length) quarter = quarters.includes(nowQuarter()) ? nowQuarter() : '';   // 데이터가 온 뒤에 기본 분기(이번 분기)를 정한다
    if (quarter && !quarters.includes(quarter)) quarters.unshift(quarter);
    $('[data-quarter]').innerHTML = `<option value="">전체 기간</option>` + quarters.map((q) => `<option value="${q}">${quarterLabel(q)}</option>`).join('');
    $('[data-quarter]').value = quarter || '';
    panel.querySelectorAll('[data-usage]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.usage === usage)));
    panel.querySelectorAll('[data-part]').forEach((b) => b.setAttribute('aria-pressed', String(parts.has(b.dataset.part))));

    const rows = all.filter((r) => (!quarter || quarterOf(r.date) === quarter) && (!usage || r.usage === usage) && (!parts.size || r.parts.some((p) => parts.has(p))));
    const groups = new Map();
    for (const r of rows) {
      const name = labelOf(r), key = name.toUpperCase();
      const g = groups.get(key) || { name, numbers: new Set(), specs: new Set(), count: 0, usage: { 요구: 0, 제안: 0, 사용: 0 }, parts: { 월: 0, 선반: 0, 가구: 0 }, sites: new Set() };
      g.count++; if (r.number) g.numbers.add(r.number); if (r.spec) g.specs.add(r.spec); if (g.usage[r.usage] !== undefined) g.usage[r.usage]++;
      r.parts.forEach((p) => { if (g.parts[p] !== undefined) g.parts[p]++; }); g.sites.add(r.site); groups.set(key, g);
    }
    const ranked = [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko', { numeric: true }));
    const shown = ranked.slice(0, TOP), max = shown[0]?.count || 1;
    const filterText = [quarterLabel(quarter), USAGES.find(([v]) => v === usage)[1] === '전체' ? '' : USAGES.find(([v]) => v === usage)[1], parts.size ? [...parts].map((p) => PARTS.find(([v]) => v === p)[1]).join('·') : ''].filter(Boolean).join(' · ');
    $('[data-summary]').textContent = rows.length ? `${filterText} — 총 ${rows.length}건 · 패턴 ${ranked.length}개${ranked.length > TOP ? ` (상위 ${TOP}개)` : ''}` : '';
    $('[data-bars]').innerHTML = shown.length ? shown.map((g, i) => {
      const sub = [...g.numbers][0] && [...g.numbers][0] !== g.name ? [...g.numbers].join(', ') : [...g.specs].join(', ');
      return `<li class="graph-row" tabindex="0" data-index="${i}" aria-label="${i + 1}위 ${esc(g.name)} ${g.count}건">
        <span class="graph-rank">${i + 1}</span>
        <span class="graph-name"><b>${esc(g.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
        <span class="graph-track"><span class="graph-fill" style="width:${Math.max(2, (g.count / max) * 100)}%"></span></span>
        <span class="graph-count">${g.count}</span></li>`;
    }).join('') : `<li class="graph-empty">이 조건에 맞는 기록이 없어요. 현장 입력에서 종이마다 구분(요구·제안·실제 사용)과 부위를 고르면 여기에 쌓여요.</li>`;
    panel._shown = shown;
  }

  // 막대에 올리거나(PC) 누르면(휴대폰) 구분·부위별 횟수와 현장을 보여 준다.
  const tip = $('[data-tip]');
  function showTip(row) {
    const g = panel._shown?.[Number(row.dataset.index)]; if (!g) return;
    const sitesList = [...g.sites];
    tip.innerHTML = `<b>${esc(g.name)}</b><span>요구 ${g.usage.요구} · 제안 ${g.usage.제안} · 실제 사용 ${g.usage.사용}</span><span>드레스룸 월 ${g.parts.월} · 선반 ${g.parts.선반} · 가구 ${g.parts.가구}</span><span>현장: ${esc(sitesList.slice(0, 5).join(', '))}${sitesList.length > 5 ? ` 외 ${sitesList.length - 5}곳` : ''}</span>`;
    tip.hidden = false;
    const box = row.getBoundingClientRect(), host = panel.getBoundingClientRect();
    tip.style.top = `${box.bottom - host.top + 6}px`; tip.style.left = `${Math.max(0, Math.min(box.left - host.left + 40, host.width - tip.offsetWidth))}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  panel.addEventListener('pointerover', (e) => { const row = e.target.closest('.graph-row'); if (row && e.pointerType === 'mouse') showTip(row); });
  panel.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse' && !e.relatedTarget?.closest?.('.graph-row')) hideTip(); });
  panel.addEventListener('focusin', (e) => { const row = e.target.closest('.graph-row'); if (row) showTip(row); });
  panel.addEventListener('focusout', hideTip);
  panel.addEventListener('click', (e) => {
    const row = e.target.closest('.graph-row');
    if (row) { tip.hidden && panel._tipRow === row ? showTip(row) : (panel._tipRow === row && !tip.hidden ? hideTip() : showTip(row)); panel._tipRow = row; return; }
    const u = e.target.closest('[data-usage]'); if (u) { usage = u.dataset.usage; hideTip(); render(); return; }
    const p = e.target.closest('[data-part]'); if (p) { parts.has(p.dataset.part) ? parts.delete(p.dataset.part) : parts.add(p.dataset.part); hideTip(); render(); }
  });
  $('[data-quarter]').addEventListener('change', (e) => { quarter = e.target.value; hideTip(); render(); });

  window.addEventListener('spec-map-data', (e) => { if (Array.isArray(e.detail)) { sites = e.detail; if (!panel.hidden) render(); } });
  window.addEventListener('spec-graph-visible', render);
  render();
})();
