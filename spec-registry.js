(function () {
  'use strict';
  const $=id=>document.getElementById(id),api=window.ZIP_API;
  const admin=()=>window.CHAE_AUTH?.user?.status==='approved'&&window.CHAE_AUTH.user.role==='admin';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tabs=['map','sites','numbers','samples'],pencil='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm9.5-13.5 4 4"/></svg>';
  const clipboardIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="6" width="12" height="15" rx="2"/><path d="M16 6V3H4v14h4"/></svg>';
  let searchCache={},searchTimer=0,categoryFilter='',active='map',data=null,loading=false,saving=false,epoch=0,revision=0,page=1,sortColumn=-1,sortDirection=1,editing,loadedAt=0,forceQueued=false;
  const editor=document.createElement('dialog');editor.id='registry-editor';editor.className='board-editor registry-editor';editor.setAttribute('aria-labelledby','registry-editor-title');
  editor.innerHTML='<h2 id="registry-editor-title"></h2><form><div data-fields class="registry-fields"></div><p data-message role="status"></p><footer><button type="button" class="install-button" data-remove>삭제</button><button type="button" class="install-button" data-cancel>취소</button><button type="submit" class="install-button">시트에 저장</button></footer></form>';document.body.append(editor);
  const form=editor.querySelector('form');
  const detail=document.createElement('dialog');detail.className='specs-dialog registry-detail';detail.setAttribute('aria-labelledby','registry-detail-title');document.body.append(detail);
  // 팝업 바깥(어두운 배경)을 누르면 닫는다.
  detail.addEventListener('click',e=>{if(e.target!==detail)return;const r=detail.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)detail.close();});
  const collator=new Intl.Collator('ko',{numeric:true});
  const fold=v=>String(v??'').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g,'');
  // Photos taken in the app are private Drive files; they are fetched through the admin API instead of a public URL.
  const driveId=url=>(String(url).match(/^https:\/\/drive\.google\.com\/file\/d\/([-\w]{10,200})(?:\/|$)/)||[])[1]||'';
  function setImage(image,url){
    // 공개된 Drive 미리보기(효산 종이 이미지)는 서버를 거치지 않고 브라우저가 바로 받는다. 안 열리면 서버로 다시 받는다.
    const thumb=(String(url).match(/^https:\/\/drive\.google\.com\/thumbnail\?id=([-\w]{10,200})(?:&|$)/)||[])[1];
    if(thumb){const probe=new Image();probe.referrerPolicy='no-referrer';probe.onload=()=>{image.referrerPolicy='no-referrer';image.src=url;};probe.onerror=()=>setImage(image,`https://drive.google.com/file/d/${thumb}/view`);probe.src=url;return;}
    const id=driveId(url);if(!id){image.src=url;return;}api.image(id,{action:'registryImage'}).then(src=>{if(src)image.src=src;else image.dispatchEvent(new Event('error'));}).catch(()=>image.dispatchEvent(new Event('error')));}
  async function resizePhoto(file){
    if(!/^image\//.test(file.type)||file.size>25*1024*1024)throw Error('사진 파일은 장당 25MB까지 올릴 수 있어요.');
    const url=URL.createObjectURL(file);
    try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.84));if(!blob)throw Error('사진을 처리하지 못했어요.');
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
      return {blob,payload:{name:(file.name||'사진').replace(/\.[^.]+$/,'')+'.jpg',mime:'image/jpeg',base64}};
    }catch(error){throw error.message?.includes('사진')?error:Error('이 사진 형식은 열 수 없어요. JPG·PNG로 다시 시도해 주세요.');}finally{URL.revokeObjectURL(url);}
  }
  let uploading=0;
  // '스펙번호 규칙' table typed next to the list in the sheet (e.g. 우드 | HS20-HS49).
  const guideBox=document.createElement('section');guideBox.className='registry-guide';guideBox.setAttribute('aria-label','스펙번호 분류');guideBox.hidden=true;
  $('spec-registry-panel').querySelector('.registry-summary').after(guideBox);
  guideBox.addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(!b)return;categoryFilter=categoryFilter===b.dataset.category?'':b.dataset.category;page=1;render();guideBox.querySelector(`[data-category="${CSS.escape(categoryFilter||b.dataset.category)}"]`)?.focus();});
  // 규칙 표는 동기화 때만 바뀌므로 한 번만 해석해 두고, 행마다 다시 정규식을 돌리지 않는다.
  let guideCache=null,guideSource=null;
  function guideRanges(){const source=data?.guide||[];if(source===guideSource)return guideCache;guideSource=source;return guideCache=source.map(row=>{const cells=row.filter(Boolean),range=cells.map(v=>String(v).match(/^([A-Za-z]+)(\d+)\s*[-~–]\s*([A-Za-z]*)(\d+)$/)).find(Boolean);return range?{label:cells.filter(v=>!/^[A-Za-z]+\d+\s*[-~–]/.test(v)).join(' ')||cells[0],prefix:range[1].toUpperCase(),from:Number(range[2]),to:Number(range[4])}:null;}).filter(Boolean);}
  // 효산 LPM 시트의 ProductName / PreviousNames를 종이넘버로 찾는다(서버와 같은 키 규칙).
  function hyosanEntry(paper){const key=String(paper||'').normalize('NFKC').replace(/\s+/g,'').toUpperCase();return (key&&data?.hyosanNames?.[key])||null;}
  function productNames(paper){const e=hyosanEntry(paper);return e?[e[0]||'',e[1]||'']:['',''];}
  // 효산 시트 Category → 스펙번호 규칙 표의 분류 이름
  const CATEGORY_KO={SOLID:'단색',WOOD:'우드',STONE:'스톤',FABRIC:'패브릭',FANTASY:'추상'};
  function paperCategory(paper){return CATEGORY_KO[String(hyosanEntry(paper)?.[2]||'').toUpperCase()]||'';}
  // 다음 스펙넘버: 그 분류 범위(예: 우드 HS20~HS49)에서 마지막으로 쓴 번호 다음. CE99 다음은 HS를 하나 올려 CE01.
  function nextSpecNumber(label,exceptId){
    const range=guideRanges().find(r=>r.label===label);if(!range||!data)return '';let best=null;
    for(const r of data.lists.numbers.items){if(r.id===exceptId)continue;const m=String(r.values[1]||'').trim().toUpperCase().match(/^([A-Z]+)(\d+)-CE(\d+)$/);if(!m||m[1]!==range.prefix)continue;const hs=+m[2],ce=+m[3];if(hs<range.from||hs>range.to)continue;if(!best||hs>best[0]||hs===best[0]&&ce>best[1])best=[hs,ce];}
    let hs=best?best[0]:range.from,ce=best?best[1]+1:1;if(ce>99){hs++;ce=1;}if(hs>range.to)return '';
    return `${range.prefix}${String(hs).padStart(2,'0')}-CE${String(ce).padStart(2,'0')}`;
  }
  function duplicateOf(field,value,exceptId){const v=fold(value);return v&&data?data.lists.numbers.items.find(r=>r.id!==exceptId&&fold(r.values[field])===v)||null:null;}
  function specCategory(spec){const m=String(spec||'').trim().match(/^([A-Za-z]+)(\d+)/);if(!m)return '';const n=Number(m[2]);return guideRanges().find(r=>r.prefix===m[1].toUpperCase()&&n>=r.from&&n<=r.to)?.label||'';}
  function renderGuide(){const rows=(data?.guide||[]).filter(r=>r.some(Boolean));guideBox.hidden=active!=='numbers'||!rows.length;if(guideBox.hidden)return;// 분류 칩을 누르면 그 분류만 보이고, 한 번 더 누르면 전체로 돌아간다.
    const labelOf=r=>{const cells=r.filter(Boolean);return cells.some(v=>/^[A-Za-z]+\d+\s*[-~–]/.test(v))?cells.filter(v=>!/^[A-Za-z]+\d+\s*[-~–]/.test(v)).join(' ')||cells[0]:'';};
    if(categoryFilter&&!rows.some(r=>labelOf(r)===categoryFilter))categoryFilter='';
    const list='<ul>'+rows.map(r=>{const label=labelOf(r),inner=r.filter(Boolean).map((v,i)=>i?`<span>${esc(v)}</span>`:`<strong>${esc(v)}</strong>`).join('');return `<li>${label?`<button type="button" data-category="${esc(label)}" aria-pressed="${categoryFilter===label}">${inner}</button>`:inner}</li>`;}).join('')+'</ul>';
    guideBox.innerHTML='<h3>스펙번호</h3>'+list;}
  function parsePhotoUrls(value){const urls=String(value||'').split(/[\r\n]+/).map(v=>v.trim()).filter(Boolean);if(urls.length>12||urls.some(url=>url.length>2000||!/^https:\/\/[^\s<>"']+$/i.test(url)))throw Error('HTTPS 이미지 URL을 한 줄에 하나씩, 최대 12장 입력해 주세요.');return urls;}
  // 팝업 이미지가 여러 장이면 한 장씩 보여 주고 ‹ › 버튼·키보드 ←→·손가락 밀기로 넘긴다.
  function makeCarousel(container,label){
    const figures=[...container.querySelectorAll(':scope > figure')];if(figures.length<2)return;
    container.classList.add('registry-carousel');let index=0;
    const prev=Object.assign(document.createElement('button'),{type:'button',className:'registry-carousel-nav prev',innerHTML:'<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'});prev.setAttribute('aria-label','이전 이미지');
    const next=Object.assign(document.createElement('button'),{type:'button',className:'registry-carousel-nav next',innerHTML:'<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'});next.setAttribute('aria-label','다음 이미지');
    const count=Object.assign(document.createElement('span'),{className:'registry-carousel-count'});count.setAttribute('aria-live','polite');
    const show=i=>{index=(i+figures.length)%figures.length;figures.forEach((f,j)=>{f.hidden=j!==index;});count.textContent=`${index+1} / ${figures.length}`;const img=figures[index].querySelector('img');if(img)img.loading='eager';};
    prev.onclick=()=>show(index-1);next.onclick=()=>show(index+1);
    container.tabIndex=0;container.setAttribute('aria-label',`${label} ${figures.length}장 · 화살표로 넘기기`);
    container.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();show(index-1);}else if(e.key==='ArrowRight'){e.preventDefault();show(index+1);}});
    let startX=null;container.addEventListener('touchstart',e=>{startX=e.touches.length===1?e.touches[0].clientX:null;},{passive:true});
    container.addEventListener('touchend',e=>{if(startX==null)return;const dx=e.changedTouches[0].clientX-startX;startX=null;if(Math.abs(dx)>40)show(index+(dx<0?1:-1));});
    container.append(prev,next,count);show(0);
  }
  function renderPhotos(container,urls,label='현장 이미지'){
    container.classList.remove('registry-carousel');container.removeAttribute('tabindex');
    container.replaceChildren();if(!urls.length){const empty=document.createElement('p');empty.className='registry-photo-empty';empty.textContent='등록된 이미지가 없어요.';container.append(empty);return;}
    urls.forEach((url,index)=>{const figure=document.createElement('figure'),image=document.createElement('img');image.alt=`${label} ${index+1}`;image.loading=index?'lazy':'eager';image.decoding='async';image.referrerPolicy='no-referrer';image.onerror=()=>{const error=document.createElement('p');error.className='registry-photo-error';error.textContent=`이미지 ${index+1}을 불러올 수 없어요. 이미지 주소와 공유 권한을 확인해 주세요.`;figure.replaceChildren(error);};figure.append(image);container.append(figure);setImage(image,url);});
    if(urls.length>1)makeCarousel(container,label);
  }
  // 팝업에 보이는 그대로(4:5, 가장자리 6% 확대 크롭) 잘라 JPG로 만든다. 세로로 긴 사진은 위아래가 같이 잘린다.
  async function imageBlobFor(img,url){
    if(img?.src?.startsWith('blob:'))return (await fetch(img.src)).blob();
    const id=driveId(url)||(String(url).match(/^https:\/\/drive\.google\.com\/thumbnail\?id=([-\w]{10,200})(?:&|$)/)||[])[1];
    if(id){const src=await api.image(id,{action:'registryImage'});if(src)return (await fetch(src)).blob();}
    const response=await fetch(url,{mode:'cors',referrerPolicy:'no-referrer'});if(!response.ok)throw Error();return response.blob();
  }
  async function croppedPhoto(img,url,name){
    const source=await imageBlobFor(img,url),bitmap=await createImageBitmap(source).catch(async()=>{const u=URL.createObjectURL(source),el=new Image();el.src=u;try{await el.decode();return Object.assign(el,{width:el.naturalWidth,height:el.naturalHeight});}finally{setTimeout(()=>URL.revokeObjectURL(u),0);}}),zoom=1.06,ratio=4/5;
    let w=bitmap.width,h=bitmap.height;if(w/h>ratio)w=h*ratio;else h=w/ratio;w/=zoom;h/=zoom;
    const scale=Math.min(1,2000/Math.max(w,h)),canvas=document.createElement('canvas');canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,(bitmap.width-w)/2,(bitmap.height-h)/2,w,h,0,0,canvas.width,canvas.height);bitmap.close?.();
    const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.92));if(!blob)throw Error();return new File([blob],name,{type:'image/jpeg'});
  }
  function photoActions(detail,urls,baseName){
    if(!urls.length)return;const bar=document.createElement('div');bar.className='registry-photo-actions';
    const icon={share:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',save:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/></svg>'};
    bar.innerHTML=`<button type="button" data-photo-share aria-label="이미지 내보내기" title="이미지 내보내기">${icon.share}</button><button type="button" data-photo-save aria-label="이미지 저장하기" title="이미지 저장하기">${icon.save}</button><span role="status"></span>`;
    detail.querySelector('.registry-detail-fields').after(bar);const status=bar.querySelector('[role=status]');
    const current=async()=>{const figures=[...detail.querySelectorAll('.registry-photo-gallery > figure')],index=Math.max(0,figures.findIndex(f=>!f.hidden));const safe=String(baseName||'종이').replace(/[\\/:*?"<>|\s]+/g,'_');return croppedPhoto(figures[index]?.querySelector('img'),urls[index],`${safe}${urls.length>1?'_'+(index+1):''}.jpg`);};
    const run=async(button,share)=>{if(button.disabled)return;button.disabled=true;status.textContent='이미지를 준비하고 있어요…';
      try{const file=await current();
        if(share&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:file.name});}catch(e){if(e.name!=='AbortError')throw e;}status.textContent='';return;}
        const link=Object.assign(document.createElement('a'),{href:URL.createObjectURL(file),download:file.name});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),4000);
        status.textContent=share?'이 기기는 바로 공유가 안 돼서 저장했어요.':'저장했어요.';}
      catch{status.textContent='이 이미지는 내보낼 수 없어요. 원본 공유 권한을 확인해 주세요.';}
      finally{button.disabled=false;}};
    bar.querySelector('[data-photo-share]').onclick=e=>run(e.currentTarget,true);bar.querySelector('[data-photo-save]').onclick=e=>run(e.currentTarget,false);
  }
  function paperImageCell(item){const urls=(item.imageUrls||[]).filter(url=>/^https:\/\/[^\s<>"']+$/i.test(url));return `<td class="registry-image-column"><button type="button" class="registry-paper-preview${urls.length?'':' is-empty'}" data-paper-images="${esc(item.id)}" aria-label="${esc(item.values[0])} 종이 이미지 ${urls.length?'보기':'추가'}">${urls.length?`<img data-src="${esc(urls[0])}" alt="${esc(item.values[0])} 종이 미리보기" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="registry-paper-fallback" hidden>이미지 보기</span>`:'<span aria-hidden="true">＋</span>'}</button></td>`;}
  function normalizeNumbers(result){
    const list=result.lists.numbers;
    if(list.headers.length===4){result.legacyNumberColumns=true;list.headers=[list.headers[0],list.headers[1],list.headers[3]];list.items=list.items.map(item=>({...item,legacyMirror:item.values[2],values:[item.values[0],item.values[1],item.values[3]]}));}
    return result;
  }
  function numberWrite(item){return item.kind==='numbers'&&data.legacyNumberColumns?{...item,values:[item.values[0],item.values[1],item.legacyMirror||'',item.values[2]]}:item;}
  function selectTab(kind,focus=false){
    if(!tabs.includes(kind))return;detail.close();active=kind;page=1;categoryFilter='';sortColumn=-1;$('registry-search').value='';
    $('spec-tab-map').parentElement.style.setProperty('--active-tab',String(tabs.indexOf(kind)));
    tabs.forEach(k=>{const b=$('spec-tab-'+k);b.setAttribute('aria-selected',String(k===kind));b.tabIndex=k===kind?0:-1;});
    $('spec-map-panel').hidden=kind!=='map';$('spec-registry-panel').hidden=kind==='map'||kind==='samples';$('spec-samples-panel').hidden=kind!=='samples';
    $('spec-registry-panel').setAttribute('aria-labelledby','spec-tab-'+kind);
    if(focus)$('spec-tab-'+kind).focus();
    if(kind==='map'){window.dispatchEvent(new Event('spec-map-visible'));return;}
    if(kind==='samples'){window.dispatchEvent(new Event('spec-samples-visible'));return;}   // 샘플북은 samples.js가 맡는다
    $('registry-search').placeholder=kind==='numbers'?'종이넘버, 스펙넘버, 분류, 제품명, 비고':'현장명, 종이넘버, 스펙넘버, 경면, 설계사';
    $('registry-add').textContent=kind==='numbers'?'＋ 스펙 추가':'＋ 현장 내역';render();refresh();
  }
  tabs.forEach(kind=>{const b=$('spec-tab-'+kind);b.onclick=()=>selectTab(kind);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=tabs.indexOf(active);selectTab(e.key==='Home'?tabs[0]:e.key==='End'?tabs[tabs.length-1]:tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length],true);};});
  function rows(){
    if(!data||!data.lists[active])return [];const result=data.lists[active].items.map(item=>({...item,kind:active}));
    if(active==='sites'&&!data.unifiedSites)for(const item of data.mapItems||[])for(const paper of item.papers||[]){result.push({id:'map-'+item.id+'-'+result.length,source:item,values:[item.name,paper.number||'',paper.spec||'',paper.mirror||'',item.openMonth||'',item.completionMonth||'',item.designer||'','',paper.area||''],kind:'sites'});}
    return result;
  }
  function render(){
    const table=$('registry-table'),pager=$('registry-pagination'),sites=$('registry-site-list');$('registry-add').disabled=!data||loading||saving;
    sites.hidden=active!=='sites';table.parentElement.hidden=active==='sites';
    if(!data||!data.lists[active]){guideBox.hidden=true;sites.replaceChildren();table.querySelector('thead').replaceChildren();table.querySelector('tbody').replaceChildren();pager.hidden=true;return;}
    renderGuide();const listHeaders=data.lists[active].headers,headers=active==='numbers'?[listHeaders[0],listHeaders[1],'분류','제품명','이전 제품명',...listHeaders.slice(2)]:listHeaders,query=fold($('registry-search').value);
    // 스펙목록은 스펙넘버로 '스펙번호 규칙' 표에서 분류(우드 등)를 찾아 스펙넘버 옆 칸에 자동으로 보여 준다.
    // 모바일 스펙 목록은 세로 공간이 좁아 분류·비고 칸을 숨긴다(팝업에서는 모두 보인다).
    const mobileHidden=h=>active==='numbers'&&(h==='분류'||h==='비고');
    const cols=r=>active==='numbers'?[r.values[0],r.values[1],specCategory(r.values[1]),...productNames(r.values[0]),...r.values.slice(2)]:r.values;
    // 행마다 검색용 글자를 매번 다시 만들지 않고, 데이터가 바뀔 때까지 기억해 둔다.
    if(searchCache.data!==data||searchCache.kind!==active)searchCache={data,kind:active,text:new Map()};const textOf=r=>{let t=searchCache.text.get(r.id);if(t===undefined)searchCache.text.set(r.id,t=fold(cols(r).join(' ')));return t;};
    let filtered=rows().filter(r=>(!query||textOf(r).includes(query))&&(active!=='numbers'||!categoryFilter||specCategory(r.values[1])===categoryFilter));
    if(sortColumn>=0){const keyed=filtered.map(r=>[String(cols(r)[sortColumn]),r]);keyed.sort((a,b)=>sortDirection*collator.compare(a[0],b[0]));filtered=keyed.map(k=>k[1]);}
    const pages=Math.max(1,Math.ceil(filtered.length/50));page=Math.min(page,pages);
    sites.innerHTML=active==='sites'?(filtered.length?filtered.slice((page-1)*50,page*50).map(r=>`<button type="button" class="registry-site-card" data-site-id="${esc(r.id)}" aria-label="${esc(r.values[0])} 현장 상세 보기"><strong>${esc(r.values[0])}</strong><span aria-hidden="true">›</span></button>`).join(''):`<p class="registry-empty">${query?'검색 결과가 없어요.':'등록된 현장이 없어요.'}</p>`):'';
    table.querySelector('thead').innerHTML='<tr>'+(active==='numbers'?'<th scope="col" class="registry-image-column">이미지</th>':'')+headers.map((h,i)=>`<th scope="col"${mobileHidden(h)?' class="registry-col-desktop"':''} aria-sort="${sortColumn===i?(sortDirection===1?'ascending':'descending'):'none'}"><button type="button" data-sort="${i}">${esc(h)}${sortColumn===i?(sortDirection===1?' ↑':' ↓'):''}</button></th>`).join('')+'</tr>';
    table.querySelector('tbody').innerHTML=filtered.length?filtered.slice((page-1)*50,page*50).map(r=>`<tr class="registry-row" data-row-id="${esc(r.id)}" tabindex="0" aria-label="${esc(r.values[0])} 상세 보기">`+(active==='numbers'?paperImageCell(r):'')+cols(r).map((v,i)=>`<td${mobileHidden(headers[i])?' class="registry-col-desktop"':''}>${v&&i===(active==='numbers'?0:1)?`<span class="registry-paper-number"><span>${esc(v)}</span><button type="button" class="registry-copy" data-copy="${esc(v)}" aria-label="종이넘버 ${esc(v)} 복사" title="종이넘버 복사">${clipboardIcon}</button></span>`:(v?`<span class="registry-cell-text">${esc(v)}</span>`:'<span class="registry-blank">—</span>')}</td>`).join('')+'</tr>').join(''):`<tr><td colspan="${headers.length+(active==='numbers'?1:0)}" class="registry-empty">${query?'검색 결과가 없어요.':'등록된 내역이 없어요. 추가 버튼으로 첫 내역을 작성하세요.'}</td></tr>`;
    table.querySelectorAll('.registry-paper-preview img').forEach(image=>{image.onerror=()=>{image.hidden=true;image.parentElement.querySelector('.registry-paper-fallback').hidden=false;};setImage(image,image.dataset.src);});
    $('registry-count').textContent=`${filtered.length}개${query||(categoryFilter&&active==='numbers')?' 검색됨':''}`;pager.hidden=pages<=1;
    pager.innerHTML=`<button type="button" data-page="${page-1}" ${page===1?'disabled':''}>이전</button><span>${page} / ${pages}</span><button type="button" data-page="${page+1}" ${page===pages?'disabled':''}>다음</button>`;
  }
  async function refresh(force=false){
    if(!admin()||saving)return;if(loading){if(force)forceQueued=true;return;}if(data&&!force&&Date.now()-loadedAt<30000)return;
    if(!data){const cached=api.cached?.('specRegistry');if(cached)applyResult(cached);}
    loading=true;render();$('registry-sync').disabled=true;$('registry-message').textContent='시트에서 목록을 불러오는 중…';const access=epoch,start=revision;
    try{const result=await api.request('specRegistry',{force});if(access!==epoch||start!==revision)return;applyResult(result);$('registry-message').textContent='';}
    catch(error){if(access===epoch)$('registry-message').textContent=error.message;}
    finally{loading=false;$('registry-sync').disabled=false;render();if(forceQueued){forceQueued=false;refresh(true);}}
  }
  function applyResult(result){if(!admin()||saving)return;data=normalizeNumbers(structuredClone(result));if(!result.clientSnapshot)loadedAt=Date.now();if(Array.isArray(result.mapItems))window.dispatchEvent(new CustomEvent('spec-map-data',{detail:result.mapItems}));render();$('registry-synced').textContent=(result.clientSnapshot?'저장된 자료 · ':'최근 동기화 ')+new Date(result.syncedAt).toLocaleString('ko-KR');}
  window.addEventListener('spec-registry-data',event=>applyResult(event.detail));
  window.addEventListener('spec-registry-refresh',()=>refresh(true));
  window.addEventListener('spec-registry-invalidated',()=>{revision++;loadedAt=0;});
  function showSite(item){
    if(!admin()||!item)return;const mapped=item.source||data.mapItems?.find(row=>row.id===item.id),urls=(item.imageUrls||mapped?.imageUrls||[]).filter(url=>/^https:\/\/[^\s<>"']+$/i.test(url)),fields=data.lists.sites.headers.slice(1).map((label,i)=>[label,item.values[i+1]]);
    if(mapped)fields.push(['주소',mapped.address],['담당자',mapped.contact],['건설사',mapped.builder]);
    detail.innerHTML=`<header class="registry-detail-heading"><h2 id="registry-detail-title">${esc(item.values[0])}</h2><div><button type="button" class="registry-detail-edit" aria-label="현장 수정">${pencil}</button><button type="button" data-detail-close aria-label="닫기">×</button></div></header><section aria-label="현장 이미지"><div class="registry-photo-heading"><h3>이미지</h3></div><div class="registry-photo-gallery"></div></section><dl class="registry-detail-fields">${fields.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)||'<span class="registry-blank">미입력</span>'}${label==='종이넘버'&&value?` <button type="button" class="registry-copy" data-copy="${esc(value)}" aria-label="종이넘버 복사">${clipboardIcon}</button>`:''}</dd>`).join('')}</dl>`;
    renderPhotos(detail.querySelector('.registry-photo-gallery'),urls);
    detail.querySelector('[data-detail-close]').onclick=()=>detail.close();detail.querySelector('.registry-detail-edit').onclick=()=>{detail.close();edit(item);};detail.querySelector('[data-copy]')?.addEventListener('click',event=>copyPaperNumber(event.currentTarget));detail.showModal();
  }
  $('registry-site-list').onclick=event=>{const button=event.target.closest('[data-site-id]');if(button)showSite(rows().find(row=>row.id===button.dataset.siteId));};
  function showPaperImages(item){
    if(!admin()||!item)return;const urls=(item.imageUrls||[]).filter(url=>/^https:\/\/[^\s<>"']+$/i.test(url));
    detail.innerHTML=`<header class="registry-detail-heading"><h2 id="registry-detail-title">${esc(item.values[0])} · ${esc(item.values[1])}</h2><div><button type="button" class="registry-detail-edit" aria-label="스펙 수정">${pencil}</button><button type="button" data-detail-close aria-label="닫기">×</button></div></header><div class="registry-photo-heading"><h3>종이 이미지</h3></div><div class="registry-photo-gallery"></div><dl class="registry-detail-fields">${specCategory(item.values[1])?`<dt>분류</dt><dd>${esc(specCategory(item.values[1]))}</dd>`:''}${productNames(item.values[0]).map((v,i)=>v?`<dt>${i?'이전 제품명':'제품명'}</dt><dd>${esc(v)}</dd>`:'').join('')}${data.lists.numbers.headers.map((label,i)=>`<dt>${esc(label)}</dt><dd>${esc(item.values[i])||'<span class="registry-blank">미입력</span>'}${i===0&&item.values[0]?` <button type="button" class="registry-copy" data-copy="${esc(item.values[0])}" aria-label="종이넘버 복사">${clipboardIcon}</button>`:''}</dd>`).join('')}</dl>`;
    renderPhotos(detail.querySelector('.registry-photo-gallery'),urls,'종이 이미지');photoActions(detail,urls,item.values[0]);detail.querySelector('[data-detail-close]').onclick=()=>detail.close();const openEditor=()=>{detail.close();edit(item);editor.querySelector('[data-photo-source]')?.focus();};detail.querySelector('.registry-detail-edit').onclick=openEditor;detail.querySelector('[data-copy]')?.addEventListener('click',event=>copyPaperNumber(event.currentTarget));detail.showModal();
  }
  function edit(item){
    if(!admin()||saving||!data)return;
    if(item?.source){selectTab('map');window.dispatchEvent(new CustomEvent('spec-map-edit',{detail:item.source}));return;}
    const kind=active,mapped=item?.source||data.mapItems?.find(row=>row.id===item?.id);editing={kind,id:item?.id||crypto.randomUUID(),version:item?.version||'',legacyMirror:item?.legacyMirror||'',imageUrls:[...(item?.imageUrls||mapped?.imageUrls||[])],photoVersion:item?.photoVersion||mapped?.photoVersion||'',values:item?[...item.values]:Array(data.lists[kind].headers.length).fill('')};
    $('registry-editor-title').textContent=(kind==='numbers'?'스펙번호':'현장 내역')+(item?' 수정':' 추가');
    editor.querySelector('[data-fields]').innerHTML=data.lists[kind].headers.map((h,i)=>{
      const required=(kind==='numbers'?i<2:i===0)?' required':'';let input;
      if(kind==='sites'&&i===7&&data.statuses.length)input=`<select name="field-${i}"><option value="">선택 안 함</option>${[...new Set(data.statuses.concat(editing.values[i]||[]))].map(v=>`<option ${v===editing.values[i]?'selected':''}>${esc(v)}</option>`).join('')}</select>`;
      else if(h==='비고'||kind==='sites'&&[1,2,3].includes(i))input=`<textarea name="field-${i}" maxlength="4000"${kind==='sites'&&[1,2,3].includes(i)?' placeholder="여러 개는 줄바꿈 또는 쉼표로 구분"':''}>${esc(editing.values[i])}</textarea>`;
      else input=`<input name="field-${i}" value="${esc(editing.values[i])}" maxlength="${i<2?300:4000}"${required}${/예정일/.test(h)?' placeholder="예: 2027-03 또는 2027-03-15"':''}>`;
      return `<label>${esc(h)}${required?' *':''}${input}</label>`;
    }).join('');editor.querySelector('[data-remove]').hidden=!item;editor.querySelector('[data-message]').textContent='';
    {
      const photos=document.createElement('section');photos.className='registry-photo-editor';const label=kind==='numbers'?'종이 이미지':'현장 이미지',external=editing.imageUrls.some(url=>!driveId(url));
      photos.innerHTML=`<p class="registry-photo-title">${label} <span>(최대 12장)</span></p><div class="registry-photo-sources" role="group" aria-label="${label} 추가 방법"><button type="button" class="install-button" data-photo-source="camera">📷 촬영하기</button><button type="button" class="install-button" data-photo-source="gallery">🖼 사진첩</button><button type="button" class="install-button" data-photo-source="url" aria-expanded="${external}">🔗 URL 입력</button></div><input type="file" accept="image/*" capture="environment" data-photo-camera hidden><input type="file" accept="image/*" multiple data-photo-gallery hidden><label data-photo-url-field ${external?'':'hidden'}>이미지 URL <span>(한 줄에 하나씩)</span><textarea name="photo-urls" rows="3" placeholder="https://example.com/image1.jpg">${esc(editing.imageUrls.join('\n'))}</textarea></label><div class="registry-photo-preview" aria-label="이미지 미리보기"></div>`;editor.querySelector('[data-fields]').append(photos);
      const area=photos.querySelector('textarea'),box=photos.querySelector('.registry-photo-preview'),message=()=>editor.querySelector('[data-message]');
      const lines=()=>area.value.split(/[\r\n]+/).map(v=>v.trim()).filter(Boolean);
      const preview=()=>{try{const urls=parsePhotoUrls(area.value);box.replaceChildren();urls.forEach((url,index)=>{const figure=document.createElement('figure'),image=document.createElement('img'),remove=document.createElement('button');image.alt=`${label} ${index+1}`;image.decoding='async';image.referrerPolicy='no-referrer';image.onerror=()=>{image.replaceWith(Object.assign(document.createElement('p'),{className:'registry-photo-error',textContent:'불러올 수 없는 이미지'}));};remove.type='button';remove.className='registry-photo-remove';remove.textContent='×';remove.setAttribute('aria-label',`${label} ${index+1} 빼기`);remove.onclick=()=>{const next=lines();next.splice(index,1);area.value=next.join('\n');preview();};figure.append(image,remove);box.append(figure);setImage(image,url);});if(!urls.length)box.append(Object.assign(document.createElement('p'),{className:'registry-photo-empty',textContent:'아직 추가한 이미지가 없어요.'}));if(!uploading)message().textContent='';}catch(error){message().textContent=error.message;}};
      area.oninput=preview;preview();
      const upload=async files=>{
        files=[...files].filter(Boolean);if(!files.length)return;const room=12-lines().length;if(room<=0){message().textContent='이미지는 최대 12장까지 추가할 수 있어요.';return;}
        if(files.length>room){files=files.slice(0,room);message().textContent=`최대 12장이라 ${room}장만 올려요.`;}
        const access=epoch;uploading++;form.querySelector('button[type="submit"]').disabled=true;let done=0;
        // 사진은 3장씩 동시에 올리고, 끝난 것부터 고른 순서대로 붙인다.
        const results=[],queue=files.map((file,index)=>({file,index}));let next=0,stale=false;const live=()=>!stale&&access===epoch&&editor.open;
        const flushReady=()=>{const ready=[];while(results[next]){ready.push(`https://drive.google.com/file/d/${results[next]}/view`);next++;}if(ready.length){area.value=[...lines(),...ready].join('\n');preview();}};
        const worker=async()=>{while(queue.length){const {file,index}=queue.shift();const {blob,payload}=await resizePhoto(file);const result=await api.request('uploadNoteImage',payload);if(!live()){stale=true;return;}api.seedImage?.(result.fileId,blob,'registryImage');results[index]=result.fileId;done++;message().textContent=`사진을 올리고 있어요 (${done}/${files.length})…`;flushReady();}};
        try{message().textContent=`사진을 올리고 있어요 (0/${files.length})…`;const failed=(await Promise.allSettled([worker(),worker(),worker()])).find(r=>r.status==='rejected');if(stale)return;if(failed)throw failed.reason;
          message().textContent=`사진 ${done}장을 추가했어요. 시트에 저장을 눌러 주세요.`;}
        catch(error){message().textContent=(done?`${done}장은 추가했어요. `:'')+(error.message||'사진을 올리지 못했어요.');}
        finally{uploading--;if(!uploading)form.querySelector('button[type="submit"]').disabled=false;}
      };
      const camera=photos.querySelector('[data-photo-camera]'),gallery=photos.querySelector('[data-photo-gallery]');
      camera.onchange=()=>{upload(camera.files);camera.value='';};gallery.onchange=()=>{upload(gallery.files);gallery.value='';};
      photos.querySelector('.registry-photo-sources').onclick=event=>{const button=event.target.closest('[data-photo-source]');if(!button||uploading)return;const source=button.dataset.photoSource;
        if(source==='camera')camera.click();else if(source==='gallery')gallery.click();else{const field=photos.querySelector('[data-photo-url-field]');field.hidden=false;button.setAttribute('aria-expanded','true');area.focus();}};
    }
    if(kind==='numbers'){
      const spec=form.elements['field-1'],cat=Object.assign(document.createElement('label'),{className:'registry-category-field'});cat.innerHTML='분류<output aria-live="polite"></output>';spec.closest('label').after(cat);
      const show=()=>{const v=specCategory(spec.value);cat.querySelector('output').innerHTML=v?esc(v):'<span class="registry-blank">스펙넘버를 입력하면 자동으로 채워져요</span>';};spec.addEventListener('input',show);show();
      // 자동 부여: 분류 버튼을 누르면 그 분류의 다음 번호가 들어간다. 종이넘버가 효산 시트에 있으면 종류에 맞춰 바로 채운다.
      const assist=Object.assign(document.createElement('div'),{className:'spec-assist'});spec.closest('label').after(assist);
      const paperInput=form.elements['field-0'];let autoFilled=false;
      const warn=()=>{const lines=[],ds=duplicateOf(1,spec.value,editing.id),dp=duplicateOf(0,paperInput.value,editing.id);
        if(ds)lines.push(`스펙넘버 <b>${esc(spec.value.trim())}</b>는 이미 <b>${esc(ds.values[0])}</b>에 쓰였어요.`);
        if(dp)lines.push(`종이넘버 <b>${esc(paperInput.value.trim())}</b>는 이미 <b>${esc(dp.values[1])}</b>로 등록돼 있어요.`);
        assist.querySelector('[data-warn]').innerHTML=lines.join('<br>');assist.querySelector('[data-warn]').hidden=!lines.length;};
      const drawAssist=()=>{const kind=paperCategory(paperInput.value);
        assist.innerHTML=`<p class="spec-assist-title">자동 부여${kind?` · 종이넘버 종류: <b>${esc(kind)}</b>`:''}</p><div class="spec-assist-chips">${guideRanges().map(r=>{const next=nextSpecNumber(r.label,editing.id);return `<button type="button" data-next="${esc(next)}" ${next?'':'disabled'} class="${r.label===kind?'is-match':''}"><b>${esc(r.label)}</b><span>${esc(next||'번호 없음')}</span></button>`;}).join('')}</div><p class="spec-assist-warn" data-warn hidden></p>`;warn();};
      assist.addEventListener('click',e=>{const b=e.target.closest('[data-next]');if(!b||!b.dataset.next)return;spec.value=b.dataset.next;autoFilled=true;spec.dispatchEvent(new Event('input',{bubbles:true}));});
      spec.addEventListener('input',e=>{if(e.isTrusted)autoFilled=false;warn();});
      paperInput.addEventListener('input',()=>{drawAssist();const kind=paperCategory(paperInput.value),next=kind&&nextSpecNumber(kind,editing.id);
        if(next&&(!spec.value.trim()||autoFilled)){spec.value=next;autoFilled=true;spec.dispatchEvent(new Event('input',{bubbles:true}));}});
      drawAssist();
      // 종이넘버를 입력하면 효산 시트의 제품명(현재·이전)이 자동으로 보인다.
      const paper=form.elements['field-0'],names=['제품명','이전 제품명'].map(label=>{const f=Object.assign(document.createElement('label'),{className:'registry-category-field'});f.innerHTML=esc(label)+'<output aria-live="polite"></output>';return f;});cat.after(...names);
      const showNames=()=>{const found=productNames(paper.value),known=found.some(Boolean);names.forEach((f,i)=>{f.querySelector('output').innerHTML=found[i]?esc(found[i]):`<span class="registry-blank">${known?'—':paper.value.trim()?'효산 시트에 없는 종이넘버예요':'종이넘버를 입력하면 자동으로 채워져요'}</span>`;});};paper.addEventListener('input',showNames);showNames();
    }
    if(kind==='sites'){
      const options=document.createElement('div');options.className='registry-match-options';options.setAttribute('aria-label','일치하는 스펙 선택');editor.querySelector('[data-fields]').after(options);editor.querySelectorAll('.registry-match-options').forEach((v,i)=>{if(v!==options)v.remove();});
      const apply=row=>{form.elements['field-1'].value=row.values[0];form.elements['field-2'].value=row.values[1];options.replaceChildren();editor.querySelector('[data-message]').textContent='종이넘버와 스펙넘버를 함께 입력했어요.';};
      [1,2].forEach(index=>{const input=form.elements['field-'+index];input.onchange=()=>{
        options.replaceChildren();const query=fold(input.value);if(!query)return;
        const tokens=input.value.split(/[,\n\r]+/).map(v=>v.trim()).filter(Boolean);
        if(tokens.length>1){const pairs=tokens.map(token=>[...new Map(data.lists.numbers.items.filter(r=>fold(r.values[index-1])===fold(token)).map(r=>[JSON.stringify(r.values.slice(0,2)),r])).values()]);if(pairs.every(p=>p.length===1)){form.elements['field-1'].value=pairs.map(p=>p[0].values[0]).join('\n');form.elements['field-2'].value=pairs.map(p=>p[0].values[1]).join('\n');editor.querySelector('[data-message]').textContent='입력 순서대로 번호를 연결했어요.';}else editor.querySelector('[data-message]').textContent='중복되거나 등록되지 않은 번호가 있어요. 각 번호의 연결을 확인해 주세요.';return;}
        const matches=data.lists.numbers.items.filter(r=>fold(r.values[index-1])===query),unique=[...new Map(matches.map(r=>[JSON.stringify(r.values.slice(0,2)),r])).values()];
        if(unique.length===1){apply(unique[0]);return;}
        editor.querySelector('[data-message]').textContent=unique.length?'같은 번호가 여러 개예요. 연결할 스펙을 선택해 주세요.':'등록된 번호가 없어요. 다른 번호를 직접 입력할 수 있어요.';
        unique.forEach(row=>{const b=document.createElement('button');b.type='button';b.className='install-button';b.textContent=row.values[0]+' → '+row.values[1];b.onclick=()=>apply(row);options.append(b);});
      };});
    }else editor.querySelector('.registry-match-options')?.remove();
    editor.showModal();
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(saving||uploading||!admin())return;const access=epoch,item={...editing,values:editing.values.map((_,i)=>form.elements['field-'+i].value.trim())};
    if(item.kind==='numbers'){const ds=duplicateOf(1,item.values[1],item.id),dp=duplicateOf(0,item.values[0],item.id);
      if(ds&&!window.confirm(`스펙넘버 ${item.values[1]}는 이미 ${ds.values[0]}에 쓰였어요. 그래도 저장할까요?`))return;
      if(dp&&!window.confirm(`종이넘버 ${item.values[0]}는 이미 ${dp.values[1]}로 등록돼 있어요. 그래도 저장할까요?`))return;}
    if(item.kind==='sites'&&!item.values[1]&&!item.values[2]){editor.querySelector('[data-message]').textContent='종이넘버 또는 스펙넘버를 입력해 주세요.';return;}
    if(item.kind==='sites'){const split=v=>v.split(/[,\n\r]+/).map(s=>s.trim()).filter(Boolean),a=split(item.values[1]),b=split(item.values[2]),m=split(item.values[3]);if(a.length&&b.length&&a.length!==b.length||m.length>1&&m.length!==Math.max(a.length,b.length)){editor.querySelector('[data-message]').textContent='종이넘버·스펙넘버·경면 개수를 순서대로 맞춰 주세요. 경면 1개는 모든 스펙에 공통 적용됩니다.';return;}}
    try{const urls=parsePhotoUrls(form.elements['photo-urls'].value),enabled=item.kind==='numbers'?data.paperPhotoUrls:data.registryPhotoUrls;if(!enabled&&JSON.stringify(urls)!==JSON.stringify(editing.imageUrls))throw Error('이미지 URL 저장 연결을 확인 중이에요. 잠시 후 목록을 동기화해 주세요.');if(enabled)item.imageUrls=urls;else {delete item.imageUrls;delete item.photoVersion;}}catch(error){editor.querySelector('[data-message]').textContent=error.message;return;}
    saving=true;editor.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);editor.querySelector('[data-message]').textContent='시트에 저장 중…';
    try{const result=await api.request('saveSpecRegistry',numberWrite(item));if(access!==epoch)return;revision++;let saved=result.item;if(item.kind==='numbers'&&data.legacyNumberColumns)saved={...saved,legacyMirror:saved.values[2],values:[saved.values[0],saved.values[1],saved.values[3]]};const list=data.lists[item.kind].items;const index=list.findIndex(r=>r.id===item.id);if(index<0)list.push(saved);else list[index]=saved;editor.close();$('registry-message').textContent='시트에 저장했어요.';render();}
    catch(error){if(access===epoch)editor.querySelector('[data-message]').textContent=error.message+' 입력 내용은 그대로 유지됩니다.';}
    finally{saving=false;editor.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=false);render();}
  };
  editor.querySelector('[data-cancel]').onclick=()=>{if(!saving)editor.close();};
  editor.querySelector('[data-remove]').onclick=async()=>{
    if(saving||!admin()||!confirm('이 내역을 시트에서도 삭제할까요? 삭제하면 되돌릴 수 없어요.'))return;
    saving=true;const access=epoch;editor.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await api.request('deleteSpecRegistry',editing);if(access!==epoch)return;revision++;data.lists[editing.kind].items=data.lists[editing.kind].items.filter(r=>r.id!==editing.id);editor.close();render();}
    catch(error){if(access===epoch)editor.querySelector('[data-message]').textContent=error.message;}
    finally{saving=false;editor.querySelectorAll('button').forEach(b=>b.disabled=false);render();}
  };
  $('registry-add').onclick=()=>edit();$('registry-sync').onclick=()=>refresh(true);
  $('registry-search').oninput=()=>{page=1;clearTimeout(searchTimer);searchTimer=setTimeout(render,120);};   // 빠르게 입력할 때 글자마다 표를 다시 그리지 않는다
  async function copyPaperNumber(button){
    if(button.disabled||!admin())return;const value=button.dataset.copy;if(!value)return;button.disabled=true;let field;
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
      else{field=document.createElement('textarea');field.value=value;field.setAttribute('readonly','');field.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(field);field.select();if(!document.execCommand('copy'))throw Error('Copy failed');}
      if(admin()){$('registry-message').textContent=`종이넘버 ${value} 복사했어요.`;button.dataset.copied='true';}
    }catch{if(admin())$('registry-message').textContent='복사하지 못했어요. 종이넘버를 길게 눌러 복사해 주세요.';}
    finally{field?.remove();button.disabled=false;button.focus();}
  }
  // Tapping anywhere on a row opens its detail popup; editing happens from the popup's pencil icon.
  const openRow=row=>{const item=rows().find(r=>r.id===row.dataset.rowId);if(!item)return;if(active==='numbers')showPaperImages(item);else edit(item);};
  $('registry-table').onkeydown=e=>{const row=e.target.closest?.('tr[data-row-id]');if(row&&e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openRow(row);}};
  $('registry-table').onclick=e=>{const b=e.target.closest('button');if(!b){const row=e.target.closest('tr[data-row-id]');if(row&&!getSelection()?.toString())openRow(row);return;}if(b.dataset.paperImages!==undefined){showPaperImages(rows().find(r=>r.id===b.dataset.paperImages));return;}if(b.dataset.copy!==undefined){copyPaperNumber(b);return;}if(b.dataset.sort!==undefined){const col=Number(b.dataset.sort);sortDirection=sortColumn===col?-sortDirection:1;sortColumn=col;render();}else if(b.dataset.id)edit(rows().find(r=>r.id===b.dataset.id));};
  $('registry-pagination').onclick=e=>{const b=e.target.closest('[data-page]');if(b&&!b.disabled){page=Number(b.dataset.page);render();}};
  $('specs-nav-button').addEventListener('click',()=>{if(active!=='map'&&active!=='samples')refresh();});
  window.addEventListener('access-change',()=>{if(!admin()){epoch++;revision++;data=null;loadedAt=0;forceQueued=false;editing=null;detail.close();detail.replaceChildren();editor.close();editor.querySelector('[data-fields]').replaceChildren();$('registry-synced').textContent='';$('registry-count').textContent='';$('registry-message').textContent='';render();selectTab('map');}});
  setInterval(()=>{if(!document.hidden&&!$('specs-view').hidden&&active!=='map'&&active!=='samples')refresh();},60000);
})();
