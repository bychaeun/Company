// 검색 형광펜: 검색어(띄어쓰기로 여러 단어)를 찾은 자리를 <mark class="hit">로 칠한다. 모든 검색창이 같이 쓴다.
(function () {
  'use strict';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let lastQuery = null, lastRe = null;
  function pattern(query) {
    if (query === lastQuery) return lastRe;
    const words = String(query || '').trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    lastQuery = query; lastRe = words.length ? new RegExp(words.join('|'), 'gi') : null;
    return lastRe;
  }
  function mark(text, query) {
    const raw = String(text ?? ''), re = pattern(query);
    if (!re || !raw) return esc(raw);
    let out = '', last = 0; re.lastIndex = 0;
    raw.replace(re, (m, i) => { out += esc(raw.slice(last, i)) + `<mark class="hit">${esc(m)}</mark>`; last = i + m.length; return m; });
    return out + esc(raw.slice(last));
  }
  // 긴 본문은 찾은 자리가 미리보기에 보이도록 앞부분을 잘라 낸다.
  function snippet(text, query, before = 36) {
    const raw = String(text ?? ''), re = pattern(query);
    if (!re) return mark(raw, query);
    re.lastIndex = 0; const m = re.exec(raw); re.lastIndex = 0;
    if (!m || m.index <= before + 10) return mark(raw, query);
    return '…' + mark(raw.slice(m.index - before), query);
  }
  window.ZIP_MARK = mark; window.ZIP_SNIPPET = snippet;
})();
