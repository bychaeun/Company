(function () {
  'use strict';
  const editors = new Set();
  const discard=document.createElement('dialog');discard.id='editor-discard-confirm';discard.className='board-editor';discard.setAttribute('aria-labelledby','editor-discard-title');
  discard.innerHTML='<h2 id="editor-discard-title">작성 중인 내용이 있어요</h2><p>저장하지 않은 내용을 버리고 닫을까요?</p><form method="dialog"><footer><button type="submit" class="install-button" value="keep" autofocus>계속 작성</button><button type="submit" class="install-button" value="discard">내용 버리고 닫기</button></footer></form>';document.body.append(discard);
  let requested=null;
  discard.addEventListener('close',()=>{const close=requested;requested=null;if(discard.returnValue==='discard')close?.();});
  const fingerprint = dialog => JSON.stringify([...dialog.querySelectorAll('input,textarea,select')].map(el => [el.name || el.id || el.type, el.type === 'checkbox' ? el.checked : el.value, [...(el.files || [])].map(f => [f.name,f.size,f.lastModified])]));
  function protect(dialog) {
    if (dialog.dataset.editorProtected || !dialog.querySelector('form:not([method="dialog"])')) return;
    dialog.dataset.editorProtected = 'true';
    let baseline = '', submitting = false;
    const dirty = () => dialog.open && baseline !== fingerprint(dialog);
    const busy = () => submitting || [...dialog.querySelectorAll('[type="submit"]')].some(b => b.disabled);
    const open = dialog.showModal.bind(dialog);
    dialog.showModal = function () { baseline = fingerprint(dialog); submitting = false; return open(); };
    const requestClose = () => {
      if (busy()) return false;
      if (dirty()) {
        if(!discard.open){requested=()=>{if(dialog.open&&!busy())dialog.close();};discard.returnValue='keep';discard.showModal();}
        return false;
      }
      dialog.close(); return true;
    };
    dialog.addEventListener('click', event => {
      // A pointer released over the backdrop must never throw away an editor.
      if (event.target === dialog) {event.preventDefault();event.stopImmediatePropagation();return;}
      const button = event.target.closest('button');
      if (!button || button.type === 'submit') return;
      if (button.matches('[data-cancel],#note-editor-close,#specs-cancel,[data-editor-close]') || /^(취소|닫기|×|✕)$/.test(button.textContent.trim())) {
        event.preventDefault();event.stopImmediatePropagation();requestClose();
      }
    }, true);
    dialog.addEventListener('cancel', event => {event.preventDefault();requestClose();});
    dialog.addEventListener('submit', () => {
      submitting = true;
      // Existing save handlers own the disabled controls; allow retry after failure.
      queueMicrotask(() => {submitting = false;});
    }, true);
    dialog.addEventListener('close', () => {baseline='';submitting=false;});
    editors.add({dialog,dirty,busy});
  }
  const scan = root => {if(root.nodeType!==1)return;if(root.matches('dialog'))protect(root);root.querySelectorAll('dialog').forEach(protect);};
  scan(document.documentElement);
  new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(scan))).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('beforeunload', event => {
    if ([...editors].some(e => e.dialog.open && (e.dirty() || e.busy()))) {event.preventDefault();event.returnValue='';}
  });
})();
