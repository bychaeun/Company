// 내 스펙관리 › 샘플북: 분출 기록 입력 · 주간(월~금) 목록 · 보고서 PDF 내보내기
(function () {
  'use strict';
  const panel = document.getElementById('spec-samples-panel');
  const api = window.ZIP_API;
  if (!panel || !api) return;
  const admin = () => window.CHAE_AUTH?.user?.role === 'admin';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const label = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일(${DAYS[d.getDay()]})`;
  // 항상 오늘이 속한 주를 먼저 보여 준다. 앱을 띄워 둔 채 날짜가 바뀌어도 화면을 열 때마다 오늘을 다시 잡는다.
  let week = mondayOf(new Date());
  let items = [], loaded = false, loading = false, busy = false, editingId = '', version = 0;

  panel.innerHTML = `
    <section class="samples-week" aria-label="분출 기간">
      <button type="button" class="samples-nav" data-week="-1" aria-label="이전 주"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="samples-period"><span>분출 기간</span><strong data-period></strong><small data-summary></small></div>
      <button type="button" class="samples-nav" data-week="1" aria-label="다음 주"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
    </section>
    <div class="samples-actions"><button type="button" class="install-button samples-last-week" data-export-last hidden></button><button type="button" class="view-tabs-add samples-export" data-export><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg> 주간 보고서 PDF</button></div>
    <form class="samples-form" autocomplete="off">
      <h3 data-form-title>샘플북 분출 추가</h3>
      <div class="samples-fields">
        <label>날짜<input name="date" type="date" required></label>
        <label>업체명<input name="company" maxlength="100" required placeholder="예: ○○건설"></label>
        <label>업체담당자<input name="contact" maxlength="100" placeholder="예: 홍길동 과장"></label>
        <fieldset class="samples-method"><legend>전달 방법</legend>
          <label><input type="radio" name="method" value="직달" checked><span>직달</span></label>
          <label><input type="radio" name="method" value="택배"><span>택배</span></label>
        </fieldset>
        <label class="samples-count">권수<input name="count" type="number" min="1" max="999" step="1" value="1" required inputmode="numeric"></label>
      </div>
      <p class="samples-message" role="status" data-message></p>
      <div class="samples-form-buttons"><button type="button" class="install-button" data-cancel hidden>취소</button><button type="submit" class="view-tabs-add" data-save>저장</button></div>
    </form>
    <div class="samples-list" data-list aria-live="polite"></div>`;
  const $ = (s) => panel.querySelector(s);
  const form = $('.samples-form'), message = $('[data-message]');

  function weekItems() {
    const from = key(week), to = key(addDays(week, 6));   // 주말 기록은 그 주에 포함
    return items.filter((i) => i.date >= from && i.date <= to).sort((a, b) => a.date.localeCompare(b.date) || String(a.created).localeCompare(String(b.created)));
  }
  function render() {
    const friday = addDays(week, 4), rows = weekItems(), books = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
    $('[data-period]').textContent = `${label(week)} ~ ${label(friday)}`;
    $('[data-summary]').textContent = loaded ? `${rows.length}건 · ${books}권 · 직달 ${rows.filter((r) => r.method === '직달').length} · 택배 ${rows.filter((r) => r.method === '택배').length}` : '불러오는 중…';
    $('[data-export]').disabled = busy || !loaded;
    // 월요일에는 보고할 지난주(월~금) 보고서를 바로 받을 수 있게 따로 보여 준다.
    const now = new Date(), last = addDays(mondayOf(now), -7), lastButton = $('[data-export-last]');
    lastButton.hidden = now.getDay() !== 1 || key(week) === key(last);
    lastButton.textContent = `지난주(${last.getMonth() + 1}/${last.getDate()}~${addDays(last, 4).getMonth() + 1}/${addDays(last, 4).getDate()}) 보고서 PDF`;
    lastButton.disabled = busy || !loaded;
    $('[data-list]').innerHTML = !loaded ? '' : rows.length ? rows.map((r) => `
      <div class="samples-item ${r.id === editingId ? 'is-editing' : ''}" data-id="${esc(r.id)}">
        <button type="button" class="samples-item-main" data-edit="${esc(r.id)}" aria-label="${esc(r.company)} 수정">
          <span class="samples-date">${esc(label(parse(r.date)))}</span>
          <strong>${esc(r.company)}</strong>
          <span class="samples-contact">${esc(r.contact || '')}</span>
        </button>
        <span class="samples-chip ${r.method === '직달' ? 'is-direct' : 'is-parcel'}">${esc(r.method)}</span>
        <span class="samples-books">${Number(r.count) || 0}권</span>
        <button type="button" class="samples-delete" data-delete="${esc(r.id)}" aria-label="${esc(r.company)} 삭제" title="삭제"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button>
      </div>`).join('') : '<p class="samples-empty">이 기간에 등록한 샘플북 분출이 없어요.</p>';
  }
  function resetForm() {
    editingId = ''; form.reset();
    const t = new Date(), inWeek = t >= week && t <= addDays(week, 6);
    form.elements.date.value = key(inWeek ? t : week);
    form.elements.count.value = 1;
    $('[data-form-title]').textContent = '샘플북 분출 추가'; $('[data-save]').textContent = '저장'; $('[data-cancel]').hidden = true;
  }
  async function load(force = false) {
    if (!admin() || loading || (loaded && !force)) { render(); return; }
    loading = true; const v = ++version; render();
    try { const result = await api.request('sampleBooks', force ? { force: true } : {}); if (v !== version) return; items = result.items || []; loaded = true; message.textContent = ''; }
    catch (error) { if (v === version) message.textContent = error.message; }
    finally { loading = false; if (v === version) render(); }
  }

  panel.addEventListener('click', async (event) => {
    const nav = event.target.closest('[data-week]');
    if (nav) { week = addDays(week, 7 * Number(nav.dataset.week)); if (!editingId) resetForm(); render(); return; }
    const edit = event.target.closest('[data-edit]');
    if (edit) {
      const r = items.find((i) => i.id === edit.dataset.edit); if (!r) return;
      editingId = r.id; form.elements.date.value = r.date; form.elements.company.value = r.company; form.elements.contact.value = r.contact || '';
      form.querySelector(`input[name=method][value="${r.method}"]`).checked = true; form.elements.count.value = r.count;
      $('[data-form-title]').textContent = '샘플북 분출 수정'; $('[data-save]').textContent = '수정 저장'; $('[data-cancel]').hidden = false;
      render(); form.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
    const del = event.target.closest('[data-delete]');
    if (del && !busy) {
      const r = items.find((i) => i.id === del.dataset.delete); if (!r) return;
      if (!window.confirm(`${r.company} 기록을 삭제할까요? 시트에서도 지워져요.`)) return;
      busy = true; del.disabled = true;
      try { await api.request('deleteSampleBook', { id: r.id }); items = items.filter((i) => i.id !== r.id); if (editingId === r.id) resetForm(); message.textContent = '삭제했어요.'; }
      catch (error) { message.textContent = error.message; }
      finally { busy = false; render(); }
      return;
    }
    if (event.target.closest('[data-cancel]')) { resetForm(); render(); return; }
    if (event.target.closest('[data-export-last]') && !busy) { week = addDays(mondayOf(new Date()), -7); if (!editingId) resetForm(); render(); exportPdf(); return; }
    if (event.target.closest('[data-export]') && !busy) exportPdf();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy || !admin()) return;
    const data = { id: editingId || crypto.randomUUID(), date: form.elements.date.value, company: form.elements.company.value.trim(), contact: form.elements.contact.value.trim(), method: form.elements.method.value, count: Number(form.elements.count.value) };
    if (!data.date || !data.company || !Number.isInteger(data.count) || data.count < 1) { message.textContent = '날짜, 업체명, 권수를 확인해 주세요.'; return; }
    busy = true; $('[data-save]').disabled = true; message.textContent = '저장하고 있어요…';
    try {
      const result = await api.request('saveSampleBook', data);
      const saved = { ...data, created: result.item?.created || new Date().toISOString() };
      items = items.filter((i) => i.id !== data.id).concat(saved);
      const savedWeek = mondayOf(parse(data.date)); if (key(savedWeek) !== key(week)) week = savedWeek;   // 저장한 기록이 보이는 주로 이동
      message.textContent = editingId ? '수정했어요.' : '저장했어요.'; resetForm();
      form.elements.company.focus();
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; $('[data-save]').disabled = false; render(); }
  });

  async function exportPdf() {
    const rows = weekItems();
    if (!rows.length && !window.confirm('이 기간에 기록이 없어요. 빈 보고서를 만들까요?')) return;
    busy = true; render(); const button = $('[data-export]'), text = button.innerHTML; button.textContent = 'PDF 만드는 중…'; message.textContent = '양식에 채워서 PDF로 만들고 있어요. 10초쯤 걸려요.';
    try {
      const result = await api.request('sampleBookReport', { weekStart: key(week) });
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], result.name || `주간 샘플북 분출 리스트_${key(week)}.pdf`, { type: 'application/pdf' });
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      message.textContent = `${file.name} 저장했어요 (${result.count}건 · ${result.books}권).`;
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; button.innerHTML = text; render(); }
  }

  let shownOn = '';
  window.addEventListener('spec-samples-visible', () => {
    const todayKey = key(new Date());
    if (shownOn !== todayKey) { shownOn = todayKey; week = mondayOf(new Date()); }   // 날짜가 바뀌었으면 이번 주로
    if (!editingId) resetForm(); load();
  });
  window.addEventListener('access-change', () => { if (!admin()) { version++; items = []; loaded = false; render(); } });
  resetForm(); render();
})();
