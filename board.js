(function(){
 'use strict';
 const $=id=>document.getElementById(id),api=window.ZIP_API,view=$('board-view'),board=$('design-board'),world=$('board-world'),nodes=$('board-nodes'),status=$('board-status');
 const admin=()=>window.CHAE_AUTH?.user?.role==='admin'&&window.CHAE_AUTH.user.status==='approved';
 const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let items=[],loaded=false,loading=false,epoch=0,scale=1,tx=30,ty=30,editing=null,busy=false,writing=false,drag=null,saveTimer;
 const pending=new Map(),pointers=new Map();
 const editor=document.createElement('dialog');editor.className='board-editor';
 editor.innerHTML='<h2>디자인 자료</h2><form><label>제목<input name="title" maxlength="200" required></label><label>메모<textarea name="content" maxlength="8000"></textarea></label><label>사이트 주소<input name="url" type="url" placeholder="https://" maxlength="2000"></label><label>메모지 색<select name="color"><option value="cream">크림</option><option value="pink">핑크</option><option value="mint">민트</option><option value="lavender">라벤더</option></select></label><label>연결할 자료<select name="link"></select></label><p role="status"></p><footer><button class="install-button" type="button" data-remove>삭제</button><button class="install-button" type="button" data-cancel>취소</button><button class="install-button" type="submit">저장</button></footer></form>';
 document.body.append(editor);const form=editor.querySelector('form');
 function transform(){world.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;}
 function lines(){
  $('board-links').innerHTML=items.filter(n=>n.link&&items.some(i=>i.id===n.link)).map(n=>{const end=items.find(i=>i.id===n.link),height=nodes.querySelector(`[data-node="${n.id}"]`)?.offsetHeight||140;return `<path d="M${n.x+260} ${n.y+height/2} C${n.x+350} ${n.y+height/2},${end.x-90} ${end.y+60},${end.x} ${end.y+60}"/>`;}).join('');
 }
 function render(){nodes.innerHTML=items.map(n=>`<article class="board-node" data-node="${esc(n.id)}" data-color="${esc(n.color)}" style="left:${Number(n.x)||0}px;top:${Number(n.y)||0}px"><header tabindex="0" role="button" aria-label="${esc(n.title)} 이동, 방향키 사용"><h2>${esc(n.title)}</h2><button data-edit="${esc(n.id)}" aria-label="${esc(n.title)} 수정">✎</button></header><p>${esc(n.content)}</p>${/^https?:\/\//i.test(n.url)?`<a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.url)}</a>`:''}</article>`).join('');lines();transform();}
 function queue(item){pending.set(item.id,{...item});status.textContent='저장 중…';clearTimeout(saveTimer);saveTimer=setTimeout(flush,450);}
 async function flush(){
  if(writing||!admin())return;writing=true;retry.hidden=true;const version=epoch;
  try{while(pending.size&&version===epoch){const [id,item]=pending.entries().next().value;await api.request('saveBoard',item);if(version!==epoch)return;if(pending.get(id)===item)pending.delete(id);}if(version===epoch)status.textContent='저장됨';}
  catch(e){if(version===epoch){status.textContent='저장 지연';retry.hidden=false;}}
  finally{writing=false;}
 }
 const retry=document.createElement('button');retry.hidden=true;retry.type='button';retry.className='install-button';retry.textContent='다시 저장';retry.onclick=flush;$('board-status').after(retry);
 async function show(){
  if(!admin())return;window.dispatchEvent(new Event('show-notes'));$('notes-view').hidden=true;$('checklist-view').hidden=true;$('specs-view').hidden=true;$('add-note-button').hidden=true;view.hidden=false;$('board-nav-button').classList.add('active');
  if(loaded||loading)return;loading=true;const version=epoch;status.textContent='자료 불러오는 중…';
  try{const data=await api.request('board');if(version!==epoch)return;items=(data.items||[]).filter(n=>/^[a-zA-Z0-9-]{20,80}$/.test(n.id));loaded=true;render();status.textContent='';fit();}
  catch(e){if(version===epoch)status.textContent=e.message;}finally{loading=false;}
 }
 function hide(){view.hidden=true;$('board-nav-button').classList.remove('active');}
 function edit(item){if(busy||!admin())return;editing=item||{id:crypto.randomUUID(),title:'',content:'',url:'',color:'cream',x:(60-tx)/scale+(items.length%3)*290,y:(60-ty)/scale+Math.floor(items.length/3)*220,link:''};
  form.elements.link.innerHTML='<option value="">연결 없음</option>'+items.filter(n=>n.id!==editing.id).map(n=>`<option value="${esc(n.id)}">${esc(n.title)}</option>`).join('');
  ['title','content','url','color','link'].forEach(k=>form.elements[k].value=editing[k]||'');editor.querySelector('[data-remove]').hidden=!item;editor.querySelector('p').textContent='';editor.showModal();form.elements.title.focus();
 }
 form.onsubmit=async e=>{e.preventDefault();if(busy||!admin())return;const data={...editing};['title','content','url','color','link'].forEach(k=>data[k]=form.elements[k].value.trim());
  if(data.url&&!/^https?:\/\//i.test(data.url)){editor.querySelector('p').textContent='http 또는 https 주소를 입력해 주세요.';return;}
  const creating=!items.some(n=>n.id===data.id);items=items.filter(n=>n.id!==data.id).concat(data);queue(data);render();if(creating)fit();editor.close();
 };
 editor.querySelector('[data-cancel]').onclick=()=>editor.close();
 editor.querySelector('[data-remove]').onclick=async()=>{if(busy)return;busy=true;editor.querySelector('p').textContent='삭제 중…';try{
  // Finish pending writes for this node before marking it deleted.
  if(writing||pending.has(editing.id)){editor.querySelector('p').textContent='저장이 끝난 뒤 다시 삭제해 주세요.';return;}
  await api.request('deleteBoard',{id:editing.id});items=items.filter(n=>n.id!==editing.id);render();editor.close();
 }catch(e){editor.querySelector('p').textContent=e.message;}finally{busy=false;}};
 nodes.onclick=e=>{const b=e.target.closest('[data-edit]');if(b)edit(items.find(n=>n.id===b.dataset.edit));};
 function fit(){if(!items.length){scale=1;tx=30;ty=30;transform();return;}const minX=Math.min(...items.map(n=>n.x)),minY=Math.min(...items.map(n=>n.y)),maxX=Math.max(...items.map(n=>n.x+280)),maxY=Math.max(...items.map(n=>n.y+300));scale=Math.max(.25,Math.min(1,(board.clientWidth-60)/(maxX-minX),(board.clientHeight-60)/(maxY-minY)));tx=30-minX*scale;ty=30-minY*scale;transform();}
 function zoom(next,x=board.clientWidth/2,y=board.clientHeight/2){next=Math.max(.25,Math.min(2,next));tx=x-(x-tx)*next/scale;ty=y-(y-ty)*next/scale;scale=next;transform();}
 board.onwheel=e=>{if(e.target.closest('.board-node'))return;e.preventDefault();const r=board.getBoundingClientRect();zoom(scale*(e.deltaY<0?1.1:1/1.1),e.clientX-r.left,e.clientY-r.top);};
 board.addEventListener('pointerdown',e=>{if(e.target.closest('button,a,p'))return;e.preventDefault();board.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const node=e.target.closest('[data-node]');drag={id:node?.dataset.node,x:e.clientX,y:e.clientY};if(pointers.size===2)drag={pinch:Math.hypot(...[...pointers.values()].reduce((a,p,i)=>i?[p.x-a[0],p.y-a[1]]:[p.x,p.y],[]))};});
 board.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||!drag)return;const old=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(drag.pinch)zoom(scale*distance/drag.pinch);drag.pinch=distance;return;}
  const dx=e.clientX-old.x,dy=e.clientY-old.y;if(drag.id){const item=items.find(n=>n.id===drag.id);item.x=Math.max(-100000,Math.min(100000,item.x+dx/scale));item.y=Math.max(-100000,Math.min(100000,item.y+dy/scale));const card=nodes.querySelector(`[data-node="${item.id}"]`);card.style.left=item.x+'px';card.style.top=item.y+'px';lines();}else{tx+=dx;ty+=dy;transform();}});
 function release(e){if(drag?.id){const item=items.find(n=>n.id===drag.id);if(item)queue(item);}pointers.delete(e.pointerId);drag=null;}
 board.addEventListener('pointerup',release);board.addEventListener('pointercancel',release);
 nodes.onkeydown=e=>{const direction={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key],card=e.target.closest('[data-node]');if(direction&&card&&e.target.tagName==='HEADER'){e.preventDefault();const n=items.find(i=>i.id===card.dataset.node);n.x+=direction[0];n.y+=direction[1];queue(n);render();nodes.querySelector(`[data-node="${n.id}"] header`).focus();}};
 $('board-add').onclick=()=>edit();$('board-fit').onclick=fit;$('board-zoom-in').onclick=()=>zoom(scale*1.2);$('board-zoom-out').onclick=()=>zoom(scale/1.2);$('board-nav-button').onclick=show;
 ['show-notes'].forEach(type=>window.addEventListener(type,hide));['category-nav','checklist-nav-button','specs-nav-button'].forEach(id=>$(id).addEventListener('click',hide));
 window.addEventListener('access-change',()=>{$('board-nav-button').hidden=!admin();if(!admin()){epoch++;items=[];loaded=false;pending.clear();editor.close();hide();render();}});
 $('board-nav-button').hidden=!admin();window.addEventListener('beforeunload',e=>{if(pending.size){e.preventDefault();e.returnValue='';}});
})();
