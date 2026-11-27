// 영업 관리
// · 첫 화면: 업체 목록(검색 · 최근순/가나다순 · 30개씩 쪽 나누기) — 업체가 수백 개여도 가볍게
// · 업체를 누르면: 그 업체의 진행 기록이 날짜별 게시글로 쌓인다(사진 · 담당자 · 현장 · 다음 할 일)
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id), api = window.ZIP_API;
  const view = $('sales-view'), nav = $('sales-nav-button');
  if (!view || !nav || !api) return;
  const admin = () => window.CHAE_AUTH?.user?.role === 'admin';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = (v) => String(v ?? '').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, '');
  const same = (a, b) => fold(a) === fold(b);
  const pad = (n) => String(n).padStart(2, '0');
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const dayLabel = (k) => { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${y}.${pad(m)}.${pad(d)} (${DAYS[dt.getDay()]})`; };
  const shortDay = (k) => { const [, m, d] = k.split('-').map(Number); return `${m}.${pad(d)}`; };
  const driveId = (url) => (String(url).match(/^https:\/\/drive\.google\.com\/file\/d\/([-\w]{10,200})(?:\/|$)/) || [])[1] || '';
  const PAGE = 30;
  let items = [], types = ['미팅', '전화', '방문', '샘플 발송', '제안', '견적', '기타'], loaded = false, loading = false, version = 0;
  let company = '', contact = '', site = '', query = '', sort = 'recent', page = 1, siteNames = [], siteCompanies = [];

  window.addEventListener('spec-map-data', (e) => { if (!Array.isArray(e.detail)) return; siteNames = [...new Set(e.detail.map((s) => s.name).filter(Boolean))]; siteCompanies = [...new Set(e.detail.flatMap((s) => [s.builder, s.designer]).filter(Boolean))]; });

  const hl = (text) => window.ZIP_MARK ? window.ZIP_MARK(text, query) : esc(text);
  const hits = (x) => { if (!query) return true; const text = [x.company, x.contact, x.site, x.type, x.content, x.next].join(' ').toLocaleLowerCase('ko'); return query.toLocaleLowerCase('ko').split(/\s+/).every((w) => text.includes(w)); };

  view.innerHTML = `
    <header class="specs-heading sales-heading"><div><p class="eyebrow">SALES</p><h1 id="sales-title">영업 관리</h1></div><button id="sales-add" class="view-tabs-add" type="button"><span aria-hidden="true">＋</span> <span data-add-label>기록 추가</span></button></header>
    <div class="sales-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><label class="sr-only" for="sales-search">영업 검색</label><input id="sales-search" type="search" autocomplete="off" placeholder="업체 · 담당자 · 현장 · 내용 검색"></div>
    <p id="sales-message" class="sales-message" role="status"></p>
    <section class="sales-directory" aria-label="업체 목록"></section>
    <section class="sales-company" aria-label="업체 진행 기록" hidden></section>`;
  const directory = view.querySelector('.sales-directory'), companyPage = view.querySelector('.sales-company');

  // ── 업체 목록 ──
  function companyGroups(list) {
    const map = new Map();
    for (const x of list) {
      const k = fold(x.company); const g = map.get(k) || { name: x.company, count: 0, last: '', contacts: new Set(), sites: new Set(), next: null, photos: 0 };
      g.count++; if (x.date > g.last) g.last = x.date; if (x.contact) g.contacts.add(x.contact); if (x.site) g.sites.add(x.site); g.photos += (x.images || []).length;
      if (x.nextDate && x.nextDate >= todayKey() && (!g.next || x.nextDate < g.next.nextDate)) g.next = x;
      map.set(k, g);
    }
    return [...map.values()];
  }
  function renderDirectory() {
    const matched = items.filter(hits), groups = companyGroups(matched);
    groups.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ko') : (a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name, 'ko'));
    const pages = Math.max(1, Math.ceil(groups.length / PAGE)); page = Math.min(page, pages);
    const shown = groups.slice((page - 1) * PAGE, page * PAGE);
    const first = Math.max(1, Math.min(page - 3, pages - 6)), nums = Array.from({ length: Math.min(7, pages) }, (_, i) => first + i);
    directory.innerHTML = `
      <div class="sales-dir-bar"><span>${query ? `검색 결과 업체 ${groups.length}곳 · 기록 ${matched.length}건` : `업체 ${groups.length}곳 · 기록 ${items.length}건`}</span>
        <div class="sales-sort" role="group" aria-label="정렬"><button type="button" data-sort="recent" aria-pressed="${sort === 'recent'}">최근 대응순</button><button type="button" data-sort="name" aria-pressed="${sort === 'name'}">가나다순</button></div></div>
      ${!loaded ? '<p class="sales-empty">영업 기록을 불러오는 중이에요…</p>' : shown.length ? `<div class="sales-cards">${shown.map((g) => `
        <button type="button" class="sales-card" data-company="${esc(g.name)}">
          <span class="sales-card-top"><b>${hl(g.name)}</b><span>${g.count}건</span></span>
          <span class="sales-card-meta">마지막 대응 ${esc(shortDay(g.last))}${g.photos ? ` · 사진 ${g.photos}` : ''}</span>
          ${g.contacts.size ? `<span class="sales-card-line">담당 ${hl([...g.contacts].slice(0, 3).join(', '))}${g.contacts.size > 3 ? ` 외 ${g.contacts.size - 3}` : ''}</span>` : ''}
          ${g.sites.size ? `<span class="sales-card-line">현장 ${hl([...g.sites].slice(0, 3).join(', '))}${g.sites.size > 3 ? ` 외 ${g.sites.size - 3}` : ''}</span>` : ''}
          ${g.next ? `<span class="sales-card-next ${g.next.nextDate === todayKey() ? 'is-today' : ''}">다음 ${esc(shortDay(g.next.nextDate))} · ${esc(g.next.next)}</span>` : ''}
        </button>`).join('')}</div>` : `<p class="sales-empty">${query ? '검색 결과가 없어요.' : '아직 기록이 없어요. ＋ 기록 추가로 첫 대응을 남겨 보세요.'}</p>`}
      ${pages > 1 ? `<nav class="sales-pager" aria-label="업체 쪽"><button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="이전 쪽">‹</button>${nums.map((n) => `<button type="button" data-page="${n}" class="${n === page ? 'is-current' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="다음 쪽">›</button></nav>` : ''}`;
  }

  // ── 업체 페이지: 날짜별 게시글 ──
  function renderCompany() {
    const all = items.filter((x) => same(x.company, company));
    const contacts = [...new Set(all.map((x) => x.contact).filter(Boolean))], sites = [...new Set(all.map((x) => x.site).filter(Boolean))];
    if (contact && !contacts.some((v) => same(v, contact))) contact = '';
    if (site && !sites.some((v) => same(v, site))) site = '';
    const posts = all.filter((x) => hits(x) && (!contact || same(x.contact, contact)) && (!site || same(x.site, site)))
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.created).localeCompare(String(a.created)));
    const today = todayKey(), dates = all.map((x) => x.date).sort();
    companyPage.innerHTML = `
      <div class="sales-company-head"><button type="button" class="sales-back" data-back aria-label="업체 목록으로">‹</button><div><h2>${esc(company)}</h2><p>기록 ${all.length}건${dates.length ? ` · 처음 ${esc(shortDay(dates[0]))} · 최근 ${esc(shortDay(dates[dates.length - 1]))}` : ''}</p></div></div>
      ${contacts.length ? `<div class="sales-chips"><span>담당자</span><button type="button" data-contact="" aria-pressed="${!contact}">전체</button>${contacts.map((v) => `<button type="button" data-contact="${esc(v)}" aria-pressed="${same(v, contact)}">${hl(v)}</button>`).join('')}</div>` : ''}
      ${sites.length ? `<div class="sales-chips"><span>현장</span><button type="button" data-site="" aria-pressed="${!site}">전체</button>${sites.map((v) => `<button type="button" data-site="${esc(v)}" aria-pressed="${same(v, site)}">${hl(v)}</button>`).join('')}</div>` : ''}
      <ol class="sales-feed">${posts.map((x) => {
        const due = x.nextDate ? (x.nextDate < today ? 'is-late' : x.nextDate === today ? 'is-today' : '') : '', photos = x.images || [];
        return `<li class="sales-post ${x.pending ? 'is-pending' : ''}" data-view="${esc(x.id)}" tabindex="0" role="button" aria-label="${esc(dayLabel(x.date))} 기록 자세히 보기">
          <header><time>${esc(dayLabel(x.date))}</time>${x.type ? `<em>${esc(x.type)}</em>` : ''}${x.pending ? '<span class="sales-pending">저장 중</span>' : `<span class="sales-post-more" aria-hidden="true">›</span>`}</header>
          ${x.contact || x.site ? `<p class="sales-post-who">${x.contact ? `<span>${hl(x.contact)}</span>` : ''}${x.site ? `<span class="sales-site">⌖ ${hl(x.site)}</span>` : ''}</p>` : ''}
          ${x.content ? `<p class="sales-post-body">${hl(x.content)}</p>` : ''}
          ${photos.length ? `<div class="sales-photos" data-count="${Math.min(photos.length, 4)}">${photos.slice(0, 4).map((u, i) => `<button type="button" data-photo="${esc(x.id)}" data-index="${i}"><img data-src="${esc(u)}" alt="${esc(company)} 사진 ${i + 1}" loading="lazy" decoding="async" referrerpolicy="no-referrer">${i === 3 && photos.length > 4 ? `<span>+${photos.length - 4}</span>` : ''}</button>`).join('')}</div>` : ''}
          ${x.next ? `<p class="sales-next ${due}">다음 · ${hl(x.next)}${x.nextDate ? ` <time>${esc(shortDay(x.nextDate))}</time>` : ''}</p>` : ''}
        </li>`;
      }).join('') || `<li class="sales-empty">${query ? '이 업체에서 검색 결과가 없어요.' : '아직 기록이 없어요.'}</li>`}</ol>`;
    companyPage.querySelectorAll('img[data-src]').forEach((img) => setImage(img, img.dataset.src));
  }
  function setImage(img, url) {
    const id = driveId(url); img.removeAttribute('data-src');
    const fail = () => img.closest('button')?.classList.add('is-broken');
    img.onerror = fail;
    if (!id) { img.src = url; return; }
    api.image(id, { action: 'salesImage' }).then((src) => { if (src) img.src = src; else fail(); }).catch(fail);
  }
  function render() {
    const inCompany = !!company;
    directory.hidden = inCompany; companyPage.hidden = !inCompany;
    view.querySelector('[data-add-label]').textContent = inCompany ? '글 쓰기' : '기록 추가';
    if (inCompany) renderCompany(); else renderDirectory();
  }

  async function load(force) {
    if (!admin() || loading || (loaded && !force)) { render(); return; }
    loading = true; const v = ++version;
    try { const r = await api.request('salesLog'); if (v !== version) return; items = r.items || []; if (Array.isArray(r.types) && r.types.length) types = r.types; loaded = true; $('sales-message').textContent = ''; }
    catch (e) { if (v === version) $('sales-message').textContent = e.message; }
    finally { loading = false; if (v === version) render(); }
  }

  // ── 기록 자세히 보기(팝업): 전체 내용 · 사진 전부 · 다음 할 일, 여기서 수정 ──
  const viewer = document.createElement('dialog'); viewer.className = 'specs-dialog sales-viewer'; viewer.setAttribute('aria-labelledby', 'sales-viewer-title');
  viewer.innerHTML = '<header class="registry-detail-heading"><h2 id="sales-viewer-title"></h2><div><button type="button" class="registry-detail-edit" data-viewer-edit aria-label="이 기록 수정" title="수정"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm9.5-13.5 4 4"/></svg></button><button type="button" data-detail-close aria-label="닫기">×</button></div></header><div class="sales-viewer-body"></div>';
  document.body.append(viewer);
  let viewing = null;
  viewer.querySelector('[data-detail-close]').onclick = () => viewer.close();
  viewer.querySelector('[data-viewer-edit]').onclick = () => { const x = viewing; viewer.close(); edit(x); };
  viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });
  function openPost(x, index = -1) {
    viewing = x; const today = todayKey(), photos = x.images || [];
    const due = x.nextDate ? (x.nextDate < today ? 'is-late' : x.nextDate === today ? 'is-today' : '') : '';
    viewer.querySelector('#sales-viewer-title').textContent = x.company;
    viewer.querySelector('[data-viewer-edit]').hidden = !!x.pending;
    const body = viewer.querySelector('.sales-viewer-body');
    body.innerHTML = `
      <p class="sales-viewer-date"><time>${esc(dayLabel(x.date))}</time>${x.type ? `<em>${esc(x.type)}</em>` : ''}</p>
      ${x.contact || x.site ? `<dl class="sales-viewer-meta">${x.contact ? `<div><dt>담당자</dt><dd>${hl(x.contact)}</dd></div>` : ''}${x.site ? `<div><dt>현장</dt><dd>${hl(x.site)}</dd></div>` : ''}</dl>` : ''}
      ${x.content ? `<p class="sales-viewer-content">${hl(x.content)}</p>` : ''}
      ${photos.length ? `<div class="sales-viewer-photos registry-photo-gallery">${photos.map((u, i) => `<figure><img data-src="${esc(u)}" alt="${esc(x.company)} 사진 ${i + 1}" decoding="async" referrerpolicy="no-referrer"></figure>`).join('')}</div>` : ''}
      ${x.next ? `<p class="sales-next ${due}">다음 · ${hl(x.next)}${x.nextDate ? ` <time>${esc(dayLabel(x.nextDate))}</time>` : ''}</p>` : ''}`;
    body.querySelectorAll('img[data-src]').forEach((img) => setImage(img, img.dataset.src));
    viewer.showModal(); body.scrollTop = 0;
    if (index >= 0) body.querySelectorAll('.sales-viewer-photos figure')[index]?.scrollIntoView({ block: 'start' });
  }

  // ── 글 쓰기 / 수정 ──
  const editor = document.createElement('dialog'); editor.className = 'specs-dialog sales-editor'; editor.setAttribute('aria-labelledby', 'sales-editor-title');
  editor.innerHTML = `<h2 id="sales-editor-title">영업 기록</h2><form id="sales-form" autocomplete="off">
    <div class="sales-form-grid">
      <label>날짜 *<input name="date" type="date" required></label>
      <fieldset class="sales-types"><legend>유형</legend><div></div></fieldset>
      <label>업체 *<input name="company" list="sales-company-list" maxlength="100" required placeholder="예: 현대건설"></label>
      <label>담당자<input name="contact" list="sales-contact-list" maxlength="100" placeholder="예: 최수지 과장"></label>
      <label class="sales-wide">현장<input name="site" list="sales-site-list" maxlength="200" placeholder="예: 평택 센트럴"></label>
      <label class="sales-wide">대응 내용<textarea name="content" rows="5" maxlength="4000" placeholder="어떻게 대응했는지 적어 두세요"></textarea></label>
      <div class="sales-wide sales-photo-field"><p>사진 <span>(최대 12장)</span></p>
        <div class="registry-photo-sources" role="group" aria-label="사진 추가 방법"><button type="button" class="install-button" data-photo-source="gallery">🖼 사진첩</button><button type="button" class="install-button" data-photo-source="camera">📷 촬영하기</button><button type="button" class="install-button" data-photo-source="url">🔗 URL</button></div>
        <input type="file" accept="image/*" multiple data-photo-gallery hidden><input type="file" accept="image/*" capture="environment" data-photo-camera hidden>
        <div class="board-image-url" data-photo-url hidden><input type="url" maxlength="2000" placeholder="https://example.com/photo.jpg" aria-label="사진 URL"><button type="button" class="install-button" data-photo-url-add>추가</button></div>
        <div class="sales-photo-preview" data-photo-preview></div></div>
      <label>다음 할 일<input name="next" maxlength="1000" placeholder="예: 샘플북 2권 발송"></label>
      <label>다음 일정<input name="nextDate" type="date"></label>
      <label class="sales-wide sales-check"><input type="checkbox" name="toSchedule"> 다음 일정을 스케줄(구글 캘린더)에도 추가</label>
    </div>
    <datalist id="sales-company-list"></datalist><datalist id="sales-contact-list"></datalist><datalist id="sales-site-list"></datalist>
    <p class="sales-editor-message" role="status"></p>
    <div class="specs-actions"><button type="button" class="install-button" data-delete hidden>삭제</button><button type="button" class="install-button" data-cancel>취소</button><button type="submit" class="view-tabs-add">저장</button></div></form>`;
  document.body.append(editor);
  const form = editor.querySelector('form'), emsg = editor.querySelector('.sales-editor-message');
  let editing = null, editType = '', photos = [], uploading = 0;

  function fillLists() {
    const companies = [...new Set([...items.map((x) => x.company), ...siteCompanies].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('sales-company-list').innerHTML = companies.map((v) => `<option value="${esc(v)}">`).join('');
    const c = form.elements.company.value;
    $('sales-contact-list').innerHTML = [...new Set(items.filter((x) => !c || same(x.company, c)).map((x) => x.contact).filter(Boolean))].map((v) => `<option value="${esc(v)}">`).join('');
    $('sales-site-list').innerHTML = [...new Set([...items.filter((x) => !c || same(x.company, c)).map((x) => x.site), ...siteNames].filter(Boolean))].map((v) => `<option value="${esc(v)}">`).join('');
  }
  function drawTypes() { editor.querySelector('.sales-types div').innerHTML = types.map((t) => `<button type="button" data-type="${esc(t)}" aria-pressed="${t === editType}">${esc(t)}</button>`).join(''); }
  function drawPhotos() {
    const box = editor.querySelector('[data-photo-preview]');
    box.innerHTML = photos.length ? photos.map((u, i) => `<figure><img data-src="${esc(u)}" alt="사진 ${i + 1}" decoding="async" referrerpolicy="no-referrer"><button type="button" class="registry-photo-remove" data-photo-remove="${i}" aria-label="사진 ${i + 1} 빼기">×</button></figure>`).join('') : '<p class="registry-photo-empty">아직 추가한 사진이 없어요.</p>';
    box.querySelectorAll('img[data-src]').forEach((img) => { const blob = img.dataset.src.startsWith('blob:'); if (blob) { img.src = img.dataset.src; img.removeAttribute('data-src'); } else setImage(img, img.dataset.src); });
  }
  async function resizePhoto(file) {
    if (!/^image\//.test(file.type) || file.size > 25 * 1024 * 1024) throw Error('사진 파일은 장당 25MB까지 올릴 수 있어요.');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * k)); canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.84)); if (!blob) throw Error('사진을 처리하지 못했어요.');
      const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
      return { blob, payload: { name: (file.name || '영업 사진').replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', base64 } };
    } catch (error) { throw error.message?.includes('사진') ? error : Error('이 사진 형식은 열 수 없어요. JPG·PNG로 다시 시도해 주세요.'); } finally { URL.revokeObjectURL(url); }
  }
  async function upload(files) {
    files = [...files].filter(Boolean); if (!files.length) return;
    const room = 12 - photos.length; if (room <= 0) { emsg.textContent = '사진은 최대 12장까지예요.'; return; }
    files = files.slice(0, room); uploading++; form.querySelector('[type=submit]').disabled = true;
    // 3장씩 동시에 올리고, 고른 순서대로 붙인다.
    const results = [], queue = files.map((file, index) => ({ file, index })); let done = 0;
    const worker = async () => { while (queue.length) { const { file, index } = queue.shift(); const { blob, payload } = await resizePhoto(file); const r = await api.request('uploadNoteImage', payload); api.seedImage?.(r.fileId, blob, 'salesImage'); results[index] = `https://drive.google.com/file/d/${r.fileId}/view`; done++; emsg.textContent = `사진을 올리고 있어요 (${done}/${files.length})…`; } };
    try { emsg.textContent = `사진을 올리고 있어요 (0/${files.length})…`; const failed = (await Promise.allSettled([worker(), worker(), worker()])).find((r) => r.status === 'rejected'); photos = photos.concat(results.filter(Boolean)); drawPhotos(); if (failed) throw failed.reason; emsg.textContent = `사진 ${done}장을 추가했어요. 저장을 눌러 주세요.`; }
    catch (e) { emsg.textContent = e.message || '사진을 올리지 못했어요.'; }
    finally { uploading--; if (!uploading) form.querySelector('[type=submit]').disabled = false; }
  }

  function edit(x = null) {
    if (!admin()) return;
    if (x?.pending) { $('sales-message').textContent = '아직 시트에 저장하는 중이에요. 잠시 후 다시 열어 주세요.'; return; }
    editing = x; editType = x?.type || ''; photos = [...(x?.images || [])];
    form.reset();
    form.elements.date.value = x?.date || todayKey();
    const pre = { company, contact, site };
    for (const k of ['company', 'contact', 'site', 'content', 'next', 'nextDate']) form.elements[k].value = x ? x[k] || '' : pre[k] || '';
    editor.querySelector('#sales-editor-title').textContent = x ? '영업 기록 수정' : company ? `${company} · 새 글` : '영업 기록 추가';
    editor.querySelector('[data-delete]').hidden = !x; editor.querySelector('[data-photo-url]').hidden = true; emsg.textContent = '';
    drawTypes(); drawPhotos(); fillLists(); editor.showModal();
    form.elements[x || company ? 'content' : 'company'].focus();
  }
  editor.addEventListener('click', (e) => {
    const t = e.target.closest('[data-type]'); if (t) { editType = editType === t.dataset.type ? '' : t.dataset.type; drawTypes(); return; }
    const src = e.target.closest('[data-photo-source]'); if (src && !uploading) { const s = src.dataset.photoSource; if (s === 'url') { editor.querySelector('[data-photo-url]').hidden = false; editor.querySelector('[data-photo-url] input').focus(); } else editor.querySelector(s === 'camera' ? '[data-photo-camera]' : '[data-photo-gallery]').click(); return; }
    if (e.target.closest('[data-photo-url-add]')) { const input = editor.querySelector('[data-photo-url] input'), u = input.value.trim(); if (!/^https:\/\/[^\s<>"']+$/i.test(u) || u.length > 2000) { emsg.textContent = 'https:// 로 시작하는 사진 주소를 넣어 주세요.'; return; } if (photos.length >= 12) { emsg.textContent = '사진은 최대 12장까지예요.'; return; } photos.push(u); input.value = ''; drawPhotos(); return; }
    const rm = e.target.closest('[data-photo-remove]'); if (rm) { photos.splice(Number(rm.dataset.photoRemove), 1); drawPhotos(); return; }
    if (e.target.closest('[data-cancel]')) editor.close();
    if (e.target.closest('[data-delete]')) remove(editing);
  });
  editor.querySelector('[data-photo-gallery]').addEventListener('change', (e) => { upload(e.target.files); e.target.value = ''; });
  editor.querySelector('[data-photo-camera]').addEventListener('change', (e) => { upload(e.target.files); e.target.value = ''; });
  form.elements.company.addEventListener('change', fillLists);

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!admin() || uploading) return;
    const data = { id: editing?.id || crypto.randomUUID(), type: editType, images: [...photos] };
    for (const k of ['date', 'company', 'contact', 'site', 'content', 'next', 'nextDate']) data[k] = form.elements[k].value.trim();
    if (!data.date || !data.company) { emsg.textContent = '날짜와 업체는 꼭 넣어 주세요.'; return; }
    const toSchedule = form.elements.toSchedule.checked && data.nextDate && data.next;
    // 바로 반영하고 시트 저장은 뒤에서. 실패하면 되돌리고 입력한 그대로 창을 다시 연다.
    const before = items, wasEditing = editing;
    items = items.filter((x) => x.id !== data.id).concat({ ...data, created: editing?.created || new Date().toISOString(), pending: true });
    company = data.company; contact = ''; site = '';   // 저장한 업체 페이지로
    editor.close(); $('sales-message').textContent = '시트에 저장하고 있어요…'; render();
    window.ZIP_PENDING_SAVES = (window.ZIP_PENDING_SAVES || 0) + 1;
    try {
      const r = await api.request('saveSalesLog', data);
      items = items.map((x) => x.id === data.id ? { ...data, created: r.item?.created || x.created } : x);
      let note = wasEditing ? '기록을 수정했어요.' : '기록을 저장했어요.';
      if (toSchedule) {
        try { await api.request('addChecklist', { task: `[${data.company}] ${data.next}`.slice(0, 160), date: data.nextDate, time: '', note: [data.contact, data.site].filter(Boolean).join(' · ').slice(0, 1000) }); note += ' 스케줄에도 넣었어요.'; }
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
    const c = e.target.closest('[data-company]'); if (c) { company = c.dataset.company; contact = ''; site = ''; render(); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest('[data-back]')) { company = ''; render(); return; }
    const so = e.target.closest('[data-sort]'); if (so) { sort = so.dataset.sort; page = 1; render(); return; }
    const pg = e.target.closest('[data-page]'); if (pg && !pg.disabled) { page = Number(pg.dataset.page); render(); directory.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    const p = e.target.closest('[data-contact]'); if (p) { contact = p.dataset.contact; render(); return; }
    const s = e.target.closest('[data-site]'); if (s) { site = s.dataset.site; render(); return; }
    const ph = e.target.closest('[data-photo]'); if (ph) { const x = items.find((i) => i.id === ph.dataset.photo); if (x) openPost(x, Number(ph.dataset.index)); return; }
    const v = e.target.closest('[data-view]'); if (v) { const x = items.find((i) => i.id === v.dataset.view); if (x) openPost(x); return; }
    if (e.target.closest('#sales-add')) edit(null);
  });
  view.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-view]')) { e.preventDefault(); e.target.click(); } });
  let timer = 0;
  $('sales-search').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { query = e.target.value.trim(); page = 1; render(); }, 150); });

  function show() {
    if (!admin()) return;
    window.dispatchEvent(new Event('show-notes'));
    for (const id of ['notes-view', 'checklist-view', 'specs-view', 'board-view']) { const el = $(id); if (el) el.hidden = true; }
    const add = $('add-note-button'); if (add) add.hidden = true;
    view.hidden = false; nav.classList.add('active'); load(false);
  }
  function hide() { view.hidden = true; nav.classList.remove('active'); }
  nav.addEventListener('click', () => { if (!view.hidden && company) { company = ''; render(); } show(); });   // 탭을 다시 누르면 업체 목록으로
  window.addEventListener('show-notes', () => { if (!view.hidden) hide(); });
  for (const id of ['category-nav', 'checklist-nav-button', 'specs-nav-button', 'board-nav-button']) $(id)?.addEventListener('click', hide);
  document.querySelector('.brand')?.addEventListener('click', hide);
  window.addEventListener('access-change', () => { nav.hidden = !admin(); if (!admin()) { version++; items = []; loaded = false; company = ''; hide(); } });
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
