(function(){
 'use strict';
 const $=id=>document.getElementById(id),api=window.ZIP_API,view=$('board-view'),board=$('design-board'),world=$('board-world'),nodes=$('board-nodes'),status=$('board-status');
 const admin=()=>window.CHAE_AUTH?.user?.role==='admin'&&window.CHAE_AUTH.user.status==='approved';
 const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pencil='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm9.5-13.5 4 4"/></svg>';
 let items=[],artboards=[],activeBoard='default',loaded=false,loading=false,epoch=0,scale=1,tx=30,ty=30,editing=null,busy=false,writeTask=null,saveTimer;
 let drag=null,holdTimer,skipOpenUntil=0,selecting=false,deleting=false,media=false,editingImages=[],uploading=0;
 const pending=new Map(),pointers=new Map(),selected=new Set();
 const currentItems=()=>items.filter(n=>(n.boardId||'default')===activeBoard);
 const urlsOf=n=>(Array.isArray(n.urls)?n.urls:[n.url]).filter(u=>typeof u==='string'&&/^https?:\/\//i.test(u));
 // Note size limits (world px). 0 = default width / height that follows the content.
 const MIN_W=180,MAX_W=1600,MIN_H=120,MAX_H=2400,clampSize=(v,min,max)=>Math.round(Math.max(min,Math.min(max,v)));
 const isPhoto=n=>n?.color==='photo';
 const imagesOf=n=>(Array.isArray(n.images)?n.images:[]).filter(u=>typeof u==='string'&&/^https:\/\/[^\s<>"']+$/i.test(u)&&u.length<=2000).slice(0,12);
 // Photos taken or picked in the app are private Drive files, read through the admin API.
 const driveId=url=>(String(url).match(/^https:\/\/drive\.google\.com\/file\/d\/([-\w]{10,200})(?:\/|$)/)||[])[1]||'';
 function setImage(image,url){const id=driveId(url),fail=()=>image.closest('figure')?.classList.add('is-broken');image.onerror=fail;if(!id){image.src=url;return;}api.image(id,{action:'boardImage'}).then(src=>{if(src)image.src=src;else fail();}).catch(fail);}
 const hydrate=root=>root.querySelectorAll('img[data-src]').forEach(img=>{const url=img.dataset.src;img.removeAttribute('data-src');setImage(img,url);});
 function imagesHTML(item){const urls=imagesOf(item);if(!urls.length)return '';const shown=urls.slice(0,4);return `<div class="board-node-images" data-count="${shown.length}">${shown.map((u,i)=>`<figure><img data-src="${esc(u)}" alt="${esc(item.title)} 이미지 ${i+1}" draggable="false" loading="lazy" decoding="async" referrerpolicy="no-referrer">${i===3&&urls.length>4?`<span>+${urls.length-4}</span>`:''}</figure>`).join('')}</div>`;}
 async function resizePhoto(file){
  if(!/^image\//.test(file.type)||file.size>25*1024*1024)throw Error('사진 파일은 장당 25MB까지 올릴 수 있어요.');
  const url=URL.createObjectURL(file);
  try{const img=new Image();img.src=url;await img.decode();const k=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*k));canvas.height=Math.max(1,Math.round(img.naturalHeight*k));const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
   const blob=await new Promise(done=>canvas.toBlob(done,'image/jpeg',.84));if(!blob)throw Error('사진을 처리하지 못했어요.');
   const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
   return {blob,payload:{name:(file.name||'보드 사진').replace(/\.[^.]+$/,'')+'.jpg',mime:'image/jpeg',base64}};
  }catch(error){throw error.message?.includes('사진')?error:Error('이 사진 형식은 열 수 없어요. JPG·PNG로 다시 시도해 주세요.');}finally{URL.revokeObjectURL(url);}
 }
 // 보드 검색: 찾은 글자를 형광펜(<mark>)으로 칠한다. 대소문자는 가리지 않는다.
 let boardQuery='',boardMatches=[],boardMatchAt=-1;
 const queryPattern=()=>boardQuery?new RegExp(boardQuery.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'):null;
 const hl=text=>{const re=queryPattern(),raw=String(text||'');if(!re)return esc(raw);let out='',last=0;raw.replace(re,(m,i)=>{out+=esc(raw.slice(last,i))+`<mark class="board-hit">${esc(m)}</mark>`;last=i+m.length;return m;});return out+esc(raw.slice(last));};
 const matchesQuery=n=>{const q=boardQuery.toLocaleLowerCase('ko');return !!q&&[n.title,n.content,...urlsOf(n)].some(v=>String(v||'').toLocaleLowerCase('ko').includes(q));};
 const linksHTML=(item,limit=20)=>urlsOf(item).slice(0,limit).map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${hl(u)}</a>`).join('');
 const selection=document.createElement('div');selection.className='board-selection note-selection-bar';selection.hidden=true;
 selection.innerHTML='<span aria-live="polite"></span><label class="board-move"><span class="sr-only">옮길 대지</span><select data-move-target aria-label="옮길 대지"></select></label><button type="button" class="install-button" data-move>대지 이동</button><button type="button" class="install-button" data-delete>선택 삭제</button><button type="button" class="install-button" data-cancel>취소</button>';board.before(selection);
 const confirmDialog=document.createElement('dialog');confirmDialog.className='board-editor';confirmDialog.innerHTML='<h2>메모지 삭제</h2><p></p><form method="dialog"><footer><button class="install-button" value="cancel">취소</button><button class="install-button" value="delete">삭제하기</button></footer></form>';document.body.append(confirmDialog);
 function confirmDelete(count){confirmDialog.querySelector('p').textContent=`선택한 메모지 ${count}개를 삭제할까요?`;confirmDialog.returnValue='cancel';confirmDialog.showModal();return new Promise(resolve=>confirmDialog.addEventListener('close',()=>resolve(confirmDialog.returnValue==='delete'),{once:true}));}
 function updateSelection(){selection.hidden=!selecting;selection.querySelector(':scope > span').textContent=`${selected.size}개 선택`;
  const targets=artboards.filter(b=>b.id!==activeBoard),pick=selection.querySelector('[data-move-target]'),keep=pick.value;
  pick.innerHTML=targets.length?targets.map(b=>`<option value="${esc(b.id)}">${esc(b.title)}</option>`).join(''):'<option value="">다른 대지 없음</option>';if(targets.some(b=>b.id===keep))pick.value=keep;
  pick.disabled=deleting||busy||!targets.length;selection.querySelector('[data-move]').disabled=deleting||busy||!targets.length||!selected.size;selection.querySelector('[data-delete]').disabled=deleting||!selected.size;selection.querySelector('[data-cancel]').disabled=deleting;}
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
 // 선택한 메모지를 다른 대지로 옮긴다. 대지를 넘나드는 연결선은 끊고, 옮긴 묶음은 대상 대지의 오른쪽 빈 곳에 배치한다.
 async function moveSelected(){
  const target=selection.querySelector('[data-move-target]').value,board=artboards.find(b=>b.id===target);if(!board||!selected.size||deleting||busy||!admin())return;
  const version=epoch;busy=true;updateSelection();renderArtboards();status.textContent='옮기는 중…';
  try{await flush();if(pending.size)throw Error('저장이 지연되고 있어요. 저장 완료 후 다시 옮겨 주세요.');if(version!==epoch)return;
   const ids=new Set(selected),moving=items.filter(n=>ids.has(n.id)),there=items.filter(n=>(n.boardId||'default')===target);
   const right=there.length?Math.max(...there.map(n=>n.x+(n.width||260)))+80:Math.min(...moving.map(n=>n.x)),top=there.length?Math.min(...there.map(n=>n.y)):Math.min(...moving.map(n=>n.y));
   const dx=right-Math.min(...moving.map(n=>n.x)),dy=top-Math.min(...moving.map(n=>n.y));
   // 남는 메모지가 옮기는 메모지를 가리키던 연결은 먼저 끊어 저장한다.
   items=items.map(n=>!ids.has(n.id)&&n.link&&ids.has(n.link)?(queue({...n,link:''}),{...n,link:''}):n);
   const moved=new Map(moving.map(n=>[n.id,{...n,boardId:target,x:Math.round(n.x+dx),y:Math.round(n.y+dy),link:n.link&&ids.has(n.link)?n.link:''}]));
   // 서버는 연결 대상이 같은 대지에 있어야 저장하므로, 연결되는 쪽을 먼저 저장한다.
   const order=[],left=new Set(moved.keys());while(left.size){const ready=[...left].filter(id=>!left.has(moved.get(id).link));(ready.length?ready:[...left]).forEach(id=>{left.delete(id);order.push(id);});}
   order.forEach(id=>queue(moved.get(id)));items=items.map(n=>moved.get(n.id)||n);
   await flush();if(version!==epoch)return;if(pending.size)throw Error('일부 메모지를 옮기지 못했어요. 다시 저장을 눌러 주세요.');
   activeBoard=target;resetSelection();renderArtboards();render();fit();status.textContent=`${moved.size}개를 '${board.title}' 대지로 옮겼어요`;
  }catch(e){if(version===epoch){status.textContent=e.message;render();}}
  finally{busy=false;updateSelection();renderArtboards();}
 }
 selection.querySelector('[data-move]').onclick=moveSelected;
 const editor=document.createElement('dialog');editor.className='board-editor';
 editor.innerHTML='<h2 data-editor-title>디자인 자료</h2><form><label>제목<input name="title" maxlength="200" required></label><label data-memo-only>메모<textarea name="content" maxlength="8000"></textarea></label><fieldset class="board-url-fields" data-memo-only><legend>사이트</legend><div data-url-rows></div><button type="button" class="install-button" data-add-url>＋ 사이트 추가</button></fieldset><fieldset class="board-image-fields" data-media hidden><legend>이미지 <span>(최대 12장)</span></legend><div class="registry-photo-sources" role="group" aria-label="이미지 추가 방법"><button type="button" class="install-button" data-photo-source="gallery">🖼 사진첩</button><button type="button" class="install-button" data-photo-source="camera">📷 촬영하기</button><button type="button" class="install-button" data-photo-source="url" aria-expanded="false">🔗 URL</button></div><input type="file" accept="image/*" multiple data-photo-gallery hidden><input type="file" accept="image/*" capture="environment" data-photo-camera hidden><div class="board-image-url" data-image-url hidden><input type="url" maxlength="2000" placeholder="https://example.com/image.jpg" aria-label="이미지 URL"><button type="button" class="install-button" data-image-url-add>추가</button></div><div class="registry-photo-preview" data-image-preview aria-label="이미지 미리보기"></div></fieldset><label data-memo-only>메모지 색<select name="color"><option value="cream">흰색 (기본)</option><option value="pink">핑크</option><option value="mint">민트</option><option value="lavender">라벤더</option></select></label><label>연결할 자료<select name="link"></select></label><button type="button" class="install-button board-size-reset" data-reset-size hidden>메모지 크기 기본값으로</button><p role="status" data-message></p><footer><button class="install-button" type="button" data-remove>삭제</button><button class="install-button" type="button" data-cancel>취소</button><button class="install-button" type="submit">저장</button></footer></form>';
 document.body.append(editor);const form=editor.querySelector('form');
 function addUrlRow(url=''){
  const rows=editor.querySelector('[data-url-rows]');if(rows.children.length>=20)return;
  const row=document.createElement('div');row.className='board-url-row';row.innerHTML='<input type="url" maxlength="2000" placeholder="https://" aria-label="사이트 주소"><button type="button" aria-label="사이트 주소 제외">×</button>';row.querySelector('input').value=url;row.querySelector('button').onclick=()=>{row.remove();if(!rows.children.length)addUrlRow();};rows.append(row);
 }
 editor.querySelector('[data-add-url]').onclick=()=>addUrlRow();
 const imageMessage=text=>{editor.querySelector('[data-message]').textContent=text;};
 function renderImagePreview(){
  const box=editor.querySelector('[data-image-preview]');box.replaceChildren();
  if(!editingImages.length){box.append(Object.assign(document.createElement('p'),{className:'registry-photo-empty',textContent:'아직 추가한 이미지가 없어요.'}));return;}
  editingImages.forEach((url,index)=>{const figure=document.createElement('figure'),image=document.createElement('img'),remove=document.createElement('button');image.alt=`이미지 ${index+1}`;image.decoding='async';image.referrerPolicy='no-referrer';remove.type='button';remove.className='registry-photo-remove';remove.textContent='×';remove.setAttribute('aria-label',`이미지 ${index+1} 빼기`);remove.onclick=()=>{editingImages.splice(index,1);renderImagePreview();};figure.append(image,remove);box.append(figure);setImage(image,url);});
 }
 function addImageUrl(){
  const input=editor.querySelector('[data-image-url] input'),url=input.value.trim();if(!url)return;
  if(url.length>2000||!/^https:\/\/[^\s<>"']+$/i.test(url)){imageMessage('https:// 로 시작하는 이미지 주소를 입력해 주세요.');return;}
  if(editingImages.length>=12){imageMessage('이미지는 최대 12장까지 추가할 수 있어요.');return;}
  if(!editingImages.includes(url))editingImages.push(url);input.value='';imageMessage('');renderImagePreview();
 }
 async function uploadImages(files){
  files=[...files].filter(Boolean);if(!files.length)return;const room=12-editingImages.length;if(room<=0){imageMessage('이미지는 최대 12장까지 추가할 수 있어요.');return;}
  if(files.length>room)files=files.slice(0,room);
  const version=epoch,target=editing;uploading++;form.querySelector('[type=submit]').disabled=true;let done=0;
  // 사진은 3장씩 동시에 올리고, 끝난 것부터 고른 순서대로 미리보기에 붙인다.
  const results=[],queue=files.map((file,index)=>({file,index}));let next=0,stale=false;const live=()=>!stale&&version===epoch&&editing===target&&editor.open;
  const flushReady=()=>{while(results[next]){editingImages.push(`https://drive.google.com/file/d/${results[next]}/view`);next++;}renderImagePreview();};
  const worker=async()=>{while(queue.length){const {file,index}=queue.shift();const {blob,payload}=await resizePhoto(file);const result=await api.request('uploadNoteImage',payload);if(!live()){stale=true;return;}api.seedImage?.(result.fileId,blob,'boardImage');results[index]=result.fileId;done++;imageMessage(`사진을 올리고 있어요 (${done}/${files.length})…`);flushReady();}};
  try{imageMessage(`사진을 올리고 있어요 (0/${files.length})…`);const failed=(await Promise.allSettled([worker(),worker(),worker()])).find(r=>r.status==='rejected');if(stale)return;if(failed)throw failed.reason;
   imageMessage(`사진 ${done}장을 추가했어요. 저장을 눌러 주세요.`);}
  catch(error){imageMessage((done?`${done}장은 추가했어요. `:'')+(error.message||'사진을 올리지 못했어요.'));}
  finally{uploading--;if(!uploading)form.querySelector('[type=submit]').disabled=false;}
 }
 {const camera=editor.querySelector('[data-photo-camera]'),gallery=editor.querySelector('[data-photo-gallery]'),urlRow=editor.querySelector('[data-image-url]');
  camera.onchange=()=>{uploadImages(camera.files);camera.value='';};gallery.onchange=()=>{uploadImages(gallery.files);gallery.value='';};
  editor.querySelector('[data-media] .registry-photo-sources').onclick=e=>{const button=e.target.closest('[data-photo-source]');if(!button||uploading)return;const source=button.dataset.photoSource;
   if(source==='camera')camera.click();else if(source==='gallery')gallery.click();else{urlRow.hidden=false;button.setAttribute('aria-expanded','true');urlRow.querySelector('input').focus();}};
  editor.querySelector('[data-image-url-add]').onclick=addImageUrl;
  urlRow.querySelector('input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addImageUrl();}};}
 const detail=document.createElement('dialog');detail.className='board-detail';detail.setAttribute('aria-labelledby','board-detail-title');document.body.append(detail);
 function showDetail(item){if(!item||!admin()||detail.open||selecting)return;detail.innerHTML=`<header><h2 id="board-detail-title">${esc(item.title)}</h2><button type="button" class="install-button" data-close aria-label="메모지 닫기">×</button></header>${imagesOf(item).length?`<div class="board-detail-images">${imagesOf(item).map((u,i)=>`<figure><img data-src="${esc(u)}" alt="${esc(item.title)} 이미지 ${i+1}" decoding="async" referrerpolicy="no-referrer"></figure>`).join('')}</div>`:''}<div class="board-detail-content">${esc(item.content)}</div><div class="board-detail-links">${linksHTML(item)}</div><footer><button type="button" class="install-button" data-detail-edit>${pencil} 수정</button></footer>`;hydrate(detail);detail.querySelector('[data-close]').onclick=()=>detail.close();detail.querySelector('[data-detail-edit]').onclick=()=>{detail.close();edit(item);};detail.showModal();}
 function renderArtboards(){
  $('artboard-select').innerHTML=artboards.map(b=>`<option value="${esc(b.id)}">${esc(b.title)}</option>`).join('');$('artboard-select').value=activeBoard;
  $('artboard-title').textContent=artboards.find(b=>b.id===activeBoard)?.title||'기본 대지';
  for(const id of ['artboard-select','artboard-add','artboard-rename','board-add','board-photo-add'])$(id).disabled=!loaded||busy||deleting;
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
 $('artboard-select').onchange=()=>{activeBoard=$('artboard-select').value;resetSelection();renderArtboards();render();fit();if(boardQuery)runSearch(false);};
 const search=document.createElement('div');search.className='board-search';
 search.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><label class="sr-only" for="board-search-input">디자인 보드 검색</label><input id="board-search-input" type="search" autocomplete="off" placeholder="보드에서 찾기 (제목·내용·사이트)"><span class="board-search-count" data-count aria-live="polite"></span><button type="button" data-step="-1" aria-label="이전 결과" disabled>‹</button><button type="button" data-step="1" aria-label="다음 결과" disabled>›</button>';
 $('artboard-title').closest('.artboard-title-row').after(search);
 const searchInput=search.querySelector('input');
 // 결과 순서는 대지 순서 → 위→아래 → 왼→오른으로 고정(대지를 옮겨도 번호가 바뀌지 않게).
 function collectMatches(){const order=id=>{const i=artboards.findIndex(b=>b.id===(id||'default'));return i<0?999:i;};return items.filter(matchesQuery).sort((a,b)=>order(a.boardId)-order(b.boardId)||a.y-b.y||a.x-b.x);}
 function showCount(){const here=boardMatches.filter(n=>(n.boardId||'default')===activeBoard).length,other=boardMatches.length-here;
  search.querySelector('[data-count]').textContent=!boardQuery?'':!boardMatches.length?'결과 없음':boardMatchAt<0?(here?`${boardMatches.length}개`:`다른 대지에 ${other}개 · › 로 이동`):`${boardMatchAt+1}/${boardMatches.length}`+(other?` · 다른 대지 ${other}개`:'');
  search.querySelectorAll('[data-step]').forEach(b=>{b.disabled=!boardMatches.length||(boardMatches.length===1&&boardMatchAt===0);});search.classList.toggle('has-query',!!boardQuery);}
 function centerOn(n){const card=nodes.querySelector(`[data-node="${CSS.escape(n.id)}"]`),w=card?.offsetWidth||n.width||260,h=card?.offsetHeight||n.height||140,box=board.getBoundingClientRect();
  tx=box.width/2-(n.x+w/2)*scale;ty=box.height/2-(n.y+h/2)*scale;world.style.transition='transform .35s ease';transform();setTimeout(()=>{world.style.transition='';},380);}
 function goTo(i){if(!boardMatches.length)return;if(boardMatchAt<0&&i>=0)i=Math.max(0,boardMatches.findIndex(n=>(n.boardId||'default')===activeBoard));boardMatchAt=(i+boardMatches.length)%boardMatches.length;const n=boardMatches[boardMatchAt];
  if((n.boardId||'default')!==activeBoard){activeBoard=n.boardId||'default';resetSelection();renderArtboards();}
  render();showCount();requestAnimationFrame(()=>centerOn(n));}
 function runSearch(jump=true){boardQuery=searchInput.value.trim();boardMatches=boardQuery?collectMatches():[];boardMatchAt=-1;
  const firstHere=boardMatches.findIndex(n=>(n.boardId||'default')===activeBoard);
  if(jump&&firstHere>=0){goTo(firstHere);return;}render();showCount();}
 let searchTimer=0;searchInput.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>runSearch(true),160);});
 searchInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(searchTimer);if(searchInput.value.trim()!==boardQuery)runSearch(true);else goTo(boardMatchAt+(e.shiftKey?-1:1));}if(e.key==='Escape'&&searchInput.value){e.preventDefault();e.stopPropagation();searchInput.value='';runSearch(false);}});
 search.addEventListener('click',e=>{const b=e.target.closest('[data-step]');if(b&&!b.disabled)goTo(boardMatchAt+Number(b.dataset.step));});
 function transform(){world.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;world.style.setProperty('--board-inv',String(1/scale));}
 function lines(){const rows=currentItems(),byId=new Map(rows.map(n=>[n.id,n])),cards=new Map([...nodes.children].map(c=>[c.dataset.node,c]));$('board-links').innerHTML=rows.filter(n=>n.link&&byId.has(n.link)).map(n=>{const end=byId.get(n.link),card=cards.get(n.id),height=card?.offsetHeight||140,width=card?.offsetWidth||260;return `<path d="M${n.x+width} ${n.y+height/2} C${n.x+width+90} ${n.y+height/2},${end.x-90} ${end.y+60},${end.x} ${end.y+60}"/>`;}).join('');}
 function render(){if(boardQuery){const cur=boardMatches[boardMatchAt]?.id;boardMatches=collectMatches();boardMatchAt=boardMatches.findIndex(n=>n.id===cur);document.querySelector('.board-search [data-count]')&&showCount();}   // 메모지를 고치거나 지우면 검색 결과도 새로
  nodes.innerHTML=currentItems().map(n=>`<article class="board-node ${selected.has(n.id)?'is-selected':''} ${n.height?'is-sized':''} ${isPhoto(n)?'is-photo':''} ${boardQuery?(matchesQuery(n)?'is-match':'is-dim'):''} ${boardMatches[boardMatchAt]?.id===n.id?'is-current-match':''}" data-node="${esc(n.id)}" data-color="${esc(n.color)}" style="left:${Number(n.x)||0}px;top:${Number(n.y)||0}px;${n.width?`width:${n.width}px;`:''}${n.height?`height:${n.height}px;`:''}">${selected.has(n.id)?'<span class="board-selected-mark" aria-label="선택됨">✓</span>':''}<header tabindex="0" role="button" aria-label="${esc(n.title)} ${selecting?'선택':'열기, 방향키로 이동'+(media?', Alt+방향키로 크기 조절':'')}" ${selecting?`aria-pressed="${selected.has(n.id)}"`:''}><h2>${hl(n.title)}</h2><button data-edit="${esc(n.id)}" aria-label="${esc(n.title)} 수정">${pencil}</button></header><div class="board-node-body">${imagesHTML(n)}${!isPhoto(n)&&(n.content||!imagesOf(n).length)?`<p>${hl(n.content)}</p>`:''}${linksHTML(n,boardQuery&&matchesQuery(n)?20:2)}${urlsOf(n).length>2?`<button class="board-more-links" data-open="${esc(n.id)}">사이트 ${urlsOf(n).length}개 모두 보기</button>`:''}</div>${media&&!selecting?`<span class="board-resize" data-resize title="끌어서 크기 조절 · 두 번 눌러 기본 크기"></span>`:''}</article>`).join('');hydrate(nodes);lines();transform();updateSelection();}
 function toggle(id){if(deleting||!id)return;const wasSelecting=selecting;selecting=true;if(selected.has(id))selected.delete(id);else if(selected.size<100)selected.add(id);
  // 이미 선택 모드면 카드 하나의 표시만 바꾼다(보드 전체를 다시 그리면 이미지까지 다시 불러와 느려진다).
  const card=wasSelecting&&nodes.querySelector(`[data-node="${CSS.escape(id)}"]`);if(!card){render();return;}const on=selected.has(id);card.classList.toggle('is-selected',on);card.querySelector('header')?.setAttribute('aria-pressed',String(on));const mark=card.querySelector('.board-selected-mark');if(on&&!mark)card.prepend(Object.assign(document.createElement('span'),{className:'board-selected-mark',textContent:'✓'}));else if(!on)mark?.remove();updateSelection();}
 function queue(item){const copy={...item,urls:[...urlsOf(item)]};if(media)copy.images=imagesOf(item);else{delete copy.images;delete copy.width;delete copy.height;}pending.set(item.id,copy);status.textContent='저장 중…';clearTimeout(saveTimer);saveTimer=setTimeout(flush,450);}
 function flush(){
  clearTimeout(saveTimer);if(writeTask)return writeTask;if(!admin())return Promise.resolve();retry.hidden=true;const version=epoch;
  writeTask=(async()=>{try{while(pending.size&&version===epoch){const [id,item]=pending.entries().next().value;await api.request('saveBoard',item);if(version!==epoch)return;if(pending.get(id)===item)pending.delete(id);}if(version===epoch)status.textContent='저장됨';}
  catch(e){if(version===epoch){status.textContent='저장 지연';retry.hidden=false;}}})().finally(()=>{writeTask=null;});return writeTask;
 }
 const retry=document.createElement('button');retry.hidden=true;retry.type='button';retry.className='install-button';retry.textContent='다시 저장';retry.onclick=()=>loaded?flush():show();$('board-status').after(retry);
 async function show(){
  if(!admin())return;window.dispatchEvent(new Event('show-notes'));$('notes-view').hidden=true;$('checklist-view').hidden=true;$('specs-view').hidden=true;$('add-note-button').hidden=true;view.hidden=false;$('board-nav-button').classList.add('active');
  if(loaded||loading)return;loading=true;renderArtboards();const version=epoch;status.textContent='자료 불러오는 중…';
  try{const data=await api.request('board');if(version!==epoch)return;media=data.boardMedia===true;items=(data.items||[]).filter(n=>/^[a-zA-Z0-9-]{20,80}$/.test(n.id)).map(n=>({...n,boardId:n.boardId||'default',urls:urlsOf(n),images:imagesOf(n),width:Number(n.width)||0,height:Number(n.height)||0}));artboards=data.artboards?.length?data.artboards:[{id:'default',title:'기본 대지'}];if(!artboards.some(b=>b.id===activeBoard))activeBoard=artboards[0].id;loaded=true;renderArtboards();render();status.textContent='';retry.hidden=true;fit();}
  catch(e){if(version===epoch){status.textContent=e.message;retry.hidden=false;}}finally{loading=false;renderArtboards();}
 }
 function hide(){view.hidden=true;$('board-nav-button').classList.remove('active');clearTimeout(holdTimer);pointers.clear();drag=null;}
 function edit(item,photo=false){if(busy||deleting||!loaded||!admin())return;if(!item&&photo&&!media){status.textContent='사진 카드는 서버 업데이트 후 사용할 수 있어요.';return;}const rows=currentItems();editing=item||{id:crypto.randomUUID(),boardId:activeBoard,title:'',content:'',urls:[],color:photo?'photo':'cream',images:[],width:0,height:0,x:(60-tx)/scale+(rows.length%3)*290,y:(60-ty)/scale+Math.floor(rows.length/3)*220,link:''};
  form.elements.link.innerHTML='<option value="">연결 없음</option>'+rows.filter(n=>n.id!==editing.id).map(n=>`<option value="${esc(n.id)}">${esc(n.title)}</option>`).join('');const photoMode=isPhoto(editing);form.classList.toggle('is-photo',photoMode);editor.querySelectorAll('[data-memo-only]').forEach(el=>{el.hidden=photoMode;});editor.querySelector('[data-editor-title]').textContent=photoMode?'사진 카드':'디자인 자료';form.elements.title.placeholder=photoMode?'사진 제목':'';for(const k of ['title','content','link'])form.elements[k].value=editing[k]||'';form.elements.color.value=photoMode?'cream':editing.color||'cream';editor.querySelector('[data-url-rows]').replaceChildren();const urls=urlsOf(editing);(urls.length?urls:['']).forEach(addUrlRow);editingImages=imagesOf(editing);editor.querySelector('[data-media]').hidden=!media;const urlRow=editor.querySelector('[data-image-url]');urlRow.hidden=true;urlRow.querySelector('input').value='';editor.querySelector('[data-photo-source="url"]').setAttribute('aria-expanded','false');renderImagePreview();editor.querySelector('[data-reset-size]').hidden=!media||!(editing.width||editing.height);editor.querySelector('[data-remove]').hidden=!item;editor.querySelector('[data-message]').textContent='';editor.showModal();form.elements.title.focus();
 }
 form.onsubmit=e=>{e.preventDefault();if(busy||deleting||uploading||!admin())return;const data={...editing};if(media)data.images=[...editingImages];for(const k of ['title','content','color','link'])data[k]=form.elements[k].value.trim();data.urls=[...new Set([...editor.querySelectorAll('[data-url-rows] input')].map(i=>i.value.trim()).filter(Boolean))];data.url=data.urls[0]||'';
  // 사진 카드: 사진 + 제목만 저장하고, 메모·사이트는 비운다. 연결할 자료는 메모지와 똑같이 쓸 수 있다.
  if(isPhoto(editing)){if(!editingImages.length){editor.querySelector('[data-message]').textContent='사진을 1장 이상 추가해 주세요.';return;}Object.assign(data,{color:'photo',content:'',urls:[],url:''});}
  if(data.urls.some(u=>!/^https?:\/\//i.test(u))){editor.querySelector('[data-message]').textContent='http 또는 https 주소를 입력해 주세요.';return;}
  const creating=!items.some(n=>n.id===data.id);items=items.filter(n=>n.id!==data.id).concat(data);queue(data);render();if(creating)fit();editor.close();
 };
 editor.querySelector('[data-cancel]').onclick=()=>editor.close();
 editor.querySelector('[data-reset-size]').onclick=e=>{editing={...editing,width:0,height:0};e.currentTarget.hidden=true;imageMessage('저장하면 기본 크기로 돌아가요.');};editor.querySelector('[data-remove]').onclick=()=>remove([editing.id]);
 nodes.onclick=e=>{if(Date.now()<skipOpenUntil)return;const b=e.target.closest('[data-edit]');if(b){edit(items.find(n=>n.id===b.dataset.edit));return;}if(e.target.closest('a'))return;const card=e.target.closest('[data-node]');if(card){if(selecting)toggle(card.dataset.node);else showDetail(items.find(n=>n.id===card.dataset.node));}};
 function fit(){const rows=currentItems();if(!rows.length){scale=1;tx=30;ty=30;transform();return;}const minX=Math.min(...rows.map(n=>n.x)),minY=Math.min(...rows.map(n=>n.y)),size=n=>{const card=nodes.querySelector(`[data-node="${n.id}"]`);return [card?.offsetWidth||n.width||260,card?.offsetHeight||n.height||280];},maxX=Math.max(...rows.map(n=>n.x+size(n)[0]+20)),maxY=Math.max(...rows.map(n=>n.y+size(n)[1]+20));scale=Math.max(.25,Math.min(1,(board.clientWidth-60)/(maxX-minX),(board.clientHeight-60)/(maxY-minY)));tx=30-minX*scale;ty=30-minY*scale;transform();}
 function zoom(next,x=board.clientWidth/2,y=board.clientHeight/2){next=Math.max(.25,Math.min(2,next));tx=x-(x-tx)*next/scale;ty=y-(y-ty)*next/scale;scale=next;transform();}
 board.onwheel=e=>{e.preventDefault();clearTimeout(holdTimer);skipOpenUntil=Date.now()+250;const r=board.getBoundingClientRect();zoom(scale*(e.deltaY<0?1.1:1/1.1),e.clientX-r.left,e.clientY-r.top);};
 board.addEventListener('dblclick',e=>{if(!e.target.closest('[data-resize]')||!media||selecting)return;const n=items.find(n=>n.id===e.target.closest('[data-node]')?.dataset.node);if(!n||!n.width&&!n.height)return;n.width=0;n.height=0;queue(n);render();});
 board.addEventListener('contextmenu',e=>{if(e.target.closest('[data-node]'))e.preventDefault();});
 board.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('button,a')||deleting)return;e.preventDefault();clearTimeout(holdTimer);board.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const node=e.target.closest('[data-node]');drag={id:node?.dataset.node,x:e.clientX,y:e.clientY,moved:false,held:false};
  if(pointers.size===1&&node&&media&&!selecting&&e.target.closest('[data-resize]')){drag.resize={w:node.offsetWidth,h:node.offsetHeight};node.classList.add('is-resizing');return;}
  if(pointers.size===2){const [a,b]=[...pointers.values()];drag={pinch:Math.hypot(a.x-b.x,a.y-b.y),moved:true};return;}
  if(drag.id)holdTimer=setTimeout(()=>{if(!drag?.id||drag.moved||pointers.size!==1)return;drag.held=true;selecting=true;if(selected.size<100)selected.add(drag.id);skipOpenUntil=Date.now()+800;render();},500);
 });
 // 포인터 이동은 1초에 수백 번 올 수 있어, 화면 반영은 한 프레임에 한 번만 한다.
 let frame=0,frameJob=null;const paint=job=>{frameJob=job;if(!frame)frame=requestAnimationFrame(()=>{frame=0;const run=frameJob;frameJob=null;run?.();});};
 board.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId)||!drag)return;const old=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2){clearTimeout(holdTimer);const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(drag.pinch)zoom(scale*distance/drag.pinch);drag.pinch=distance;return;}
  if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>6){drag.moved=true;clearTimeout(holdTimer);}
  if(drag.resize){const n=items.find(n=>n.id===drag.id),card=nodes.querySelector(`[data-node="${drag.id}"]`);if(!n||!card)return;n.width=clampSize(drag.resize.w+(e.clientX-drag.x)/scale,MIN_W,MAX_W);n.height=clampSize(drag.resize.h+(e.clientY-drag.y)/scale,MIN_H,MAX_H);card.style.width=n.width+'px';card.style.height=n.height+'px';card.classList.add('is-sized');lines();return;}
  if(drag.held||selecting&&drag.id)return;
  const dx=e.clientX-old.x,dy=e.clientY-old.y;if(drag.id){const n=drag.node||(drag.node=items.find(n=>n.id===drag.id));if(!n)return;n.x=Math.max(-100000,Math.min(100000,n.x+dx/scale));n.y=Math.max(-100000,Math.min(100000,n.y+dy/scale));drag.card??=nodes.querySelector(`[data-node="${CSS.escape(n.id)}"]`);paint(()=>{if(!drag.card)return;drag.card.style.left=n.x+'px';drag.card.style.top=n.y+'px';lines();});}else{tx+=dx;ty+=dy;paint(transform);}
 });
 function release(e){if(frame){cancelAnimationFrame(frame);frame=0;const run=frameJob;frameJob=null;run?.();}clearTimeout(holdTimer);if(drag)skipOpenUntil=Date.now()+500;if(drag?.resize){const n=items.find(n=>n.id===drag.id);nodes.querySelector(`[data-node="${drag.id}"]`)?.classList.remove('is-resizing');if(n&&drag.moved)queue(n);pointers.delete(e.pointerId);drag=null;return;}if(drag?.id){const n=items.find(n=>n.id===drag.id);if(n&&drag.moved&&!selecting)queue(n);if(n&&!drag.moved&&!drag.held&&e.type==='pointerup'){if(selecting)toggle(n.id);else showDetail(n);}}pointers.delete(e.pointerId);drag=null;}
 board.addEventListener('pointerup',release);board.addEventListener('pointercancel',release);
 nodes.onkeydown=e=>{const card=e.target.closest('[data-node]');if(!card||e.target.tagName!=='HEADER')return;const n=items.find(i=>i.id===card.dataset.node),direction={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];if(e.key==='Enter'||e.key===' '){e.preventDefault();if(e.shiftKey||selecting){toggle(n.id);nodes.querySelector(`[data-node="${n.id}"] header`)?.focus();}else showDetail(n);}if(direction&&!selecting&&e.altKey&&media){e.preventDefault();const card=nodes.querySelector(`[data-node="${n.id}"]`);n.width=clampSize((n.width||card.offsetWidth)+direction[0],MIN_W,MAX_W);n.height=clampSize((n.height||card.offsetHeight)+direction[1],MIN_H,MAX_H);queue(n);render();nodes.querySelector(`[data-node="${n.id}"] header`).focus();return;}
  if(direction&&!selecting){e.preventDefault();n.x+=direction[0];n.y+=direction[1];queue(n);render();nodes.querySelector(`[data-node="${n.id}"] header`).focus();}};
 board.addEventListener('keydown',e=>{if(e.target===board&&['+','=','-'].includes(e.key)){e.preventDefault();zoom(scale*(e.key==='-'?1/1.2:1.2));}});
 $('board-add').onclick=()=>edit();$('board-photo-add').onclick=()=>edit(null,true);$('board-fit').onclick=fit;$('board-nav-button').onclick=show;
 window.addEventListener('show-notes',hide);for(const id of ['category-nav','checklist-nav-button','specs-nav-button'])$(id).addEventListener('click',hide);
 window.addEventListener('access-change',()=>{$('board-nav-button').hidden=!admin();if(!admin()){epoch++;items=[];artboards=[];loaded=false;pending.clear();resetSelection();editor.close();detail.close();artEditor.close();confirmDialog.close();hide();render();renderArtboards();}});
 $('board-nav-button').hidden=!admin();renderArtboards();window.addEventListener('beforeunload',e=>{if(pending.size){e.preventDefault();e.returnValue='';}});
})();
