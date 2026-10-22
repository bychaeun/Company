(function(){
 'use strict';
 const $=id=>document.getElementById(id),api=window.ZIP_API,view=$('board-view'),board=$('design-board'),world=$('board-world'),nodes=$('board-nodes'),status=$('board-status');
 const admin=()=>window.CHAE_AUTH?.user?.role==='admin'&&window.CHAE_AUTH.user.status==='approved';
 const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pencil='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm9.5-13.5 4 4"/></svg>';
 let items=[],artboards=[],activeBoard='default',loaded=false,loading=false,epoch=0,scale=1,tx=30,ty=30,editing=null,busy=false,writeTask=null,saveTimer;
 let drag=null,holdTimer,skipOpenUntil=0,selecting=false,deleting=false;
 const pending=new Map(),pointers=new Map(),selected=new Set();
 const currentItems=()=>items.filter(n=>(n.boardId||'default')===activeBoard);
 const urlsOf=n=>(Array.isArray(n.urls)?n.urls:[n.url]).filter(u=>typeof u==='string'&&/^https?:\/\//i.test(u));
 const linksHTML=(item,limit=20)=>urlsOf(item).slice(0,limit).map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`).join('');
 const selection=document.createElement('div');selection.className='board-selection note-selection-bar';selection.hidden=true;
 selection.innerHTML='<span aria-live="polite"></span><button type="button" class="install-button" data-delete>선택 삭제</button><button type="button" class="install-button" data-cancel>취소</button>';board.before(selection);
 const confirmDialog=document.createElement('dialog');confirmDialog.className='board-editor';confirmDialog.innerHTML='<h2>메모지 삭제</h2><p></p><form method="dialog"><footer><button class="install-button" value="cancel">취소</button><button class="install-button" value="delete">삭제하기</button></footer></form>';document.body.append(confirmDialog);
 function confirmDelete(count){confirmDialog.querySelector('p').textContent=`선택한 메모지 ${count}개를 삭제할까요?`;confirmDialog.returnValue='cancel';confirmDialog.showModal();return new Promise(resolve=>confirmDialog.addEventListener('close',()=>resolve(confirmDialog.returnValue==='delete'),{once:true}));}
 function updateSelection(){selection.hidden=!selecting;selection.querySelector('span').textContent=`${selected.size}개 선택`;selection.querySelector('[data-delete]').disabled=deleting||!selected.size;selection.querySelector('[data-cancel]').disabled=deleting;}
 function resetSelection(){selected.clear();selecting=false;updateSelection();}
 selection.querySelector('[data-cancel]').onclick=()=>{resetSelection();render();};
 async function remove(ids){
  if(deleting||!admin()||!ids.length||confirmDialog.open)return;
  const version=epoch;if(!await confirmDelete(ids.length)||version!==epoch||!admin())return;
  deleting=true;updateSelection();renderArtboards();
  try{await flush();if(pending.size)throw Error('저장이 지연되고 있어요. 저장 완료 후 다시 삭제해 주세요.');if(version!==epoch||!admin())return;
   await api.request('deleteBoards',{ids});if(version!==epoch)return;items=items.filter(n=>!ids.includes(n.id));resetSelection();render();editor.close();detail.close();status.textContent='삭제했어요';
  }catch(e){if(version===epoch){status.textContent=e.message;editor.querySelector('[data-message]').textContent=e.message;}}
  finally{deleting=false;updateSelection();renderArtboards();}
 }
 selection.querySelector('[data-delete]').onclick=()=>remove([...selected]);
 const editor=document.createElement('dialog');editor.className='board-editor';
 editor.innerHTML='<h2>디자인 자료</h2><form><label>제목<input name="title" maxlength="200" required></label><label>메모<textarea name="content" maxlength="8000"></textarea></label><fieldset class="board-url-fields"><legend>사이트</legend><div data-url-rows></div><button type="button" class="install-button" data-add-url>＋ 사이트 추가</button></fieldset><label>메모지 색<select name="color"><option value="cream">흰색 (기본)</option><option value="pink">핑크</option><option value="mint">민트</option><option value="lavender">라벤더</option></select></label><label>연결할 자료<select name="link"></select></label><p role="status" data-message></p><footer><button class="install-button" type="button" data-remove>삭제</button><button class="install-button" type="button" data-cancel>취소</button><button class="install-button" type="submit">저장</button></footer></form>';
 document.body.append(editor);const form=editor.querySelector('form');
 function addUrlRow(url=''){
  const rows=editor.querySelector('[data-url-rows]');if(rows.children.length>=20)return;
  const row=document.createElement('div');row.className='board-url-row';row.innerHTML='<input type="url" maxlength="2000" placeholder="https://" aria-label="사이트 주소"><button type="button" aria-label="사이트 주소 제외">×</button>';row.querySelector('input').value=url;row.querySelector('button').onclick=()=>{row.remove();if(!rows.children.length)addUrlRow();};rows.append(row);
 }
 editor.querySelector('[data-add-url]').onclick=()=>addUrlRow();
 const detail=document.createElement('dialog');detail.className='board-detail';detail.setAttribute('aria-labelledby','board-detail-title');document.body.append(detail);
 function showDetail(item){if(!item||!admin()||detail.open||selecting)return;detail.innerHTML=`<header><h2 id="board-detail-title">${esc(item.title)}</h2><button type="button" class="install-button" data-close aria-label="메모지 닫기">×</button></header><div class="board-detail-content">${esc(item.content)}</div><div class="board-detail-links">${linksHTML(item)}</div><footer><button type="button" class="install-button" data-detail-edit>${pencil} 수정</button></footer>`;detail.querySelector('[data-close]').onclick=()=>detail.close();detail.querySelector('[data-detail-edit]').onclick=()=>{detail.close();edit(item);};detail.showModal();}
 function renderArtboards(){
  $('artboard-select').innerHTML=artboards.map(b=>`<option value="${esc(b.id)}">${esc(b.title)}</option>`).join('');$('artboard-select').value=activeBoard;
  $('artboard-title').textContent=artboards.find(b=>b.id===activeBoard)?.title||'기본 대지';
  for(const id of ['artboard-select','artboard-add','artboard-rename','board-add'])$(id).disabled=!loaded||busy||deleting;
 }
 $('artboard-rename').innerHTML=pencil;
 const artEditor=document.createElement('dialog');artEditor.className='board-editor';artEditor.innerHTML='<h2>대지 제목</h2><form><label>제목<input name="title" maxlength="200" required></label><p role="status"></p><footer><button type="button" class="install-button" data-cancel>취소</button><button class="install-button" type="submit">저장</button></footer></form>';document.body.append(artEditor);let editingArtboard;
 function editArtboard(renaming){if(busy||!loaded||!admin())return;editingArtboard=renaming?{...artboards.find(b=>b.id===activeBoard)}:{id:crypto.randomUUID(),title:''};artEditor.querySelector('input').value=editingArtboard.title;artEditor.querySelector('p').textContent='';artEditor.showModal();artEditor.querySelector('input').focus();}
 artEditor.querySelector('[data-cancel]').onclick=()=>{if(!busy)artEditor.close();};
 artEditor.querySelector('form').onsubmit=async e=>{e.preventDefault();if(busy||!admin())return;const value={...editingArtboard,title:artEditor.querySelector('input').value.trim()};if(!value.title)return;busy=true;renderArtboards();const version=epoch;artEditor.querySelector('[type=submit]').disabled=true;
  try{await api.request('saveArtboard',value);if(version!==epoch)return;artboards=artboards.filter(b=>b.id!==value.id).concat(value);activeBoard=value.id;resetSelection();renderArtboards();render();fit();artEditor.close();}
  catch(e){if(version===epoch)artEditor.querySelector('p').textContent=e.message;}finally{busy=false;renderArtboards();artEditor.querySelector('[type=submit]').disabled=false;}
 };
 artEditor.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 $('artboard-add').onclick=()=>editArtboard(false);$('artboard-rename').onclick=()=>editArtboard(true);
 $('artboard-select').onchange=()=>{activeBoard=$('artboard-select').value;resetSelection();renderArtboards();render();fit();};
 function transform(){world.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;}
 function lines(){const rows=currentItems();$('board-links').innerHTML=rows.filter(n=>n.link&&rows.some(i=>i.id===n.link)).map(n=>{const end=rows.find(i=>i.id===n.link),height=nodes.querySelector(`[data-node="${n.id}"]`)?.offsetHeight||140;return `<path d="M${n.x+260} ${n.y+height/2} C${n.x+350} ${n.y+height/2},${end.x-90} ${end.y+60},${end.x} ${end.y+60}"/>`;}).join('');}
 function render(){nodes.innerHTML=currentItems().map(n=>`<article class="board-node ${selected.has(n.id)?'is-selected':''}" data-node="${esc(n.id)}" data-color="${esc(n.color)}" style="left:${Number(n.x)||0}px;top:${Number(n.y)||0}px">${selected.has(n.id)?'<span class="board-selected-mark" aria-label="선택됨">✓</span>':''}<header tabindex="0" role="button" aria-label="${esc(n.title)} ${selecting?'선택':'열기, 방향키로 이동'}" ${selecting?`aria-pressed="${selected.has(n.id)}"`:''}><h2>${esc(n.title)}</h2><button data-edit="${esc(n.id)}" aria-label="${esc(n.title)} 수정">${pencil}</button></header><p>${esc(n.content)}</p>${linksHTML(n,2)}${urlsOf(n).length>2?`<button class="board-more-links" data-open="${esc(n.id)}">사이트 ${urlsOf(n).length}개 모두 보기</button>`:''}</article>`).join('');lines();transform();updateSelection();}
 function toggle(id){if(deleting||!id)return;selecting=true;if(selected.has(id))selected.delete(id);else if(selected.size<100)selected.add(id);render();}
 function queue(item){pending.set(item.id,{...item,urls:[...urlsOf(item)]});status.textContent='저장 중…';clearTimeout(saveTimer);saveTimer=setTimeout(flush,450);}
 function flush(){
  clearTimeout(saveTimer);if(writeTask)return writeTask;if(!admin())return Promise.resolve();retry.hidden=true;const version=epoch;
  writeTask=(async()=>{try{while(pending.size&&version===epoch){const [id,item]=pending.entries().next().value;await api.request('saveBoard',item);if(version!==epoch)return;if(pending.get(id)===item)pending.delete(id);}if(version===epoch)status.textContent='저장됨';}
  catch(e){if(version===epoch){status.textContent='저장 지연';retry.hidden=false;}}})().finally(()=>{writeTask=null;});return writeTask;
 }
 const retry=document.createElement('button');retry.hidden=true;retry.type='button';retry.className='install-button';retry.textContent='다시 저장';retry.onclick=()=>loaded?flush():show();$('board-status').after(retry);
 async function show(){
  if(!admin())return;window.dispatchEvent(new Event('show-notes'));$('notes-view').hidden=true;$('checklist-view').hidden=true;$('specs-view').hidden=true;$('add-note-button').hidden=true;view.hidden=false;$('board-nav-button').classList.add('active');
  if(loaded||loading)return;loading=true;renderArtboards();const version=epoch;status.textContent='자료 불러오는 중…';
  try{const data=await api.request('board');if(version!==epoch)return;items=(data.items||[]).filter(n=>/^[a-zA-Z0-9-]{20,80}$/.test(n.id)).map(n=>({...n,boardId:n.boardId||'default',urls:urlsOf(n)}));artboards=data.artboards?.length?data.artboards:[{id:'default',title:'기본 대지'}];if(!artboards.some(b=>b.id===activeBoard))activeBoard=artboards[0].id;loaded=true;renderArtboards();render();status.textContent='';retry.hidden=true;fit();}
  catch(e){if(version===epoch){status.textContent=e.message;retry.hidden=false;}}finally{loading=false;renderArtboards();}
 }
 function hide(){view.hidden=true;$('board-nav-button').classList.remove('active');clearTimeout(holdTimer);pointers.clear();drag=null;}
 function edit(item){if(busy||deleting||!loaded||!admin())return;const rows=currentItems();editing=item||{id:crypto.randomUUID(),boardId:activeBoard,title:'',content:'',urls:[],color:'cream',x:(60-tx)/scale+(rows.length%3)*290,y:(60-ty)/scale+Math.floor(rows.length/3)*220,link:''};
  form.elements.link.innerHTML='<option value="">연결 없음</option>'+rows.filter(n=>n.id!==editing.id).map(n=>`<option value="${esc(n.id)}">${esc(n.title)}</option>`).join('');for(const k of ['title','content','color','link'])form.elements[k].value=editing[k]||'';editor.querySelector('[data-url-rows]').replaceChildren();const urls=urlsOf(editing);(urls.length?urls:['']).forEach(addUrlRow);editor.querySelector('[data-remove]').hidden=!item;editor.querySelector('[data-message]').textContent='';editor.showModal();form.elements.title.focus();
 }
 form.onsubmit=e=>{e.preventDefault();if(busy||deleting||!admin())return;const data={...editing};for(const k of ['title','content','color','link'])data[k]=form.elements[k].value.trim();data.urls=[...new Set([...editor.querySelectorAll('[data-url-rows] input')].map(i=>i.value.trim()).filter(Boolean))];data.url=data.urls[0]||'';
  if(data.urls.some(u=>!/^https?:\/\//i.test(u))){editor.querySelector('[data-message]').textContent='http 또는 https 주소를 입력해 주세요.';return;}
  const creating=!items.some(n=>n.id===data.id);items=items.filter(n=>n.id!==data.id).concat(data);queue(data);render();if(creating)fit();editor.close();
 };
 editor.querySelector('[data-cancel]').onclick=()=>editor.close();editor.querySelector('[data-remove]').onclick=()=>remove([editing.id]);
 nodes.onclick=e=>{if(Date.now()<skipOpenUntil)return;const b=e.target.closest('[data-edit]');if(b){edit(items.find(n=>n.id===b.dataset.edit));return;}if(e.target.closest('a'))return;const card=e.target.closest('[data-node]');if(card){if(selecting)toggle(card.dataset.node);else showDetail(items.find(n=>n.id===card.dataset.node));}};
 function fit(){const rows=currentItems();if(!rows.length){scale=1;tx=30;ty=30;transform();return;}const minX=Math.min(...rows.map(n=>n.x)),minY=Math.min(...rows.map(n=>n.y)),maxX=Math.max(...rows.map(n=>n.x+280)),maxY=Math.max(...rows.map(n=>n.y+300));scale=Math.max(.25,Math.min(1,(board.clientWidth-60)/(maxX-minX),(board.clientHeight-60)/(maxY-minY)));tx=30-minX*scale;ty=30-minY*scale;transform();}
 function zoom(next,x=board.clientWidth/2,y=board.clientHeight/2){next=Math.max(.25,Math.min(2,next));tx=x-(x-tx)*next/scale;ty=y-(y-ty)*next/scale;scale=next;transform();}
 board.onwheel=e=>{e.preventDefault();clearTimeout(holdTimer);skipOpenUntil=Date.now()+250;const r=board.getBoundingClientRect();zoom(scale*(e.deltaY<0?1.1:1/1.1),e.clientX-r.left,e.clientY-r.top);};
 board.addEventListener('contextmenu',e=>{if(e.target.closest('[data-node]'))e.preventDefault();});
 board.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('button,a')||deleting)return;e.preventDefault();clearTimeout(holdTimer);board.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const node=e.target.closest('[data-node]');drag={id:node?.dataset.node,x:e.clientX,y:e.clientY,moved:false,held:false};
  if(pointers.size===2){const [a,b]=[...pointers.values()];drag={pinch:Math.hypot(a.x-b.x,a.y-b.y),moved:true};return;}
  if(drag.id)holdTimer=setTimeout(()=>{if(!drag?.id||drag.moved||pointers.size!==1)return;drag.held=true;selecting=true;if(selected.size<100)selected.add(drag.id);skipOpenUntil=Date.now()+800;render();},500);
 });
 board.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId)||!drag)return;const old=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2){clearTimeout(holdTimer);const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(drag.pinch)zoom(scale*distance/drag.pinch);drag.pinch=distance;return;}
  if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>6){drag.moved=true;clearTimeout(holdTimer);}if(drag.held||selecting&&drag.id)return;
  const dx=e.clientX-old.x,dy=e.clientY-old.y;if(drag.id){const n=items.find(n=>n.id===drag.id);if(!n)return;n.x=Math.max(-100000,Math.min(100000,n.x+dx/scale));n.y=Math.max(-100000,Math.min(100000,n.y+dy/scale));const card=nodes.querySelector(`[data-node="${n.id}"]`);card.style.left=n.x+'px';card.style.top=n.y+'px';lines();}else{tx+=dx;ty+=dy;transform();}
 });
 function release(e){clearTimeout(holdTimer);skipOpenUntil=Date.now()+500;if(drag?.id){const n=items.find(n=>n.id===drag.id);if(n&&drag.moved&&!selecting)queue(n);if(n&&!drag.moved&&!drag.held&&e.type==='pointerup'){if(selecting)toggle(n.id);else showDetail(n);}}pointers.delete(e.pointerId);drag=null;}
 board.addEventListener('pointerup',release);board.addEventListener('pointercancel',release);
 nodes.onkeydown=e=>{const card=e.target.closest('[data-node]');if(!card||e.target.tagName!=='HEADER')return;const n=items.find(i=>i.id===card.dataset.node),direction={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];if(e.key==='Enter'||e.key===' '){e.preventDefault();if(e.shiftKey||selecting){toggle(n.id);nodes.querySelector(`[data-node="${n.id}"] header`)?.focus();}else showDetail(n);}if(direction&&!selecting){e.preventDefault();n.x+=direction[0];n.y+=direction[1];queue(n);render();nodes.querySelector(`[data-node="${n.id}"] header`).focus();}};
 board.addEventListener('keydown',e=>{if(e.target===board&&['+','=','-'].includes(e.key)){e.preventDefault();zoom(scale*(e.key==='-'?1/1.2:1.2));}});
 $('board-add').onclick=()=>edit();$('board-fit').onclick=fit;$('board-nav-button').onclick=show;
 window.addEventListener('show-notes',hide);for(const id of ['category-nav','checklist-nav-button','specs-nav-button'])$(id).addEventListener('click',hide);
 window.addEventListener('access-change',()=>{$('board-nav-button').hidden=!admin();if(!admin()){epoch++;items=[];artboards=[];loaded=false;pending.clear();resetSelection();editor.close();detail.close();artEditor.close();confirmDialog.close();hide();render();renderArtboards();}});
 $('board-nav-button').hidden=!admin();renderArtboards();window.addEventListener('beforeunload',e=>{if(pending.size){e.preventDefault();e.returnValue='';}});
})();
