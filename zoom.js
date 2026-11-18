// 화면 전체 확대는 막고, 팝업 속 이미지만 확대할 수 있게 한다.
// 이미지: 두 손가락으로 벌리기 · 두 번 탭(2.5배 ↔ 원래) · 마우스 휠, 확대한 상태에서는 끌어서 이동.
(function () {
  'use strict';
  const ZOOMABLE = '.registry-photo-gallery img, .board-detail-images img, .detail-dialog img, .specs-photos img';
  const MAX = 5;

  // iOS Safari는 viewport 설정만으로 핀치 확대를 막지 않아서 제스처 이벤트를 직접 막는다.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) =>
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false }));

  const states = new WeakMap();
  const stateOf = (img) => { let s = states.get(img); if (!s) states.set(img, s = { scale: 1, x: 0, y: 0, pointers: new Map(), start: null, lastTap: 0 }); return s; };
  function clamp(img, s) {
    const box = img.parentElement.getBoundingClientRect(), maxX = box.width * (s.scale - 1) / 2, maxY = box.height * (s.scale - 1) / 2;
    s.x = Math.max(-maxX, Math.min(maxX, s.x)); s.y = Math.max(-maxY, Math.min(maxY, s.y));
  }
  function apply(img, s, animate) {
    if (s.scale <= 1.01) { s.scale = 1; s.x = 0; s.y = 0; }
    clamp(img, s);
    img.style.transition = animate ? 'transform .22s ease' : 'none';
    img.style.transform = s.scale === 1 ? '' : `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
    img.classList.toggle('is-zoomed', s.scale > 1);
  }
  function zoomAt(img, s, next, cx, cy) {
    const box = img.parentElement.getBoundingClientRect(), ox = cx - (box.left + box.width / 2), oy = cy - (box.top + box.height / 2);
    next = Math.max(1, Math.min(MAX, next));
    s.x = ox - (ox - s.x) * next / s.scale; s.y = oy - (oy - s.y) * next / s.scale; s.scale = next;
  }
  const target = (e) => e.target.closest?.(ZOOMABLE);

  document.addEventListener('pointerdown', (e) => {
    const img = target(e); if (!img) return;
    const s = stateOf(img); s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    img.setPointerCapture?.(e.pointerId);
    if (s.pointers.size === 2) { const [a, b] = [...s.pointers.values()]; s.start = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: s.scale }; }
    // 확대한 상태에서는 넘기기(캐러셀 스와이프)보다 이동이 먼저다.
    if (s.scale > 1 || s.pointers.size > 1) e.stopPropagation();
  }, true);
  document.addEventListener('pointermove', (e) => {
    const img = target(e); if (!img) return;
    const s = stateOf(img), prev = s.pointers.get(e.pointerId); if (!prev) return;
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.pointers.size === 2 && s.start) {
      const [a, b] = [...s.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(img, s, s.start.scale * d / s.start.d, (a.x + b.x) / 2, (a.y + b.y) / 2); apply(img, s, false); e.stopPropagation(); return;
    }
    if (s.scale > 1) { s.x += e.clientX - prev.x; s.y += e.clientY - prev.y; apply(img, s, false); e.stopPropagation(); }
  }, true);
  const release = (e) => {
    const img = target(e); if (!img) return;
    const s = stateOf(img); if (!s.pointers.delete(e.pointerId)) return;
    if (s.pointers.size < 2) s.start = null;
    if (e.type === 'pointerup' && s.pointers.size === 0 && e.pointerType !== 'mouse') {
      const now = Date.now();
      if (now - s.lastTap < 300) { zoomAt(img, s, s.scale > 1 ? 1 : 2.5, e.clientX, e.clientY); apply(img, s, true); s.lastTap = 0; } else s.lastTap = now;
    }
    if (s.scale > 1) e.stopPropagation();
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  document.addEventListener('dblclick', (e) => { const img = target(e); if (!img) return; const s = stateOf(img); zoomAt(img, s, s.scale > 1 ? 1 : 2.5, e.clientX, e.clientY); apply(img, s, true); });
  document.addEventListener('wheel', (e) => {
    const img = target(e); if (!img) return; e.preventDefault();
    const s = stateOf(img); zoomAt(img, s, s.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); apply(img, s, false);
  }, { passive: false });
  // 팝업을 닫거나 다른 이미지로 넘기면 원래 크기로.
  document.addEventListener('close', (e) => e.target.querySelectorAll?.('img.is-zoomed').forEach((img) => { const s = stateOf(img); s.scale = 1; apply(img, s, false); }), true);
  document.addEventListener('click', (e) => { if (!e.target.closest('.registry-carousel-nav')) return; e.target.closest('.registry-carousel')?.querySelectorAll('img.is-zoomed').forEach((img) => { const s = stateOf(img); s.scale = 1; apply(img, s, false); }); }, true);
})();
