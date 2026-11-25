(function () {
  'use strict';
  const $ = id => document.getElementById(id), api = window.ZIP_API;
  const view = $('specs-view'), nav = $('specs-nav-button'), message = $('specs-message');
  let items = [], map, markers, picker, pickMarker, mapReady, loading, generation = 0, editing = null, location = null, saving = false;
  let retainedImages = [], uploadedImages = [], imageUrls = [], detailVersion = 0, searchVersion = 0, editorVersion = 0;
  let dataRevision = 0, page=1, siteSchemaVersion=0,loadedAt=0;
  const animateMap = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const overview = target => target?.fitBounds([[33.1,125.5],[38.6,130.0]],{padding:[24,24],animate:animateMap()});
  const admin = () => window.CHAE_AUTH?.user?.role === 'admin' && window.CHAE_AUTH?.user?.status === 'approved';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const editor = document.createElement('dialog');editor.className = 'specs-dialog';editor.id = 'specs-editor';
  editor.setAttribute('aria-labelledby','specs-editor-title');
  editor.innerHTML = `<h2 id="specs-editor-title">현장 등록</h2><form id="specs-form">
    <fieldset id="specs-fields"><div class="specs-grid">
    <label>현장명 *<input name="name" required maxlength="300"></label><label>현장 주소 *<input name="address" required maxlength="300"></label>
    <label>설계사<input name="designer" maxlength="300"></label><label>담당자<input name="contact" maxlength="300"></label><label>건설사<input name="builder" maxlength="300"></label>
    <label>모델하우스 예정일<input name="openMonth" maxlength="10" placeholder="2027-03 또는 2027-03-15"></label><label>본납 예정일<input name="completionMonth" maxlength="10" placeholder="2027-09 또는 2027-09-30"></label><label>진행상태<select name="status"><option value="">선택 안 함</option></select></label></div><label>비고<textarea name="note" rows="2" maxlength="4000"></textarea></label>
    <p class="specs-help">위치를 따로 고르지 않아도 저장할 때 주소로 자동으로 찾아 지도에 표시해요. 정확한 위치가 필요하면 주소로 찾기나 지도 클릭으로 바꿀 수 있어요. 담당자나 비공개 메모는 주소 칸에 넣지 마세요.</p>
    <button id="specs-locate" type="button">주소로 위치 찾기</button><div id="specs-candidates"></div>
    <p id="specs-location" role="status">지도에서 현장 위치를 선택해 주세요.</p><div id="specs-pick-map" class="specs-pick-map" aria-label="현장 위치 선택 지도"></div>
    <input name="lat" type="hidden"><input name="lng" type="hidden">
    <h3>종이 · 경면 · 구분 · 부위</h3><p class="specs-help">종이넘버, 제품명, 스펙넘버 중 하나만 넣으면 나머지가 채워져요. 쉼표나 줄바꿈으로 여러 개를 한 번에 넣으면 줄이 나뉘어요. 경면·구분·부위는 줄마다 따로예요.</p><div id="specs-papers"></div><button id="specs-paper-add" type="button">＋ 종이 추가</button>
    <label>사진 URL (한 줄에 하나씩 · 최대 12장)<textarea id="specs-photo-urls" rows="4" placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg"></textarea></label><div id="specs-url-preview" class="specs-photos"></div>
    <label hidden>기존 방식 사진 첨부<input id="specs-files" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div id="specs-retained"></div>
    </fieldset><p id="specs-save-message" role="status"></p><div class="specs-actions"><button id="specs-cancel" type="button">취소</button><button type="submit">시트에 저장</button></div></form>`;
  document.body.append(editor);
  editor.addEventListener('close',()=>{editorVersion++;searchVersion++;});
  const form = $('specs-form');
  const specLabel=p=>{const number=p.spec||p.number||'';return number+(p.mirror?'('+p.mirror+')':'');};
  const splitSpec=v=>String(v||'').split(/[,\n\r]+/).map(s=>s.trim()).filter(Boolean);
  function findNumberPairs(rows,index,value){const key=v=>String(v||'').normalize('NFKC').trim().toLowerCase();return splitSpec(value).map(token=>[...new Map(rows.filter(r=>key(r.values[index])===key(token)).map(r=>[JSON.stringify(r.values.slice(0,2)),r.values.slice(0,2)])).values()]);}
  function photoUrls(value){const urls=String(value||'').split(/[\r\n]+/).map(v=>v.trim()).filter(Boolean);if(urls.length>12||urls.some(u=>u.length>2000||!/^https:\/\/[^\s<>"']+$/i.test(u)))throw Error('사진은 HTTPS URL을 한 줄에 하나씩, 최대 12장 입력해 주세요.');return urls;}
  function urlImage(url,container){const image=document.createElement('img');image.alt='현장 사진';image.loading='lazy';image.referrerPolicy='no-referrer';image.onerror=()=>{image.replaceWith(Object.assign(document.createElement('span'),{textContent:'사진을 불러올 수 없어요. 직접 이미지 URL인지 확인해 주세요.'}));};container.append(image);
    const drive=(String(url).match(/^https:\/\/drive\.google\.com\/file\/d\/([-\w]{10,200})(?:\/|$)/)||[])[1];if(!drive){image.src=url;return;}
    api.image(drive,{action:'registryImage'}).then(src=>{if(src)image.src=src;else image.onerror();}).catch(()=>image.onerror());}
  $('specs-photo-urls').addEventListener('change',()=>{const box=$('specs-url-preview');box.replaceChildren();try{photoUrls($('specs-photo-urls').value).forEach(url=>urlImage(url,box));}catch(e){$('specs-save-message').textContent=e.message;}});
  const detail = document.createElement('dialog');detail.className = 'specs-dialog';detail.setAttribute('aria-label','현장 스펙 상세');document.body.append(detail);
  detail.addEventListener('click',e=>{if(e.target!==detail)return;const r=detail.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)detail.close();});
  function clearPhotos() { imageUrls.forEach(url => URL.revokeObjectURL(url));imageUrls=[]; }
  detail.addEventListener('close',()=>{detailVersion++;clearPhotos();detail.replaceChildren();});
  function loadMapLibrary() {
    if(window.L)return Promise.resolve();
    if(mapReady)return mapReady;
    mapReady = new Promise((resolve,reject)=>{
      const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.append(css);
      const script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      const timer=setTimeout(()=>{script.remove();reject(Error('지도를 불러오지 못했어요. 목록으로 확인하거나 새로고침해 주세요.'));},15000);
      script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('지도 연결을 확인해 주세요.'));};document.head.append(script);
    }).catch(error=>{mapReady=null;throw error;});return mapReady;
  }
  let geography;
  const cities = [
    ['서울',37.5665,126.978,7],['인천',37.456,126.705,8],['수원시',37.264,127.029,8],['춘천시',37.881,127.73,7],
    ['강릉시',37.752,128.876,7],['원주시',37.342,127.92,8],['속초시',38.207,128.591,8],['동해시',37.524,129.114,9],['화성시',37.199,126.831,8],['안산시',37.322,126.831,9],
    ['대전',36.35,127.385,7],['세종',36.48,127.289,9],['청주시',36.642,127.489,8],['충주시',36.991,127.926,8],
    ['천안시',36.815,127.114,8],['서산시',36.785,126.45,8],['공주시',36.446,127.119,9],['보령시',36.333,126.613,8],
    ['전주시',35.824,127.148,7],['군산시',35.967,126.736,8],['익산시',35.948,126.957,9],['남원시',35.416,127.39,8],
    ['광주',35.159,126.853,7],['목포시',34.811,126.392,7],['순천시',34.95,127.487,8],['여수시',34.761,127.662,8],
    ['대구',35.871,128.602,7],['안동시',36.568,128.729,7],['영주시',36.805,128.624,9],['문경시',36.586,128.187,9],
    ['상주시',36.411,128.159,8],['구미시',36.119,128.345,8],['김천시',36.139,128.113,9],['포항시',36.019,129.343,7],
    ['경주시',35.856,129.224,8],['울산',35.538,129.311,7],['부산',35.18,129.076,7],['창원시',35.228,128.681,8],
    ['밀양시',35.504,128.746,7],['김해시',35.228,128.889,9],['양산시',35.336,129.037,9],['진주시',35.18,128.108,8],
    ['통영시',34.854,128.433,8],['거제시',34.881,128.621,9],['사천시',35.003,128.064,9],
    ['제주시',33.5,126.531,7],['서귀포시',33.254,126.56,8],['평택시',36.992,127.112,9],['파주시',37.76,126.78,9],
    ['고양시',37.658,126.832,10],['의정부시',37.738,127.034,10],['성남시',37.42,127.126,10],
    ['용인시',37.241,127.178,9],['이천시',37.272,127.435,9],['여주시',37.298,127.638,9],['제천시',37.132,128.191,9]
  ];
  function pinIcon() { return L.divIcon({className:'specs-pin',html:'<span></span>',iconSize:[24,30],iconAnchor:[12,28],popupAnchor:[0,-28]}); }
  async function loadGeography() {
    if(!geography)geography=fetch('korea-map.json').then(r=>{if(!r.ok)throw Error('지도를 불러오지 못했어요.');return r.json();}).catch(e=>{geography=null;throw e;});return geography;
  }
  function makeMap(id, data) {
    const result=L.map(id,{minZoom:5,maxZoom:19,touchZoom:true,bounceAtZoomLimits:false,zoomSnap:0.25,zoomAnimation:animateMap(),fadeAnimation:animateMap()}).setView([36.0,127.8],7);
    result.zoomControl.setPosition('topright');
    result.zoomControl.getContainer().querySelector('.leaflet-control-zoom-in').setAttribute('aria-label','지도 확대');
    result.zoomControl.getContainer().querySelector('.leaflet-control-zoom-out').setAttribute('aria-label','지도 축소');
    L.geoJSON(data,{interactive:false,style:()=>({color:'#cfd5d8',weight:1,fillColor:'#fafbfc',fillOpacity:1})}).addTo(result);
    result.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>');
    const labels=L.layerGroup().addTo(result);
    const renderLabels=()=>{labels.clearLayers();const occupied=[];cities.forEach(([name,lat,lng,zoom])=>{
      if(result.getZoom()<zoom-1)return;
      const p=result.latLngToContainerPoint([lat,lng]);
      if(occupied.some(q=>Math.abs(q.x-p.x)<62&&Math.abs(q.y-p.y)<22))return;
      occupied.push(p);
      L.marker([lat,lng],{interactive:false,keyboard:false,icon:L.divIcon({className:'specs-city',html:escape(name),iconSize:[72,20],iconAnchor:[36,10]})}).addTo(labels);
    });};
    result.on('zoomend moveend resize',renderLabels);renderLabels();
    return result;
  }
  function filtered() {const q=$('specs-search').value.trim().toLowerCase();return items.filter(x=>!q||[x.name,x.address,x.designer,x.contact,x.builder,...x.papers.flatMap(p=>[p.number,p.area,p.spec,p.mirror])].join(' ').toLowerCase().includes(q));}
  function render() {
    const rows=filtered();
    page=Math.max(1,Math.min(page,Math.ceil(rows.length/20)||1));
    $('specs-list').innerHTML=rows.length?rows.slice((page-1)*20,page*20).map(x=>`<button type="button" data-spec-id="${escape(x.id)}"><strong><svg class="list-pin" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22S4 14 4 9a8 8 0 1 1 16 0c0 5-8 13-8 13Z"/><circle cx="12" cy="9" r="2.5" fill="white"/></svg> ${escape(x.name)}</strong><span>${escape(x.address)}</span><span>${escape(x.builder || '건설사 미입력')} · ${escape(x.papers.map(specLabel).join(', ')||'스펙 미입력')}</span><span>M/H ${escape(x.openMonth||'미정')} · 완공 ${escape(x.completionMonth||'미정')}</span></button>`).join(''):'<p>등록된 현장이 없거나 검색 결과가 없어요.</p>';
    const pagination=$('specs-pagination');pagination.hidden=rows.length<=20;pagination.innerHTML=`<button type="button" data-spec-page="${page-1}" ${page===1?'disabled':''}>이전</button><span>${page} / ${Math.ceil(rows.length/20)||1}</span><button type="button" data-spec-page="${page+1}" ${page*20>=rows.length?'disabled':''}>다음</button>`;
    if(!markers)return;markers.clearLayers();
    const groups=new Map();rows.forEach(x=>{if(!Number.isFinite(x.lat)||!Number.isFinite(x.lng)||x.lat<32||x.lat>39.5||x.lng<124||x.lng>132.5)return;const key=`${x.lat},${x.lng}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);});
    groups.forEach(group=>{
      const popup=document.createElement('div');group.forEach(x=>{const b=document.createElement('button');b.type='button';b.textContent=x.name;b.onclick=()=>showDetail(x);popup.append(b);});
      L.marker([group[0].lat,group[0].lng],{icon:pinIcon(),title:group.map(x=>x.name).join(', ')}).bindPopup(popup).addTo(markers);
    });
  }
  async function load(force=false) {
    if(!admin())return;if(loading)return loading;const version=generation;
    if(!force&&loadedAt&&Date.now()-loadedAt<30000)return;
    const cached=api.cached?.('specRegistry');if(!items.length&&cached)window.dispatchEvent(new CustomEvent('spec-registry-data',{detail:cached}));
    const currentRevision=dataRevision;
    message.textContent='현장 스펙을 불러오고 있어요.';
    loading=(async()=>{try{const data=await api.request('specRegistry',{force});if(version!==generation||currentRevision!==dataRevision)return;siteSchemaVersion=2;window.dispatchEvent(new CustomEvent('spec-registry-data',{detail:data}));loadedAt=Date.now();message.textContent='';}catch(e){if(version===generation)message.textContent=e.message;}finally{if(version===generation)loading=null;}})();return loading;
  }
  async function show() {
    if(!admin())return;
    $('notes-view').hidden=true;$('checklist-view').hidden=true;view.hidden=false;nav.classList.add('active');$('checklist-nav-button').classList.remove('active');$('add-note-button').hidden=true;document.body.classList.remove('sidebar-open');
    const version=generation;load();
    try{const [,data]=await Promise.all([loadMapLibrary(),loadGeography()]);if(version!==generation||view.hidden)return;if(!map){map=makeMap('specs-map',data);markers=L.layerGroup().addTo(map);overview(map);}map.invalidateSize();render();}catch(e){message.textContent=e.message;}
  }
  function hide(){view.hidden=true;nav.classList.remove('active');}
  nav.addEventListener('click',show);
  $('checklist-nav-button').addEventListener('click',hide);
  $('category-nav').addEventListener('click',hide);
  window.addEventListener('show-notes',hide);
  $('specs-notes').onclick=()=>window.dispatchEvent(new Event('show-notes'));
  $('specs-home').onclick=()=>overview(map);
  window.addEventListener('spec-map-visible',()=>{if(map){map.invalidateSize();render();}});
  window.addEventListener('spec-map-detail',event=>{if(admin()&&event.detail)showDetail(event.detail);});
  window.addEventListener('spec-map-data',event=>{if(!admin()||!Array.isArray(event.detail))return;dataRevision++;siteSchemaVersion=2;items=event.detail.map(item=>({...item,papers:Array.isArray(item.papers)?item.papers:[],images:Array.isArray(item.images)?item.images:[]}));render();});
  window.addEventListener('spec-map-edit',event=>{if(admin()&&event.detail)edit(event.detail);});
  window.addEventListener('spec-site-edit',event=>{if(admin())edit(event.detail||null);});   // 현장목록에서 추가·수정
  $('specs-search').addEventListener('input',()=>{page=1;render();});
  $('specs-pagination').onclick=event=>{const button=event.target.closest('[data-spec-page]');if(button&&!button.disabled){page=Number(button.dataset.specPage);render();$('specs-list').scrollIntoView({block:'start',behavior:'smooth'});}};
  $('specs-list').onclick=e=>{const b=e.target.closest('[data-spec-id]');if(b){const x=items.find(x=>x.id===b.dataset.specId);if(x)showDetail(x);}};
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const looksSpec=v=>/^[A-Za-z]+\d+-CE\d+$/i.test(String(v||'').trim());
  // 종이 한 줄 = [종이넘버, 스펙넘버, 제품명] 세트 + 경면 1개 + 구분(요구·제안·실제 사용) + 부위(드레스룸 월·선반·가구, 여러 개)
  function addPaper(p={},text='') {
    const row=document.createElement('div');row.className='specs-paper site-paper';row.dataset.original=JSON.stringify(p);
    const state={number:p.number||'',spec:p.spec||'',usage:p.usage||'',parts:new Set(Array.isArray(p.parts)?p.parts:[]),date:p.date||''};row._state=state;
    row.innerHTML=`<label class="site-paper-find">종이넘버 · 제품명 · 스펙넘버<input data-find maxlength="2000" placeholder="하나만 입력 (예: SM2003D · N436 · HS20-CE01)" autocomplete="off"></label>
      <div class="site-paper-result" data-result aria-live="polite"></div>
      <label class="site-paper-mirror">경면<input data-mirror maxlength="100" placeholder="예: HM" value="${escape(p.mirror||'')}"></label>
      <div class="site-paper-toggles"><div class="site-paper-usage" role="group" aria-label="구분">${['요구','제안','사용'].map(u=>`<button type="button" data-usage="${u}" aria-pressed="${state.usage===u}">${u==='사용'?'실제 사용':u}</button>`).join('')}</div>
      <div class="site-paper-parts" role="group" aria-label="부위">${['월','선반','가구'].map(v=>`<button type="button" data-part="${v}" aria-pressed="${state.parts.has(v)}">${v==='월'?'드레스룸 월':v}</button>`).join('')}</div></div>
      <button type="button" class="site-paper-remove" data-remove-paper aria-label="이 종이 빼기">×</button>`;
    const find=row.querySelector('[data-find]'),result=row.querySelector('[data-result]'),look=()=>window.ZIP_SPEC_LOOKUP;
    const show=()=>{const L=look();if(!state.number&&!state.spec){result.innerHTML='<span class="site-paper-hint">입력하면 종이넘버·스펙넘버·제품명이 함께 채워져요</span>';return;}
      const product=L?.productNames(state.number)?.[0]||'',cat=L?.category(state.number)||'';
      result.innerHTML=`<b>${escape(state.number||'종이넘버 없음')}</b><span>${escape(state.spec||'스펙 미등록')}</span>${product?`<span>${escape(product)}</span>`:''}${cat?`<em>${escape(cat)}</em>`:''}`;
      const next=state.number&&!state.spec&&cat&&L?.nextSpec(cat);if(next)result.insertAdjacentHTML('beforeend',`<button type="button" data-register="${escape(next)}">${escape(next)}로 스펙 등록</button>`);};
    const choose=c=>{state.number=c.number;state.spec=c.spec;find.value='';show();};
    const resolveOne=token=>{const L=look(),list=L?.ready()?L.resolve(token):[];
      if(list.length===1){choose(list[0]);return true;}
      if(list.length>1){result.innerHTML=`<span class="site-paper-hint">"${escape(token)}"에 맞는 종이가 ${list.length}개예요. 골라 주세요.</span>`+list.map((c,k)=>`<button type="button" data-pick="${k}"><b>${escape(c.number)}</b> ${escape(c.spec||'스펙 미등록')}${c.product?' · '+escape(c.product):''} <small>${escape(c.how)}</small></button>`).join('');row._picks=list;return false;}
      if(looksSpec(token)){state.spec=token.trim().toUpperCase();state.number='';}else{state.number=token.trim();state.spec='';}find.value='';show();
      result.insertAdjacentHTML('afterbegin','<span class="site-paper-hint">스펙 목록·효산 시트에 없는 번호라 입력한 그대로 써요. </span>');return true;};
    const resolveText=()=>{const tokens=find.value.split(/[,\n\r]+/).map(v=>v.trim()).filter(Boolean);if(!tokens.length)return;
      // 여러 개를 한 번에 넣으면 첫 번째는 이 줄에, 나머지는 바로 아래 새 줄로 나눈다(경면·구분·부위는 줄마다).
      tokens.slice(1).reverse().forEach(t=>{const extra=addPaper({usage:state.usage,parts:[...state.parts]},t);row.after(extra);});resolveOne(tokens[0]);};
    let timer=0;find.addEventListener('input',()=>{clearTimeout(timer);if(/[,\n\r]/.test(find.value))return;timer=setTimeout(()=>{if(find.value.trim())resolveOne(find.value);},450);});
    find.addEventListener('change',()=>{clearTimeout(timer);resolveText();});
    find.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(timer);resolveText();}});
    find.addEventListener('paste',()=>setTimeout(()=>{if(/[,\n\r]/.test(find.value)){clearTimeout(timer);resolveText();}},0));
    row.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
      if(b.dataset.pick!==undefined){choose(row._picks[Number(b.dataset.pick)]);return;}
      if(b.dataset.usage){state.usage=state.usage===b.dataset.usage?'':b.dataset.usage;row.querySelectorAll('[data-usage]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.usage===state.usage)));return;}
      if(b.dataset.part){state.parts.has(b.dataset.part)?state.parts.delete(b.dataset.part):state.parts.add(b.dataset.part);b.setAttribute('aria-pressed',String(state.parts.has(b.dataset.part)));return;}
      if(b.dataset.register){b.disabled=true;try{await look().register(state.number,b.dataset.register);state.spec=b.dataset.register;show();$('specs-save-message').textContent=`${state.number}을 ${state.spec}로 스펙 목록에 등록했어요.`;}catch(error){b.disabled=false;$('specs-save-message').textContent=error.message;}return;}
      if(b.dataset.removePaper!==undefined)row.remove();});
    show();if(text){find.value=text;resolveOne(text);}
    if(!row.isConnected&&!text)$('specs-papers').append(row);
    return row;
  }
  // 저장 전에: 아직 확정 안 된 입력은 지금 찾고, 줄마다 하나의 종이로 모은다.
  function collectPapers(){
    const rows=[...$('specs-papers').children];
    for(const row of rows){const f=row.querySelector('[data-find]');if(f?.value.trim()){f.dispatchEvent(new Event('change'));}}
    const out=[];for(const row of [...$('specs-papers').children]){const st=row._state;if(!st)continue;if(row._picks&&!st.number&&!st.spec)throw Error('종이를 골라 주세요.');if(!st.number&&!st.spec)continue;
      const old=JSON.parse(row.dataset.original||'{}');out.push({...old,number:st.number,spec:st.spec,mirror:row.querySelector('[data-mirror]').value.trim(),usage:st.usage,parts:[...st.parts],date:st.date||today(),specMode:true});}
    if(!out.length)throw Error('종이넘버·제품명·스펙넘버 중 하나 이상 넣어 주세요.');return out;
  }
  function setLocation(lat,lng) {
    location={lat:Number(lat),lng:Number(lng)};form.elements.lat.value=lat;form.elements.lng.value=lng;
    $('specs-location').textContent='현장 위치를 선택했어요. 지도에 표시된 핀을 확인해 주세요.';
    if(picker){if(pickMarker)picker.removeLayer(pickMarker);pickMarker=L.marker([lat,lng],{icon:pinIcon()}).addTo(picker);}
  }
  async function edit(item=null) {
    if(!admin()||saving)return;const editVersion=++editorVersion;editing=item;searchVersion++;form.reset();location=null;retainedImages=[...(item?.images||[])];uploadedImages=[];
    $('specs-editor-title').textContent=item?'현장 수정':'현장 등록';$('specs-save-message').textContent='';$('specs-candidates').replaceChildren();$('specs-location').textContent='주소 검색 또는 지도 클릭으로 위치를 선택하세요.';
    const statuses=[...new Set([...(window.ZIP_SPEC_LOOKUP?.statuses()||[]),item?.status].filter(Boolean))];form.elements.status.innerHTML='<option value="">선택 안 함</option>'+statuses.map(v=>`<option>${escape(v)}</option>`).join('');
    for(const k of ['name','address','designer','contact','builder','openMonth','completionMonth','status','note'])form.elements[k].value=item?.[k]||'';
    $('specs-papers').replaceChildren();(item?.papers.length?item.papers:[{}]).forEach(p=>addPaper(p));renderRetained();
    $('specs-photo-urls').value=(item?.imageUrls||[]).join('\n');$('specs-url-preview').replaceChildren();
    if(pickMarker&&picker){picker.removeLayer(pickMarker);pickMarker=null;}
    if(item&&Number.isFinite(Number(item.lat))&&item.lat!==null)setLocation(item.lat,item.lng);else $('specs-location').textContent='위치를 고르지 않으면 저장할 때 주소로 자동으로 찾아요.';
    editor.showModal();const version=generation;
    try{const [,data]=await Promise.all([loadMapLibrary(),loadGeography()]);if(version!==generation||editVersion!==editorVersion||!editor.open)return;if(!picker){picker=makeMap('specs-pick-map',data);picker.on('click',e=>{if(!saving)setLocation(e.latlng.lat,e.latlng.lng);});}picker.invalidateSize();picker.setView(item?[item.lat,item.lng]:[36.0,127.8],item?10:7);if(location)setLocation(location.lat,location.lng);}catch(e){if(editVersion===editorVersion)$('specs-location').textContent=e.message+' 주소 검색을 이용하거나 창을 닫고 다시 열어 주세요.';}
  }
  function renderRetained(){const wrap=$('specs-retained');wrap.replaceChildren();retainedImages.forEach((id,i)=>{const b=document.createElement('button');b.type='button';b.textContent=`기존 사진 ${i+1} 제외`;b.onclick=()=>{retainedImages=retainedImages.filter(x=>x!==id);renderRetained();};wrap.append(b);});}
  $('specs-add').onclick=()=>edit();$('specs-cancel').onclick=()=>{if(!saving)editor.close();};
  editor.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
  $('specs-paper-add').onclick=()=>{if($('specs-papers').children.length<50)addPaper();};
  form.elements.address.addEventListener('input',()=>{location=null;searchVersion++;form.elements.lat.value='';form.elements.lng.value='';$('specs-candidates').replaceChildren();$('specs-location').textContent='주소가 바뀌었어요. 위치를 다시 선택하세요.';if(pickMarker&&picker){picker.removeLayer(pickMarker);pickMarker=null;}});
  $('specs-locate').onclick=async()=>{
    const address=form.elements.address.value.trim();if(!address){$('specs-location').textContent='주소를 입력해 주세요.';return;}
    const version=++searchVersion,access=generation;const button=$('specs-locate');button.disabled=true;
    try{const result=await api.request('geocodeSpec',{address});if(version!==searchVersion||access!==generation)return;
      $('specs-candidates').replaceChildren();
      $('specs-location').textContent=!result.configured?'주소 검색 API 키가 아직 연결되지 않았어요. 지도에서 직접 위치를 선택해 주세요.':result.locations.length?'아래 검색 결과를 선택해 주세요.':'주소를 찾지 못했어요. 도로명 주소를 확인하거나 지도에서 선택하세요.';
      result.locations.forEach(x=>{const b=document.createElement('button');b.type='button';b.textContent=x.address;b.onclick=()=>{setLocation(x.lat,x.lng);picker?.setView([x.lat,x.lng],16);};$('specs-candidates').append(b);});
    }catch(e){if(version===searchVersion&&access===generation)$('specs-location').textContent=e.message;}finally{button.disabled=false;}
  };
  async function photo(file) {
    if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>20*1024*1024)throw Error('PNG·JPG·WebP 사진만 장당 20MB까지 가능해요.');
    const url=URL.createObjectURL(file);
    try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,1600/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);return {name:file.name.replace(/\.[^.]+$/,'')+'.jpg',mime:'image/jpeg',base64:canvas.toDataURL('image/jpeg',.84).split(',')[1]};}finally{URL.revokeObjectURL(url);}
  }
  $('specs-files').addEventListener('change',()=>{uploadedImages=[];});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(saving||!admin())return;
    if(location&&(location.lat<32||location.lat>39.5||location.lng<124||location.lng>132.5)){$('specs-save-message').textContent='국내 위치를 선택해 주세요.';return;}   // 위치를 안 고르면 서버가 주소로 찾는다
    const files=Array.from($('specs-files').files);if(files.length+retainedImages.length>4){$('specs-save-message').textContent='사진은 기존 사진을 포함해 4장까지 가능해요.';return;}
    const payload={id:editing?.id||'',lat:location?Number(form.elements.lat.value):'',lng:location?Number(form.elements.lng.value):''};
    for(const k of ['name','address','designer','contact','builder','openMonth','completionMonth','status','note'])payload[k]=form.elements[k].value.trim();
    try{
      payload.imageUrls=photoUrls($('specs-photo-urls').value);
      payload.papers=collectPapers();
      if(payload.papers.length>50)throw Error('스펙은 최대 50개까지 입력해 주세요.');
      if(siteSchemaVersion<2&&(payload.imageUrls.length||payload.papers.some(p=>p.mirror||!p.number)))throw Error('사진 URL·경면·스펙번호 단독 저장은 서버 업데이트 후 사용할 수 있어요. 입력 내용은 유지됩니다.');
    }catch(e){$('specs-save-message').textContent=e.message;return;}
    const version=generation;saving=true;$('specs-fields').disabled=true;form.querySelector('[type=submit]').disabled=true;$('specs-cancel').disabled=true;
    try{
      for(let i=0;i<files.length;i++){if(uploadedImages[i])continue;$('specs-save-message').textContent=`사진 ${i+1}/${files.length} 업로드 중…`;const data=await photo(files[i]);if(version!==generation)return;const result=await api.request('uploadNoteImage',data);if(version!==generation)return;uploadedImages[i]=result.fileId;}
      payload.images=[...retainedImages,...uploadedImages];
      // 바로 반영: 목록에 먼저 넣고 창을 닫는다. 위치 찾기·시트 저장은 뒤에서. 실패하면 되돌리고 입력한 그대로 창을 다시 연다.
      const before=items,tempId=payload.id||`pending-${crypto.randomUUID()}`,draft={...payload,id:tempId,papers:payload.papers,pending:true,lat:Number(payload.lat),lng:Number(payload.lng)};
      items=items.filter(item=>item.id!==tempId).concat(draft);$('specs-search').value='';render();
      saving=false;$('specs-fields').disabled=false;form.querySelector('[type=submit]').disabled=false;$('specs-cancel').disabled=false;
      const notice=t=>{message.textContent=t;const r=$('registry-message');if(r)r.textContent=t;};   // 지도 탭·현장목록 탭 어디서든 보이게
      const openedAt=editorVersion;editor.close();notice('현장을 저장하고 있어요… 주소로 위치를 찾는 중이면 조금 걸려요.');
      window.ZIP_PENDING_SAVES=(window.ZIP_PENDING_SAVES||0)+1;
      try{
        const result=await api.request('saveSpec',payload);if(version!==generation)return;
        const saved={...payload,papers:result.papers||payload.papers,id:result.id||payload.id,lat:Number(result.lat??payload.lat),lng:Number(result.lng??payload.lng)};dataRevision++;loadedAt=0;window.dispatchEvent(new Event('spec-registry-invalidated'));window.dispatchEvent(new Event('spec-registry-refresh'));   // 현장목록·그래프도 바로 새로
        items=items.filter(item=>item.id!==tempId&&item.id!==saved.id).concat(saved);render();
        if(Number.isFinite(saved.lat))map?.setView([saved.lat,saved.lng],Math.max(map.getZoom(),9),{animate:animateMap()});
        notice(`${saved.name} 저장했어요.`);
      }catch(error){
        if(version!==generation)return;items=before;render();
        // 그 사이 다른 현장을 열지 않았으면 입력한 내용 그대로 다시 연다(위치 선택도 유지).
        if(openedAt+1===editorVersion&&!editor.open){editor.showModal();$('specs-save-message').textContent='저장하지 못했어요: '+error.message+' 입력 내용은 유지됩니다.';}
        else notice('현장을 저장하지 못했어요: '+error.message);
      }finally{window.ZIP_PENDING_SAVES--;}
      return;
    }catch(error){if(version===generation)$('specs-save-message').textContent=error.message+' 입력 내용은 유지됩니다.';}
    finally{saving=false;$('specs-fields').disabled=false;form.querySelector('[type=submit]').disabled=false;$('specs-cancel').disabled=false;}
  });
  async function showDetail(item) {
    if(!admin())return;const version=++detailVersion,access=generation;clearPhotos();
    detail.innerHTML=`<div class="specs-actions"><button data-edit type="button">수정</button><button data-delete type="button">삭제</button><button data-close type="button">닫기</button></div><h2>${escape(item.name)}</h2><dl class="specs-detail-data">${[['주소',item.address],['설계사',item.designer],['담당자',item.contact],['건설사',item.builder],['M/H 오픈날',item.openMonth],['완공 연월',item.completionMonth]].map(([k,v])=>`<dt>${k}</dt><dd>${escape(v||'미입력')}</dd>`).join('')}</dl><h3>스펙번호(경면)</h3><table class="specs-table"><thead><tr><th>스펙번호(경면)</th></tr></thead><tbody>${item.papers.map(p=>`<tr><td>${escape(specLabel(p))}</td></tr>`).join('')}</tbody></table><h3>사진</h3><div class="specs-photos"></div><p data-status role="status"></p>`;
    const actionIcons={edit:['현장 수정','<path d="m12 4 4 4M4 12l9-9 4 4-9 9-5 1z"/>'],delete:['현장 삭제','<path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6"/>'],close:['닫기','<path d="m5 5 10 10M15 5 5 15"/>']};
    for(const [key,[label,path]] of Object.entries(actionIcons)){const button=detail.querySelector(`[data-${key}]`);button.classList.add('specs-icon-action');button.setAttribute('aria-label',label);button.title=label;button.innerHTML=`<svg viewBox="0 0 20 20" aria-hidden="true">${path}</svg>`;}
    detail.querySelector('[data-close]').onclick=()=>detail.close();detail.querySelector('[data-edit]').onclick=()=>{detail.close();edit(item);};
    detail.querySelector('[data-delete]').onclick=async e=>{const button=e.currentTarget;if(!confirm('이 현장을 지도·목록과 시트에서 삭제할까요? 삭제하면 되돌릴 수 없어요.'))return;button.disabled=true;try{await api.request('deleteSpec',{id:item.id});if(access!==generation)return;detail.close();window.dispatchEvent(new Event('spec-registry-invalidated'));await load(true);}catch(error){if(version===detailVersion)detail.querySelector('[data-status]').textContent=error.message;}finally{button.disabled=false;}};
    detail.showModal();
    for(const url of item.imageUrls||[])urlImage(url,detail.querySelector('.specs-photos'));
    for(const id of item.images){try{const data=await api.request('specImage',{fileId:id});if(access!==generation||version!==detailVersion||!detail.open)return;if(!/^image\/(jpeg|png|webp)$/.test(data.mime))continue;const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(data.base64),x=>x.charCodeAt(0))],{type:data.mime}));imageUrls.push(url);const image=document.createElement('img');image.src=url;image.alt=item.name+' 현장 사진';detail.querySelector('.specs-photos').append(image);}catch(error){if(version===detailVersion)detail.querySelector('[data-status]').textContent='일부 사진을 불러오지 못했어요.';}}
  }
  window.addEventListener('access-change',()=>{
    nav.hidden=!admin();if(admin()){if(window.location.hash==='#specs')show();if(!view.hidden)$('add-note-button').hidden=true;return;}generation++;searchVersion++;detailVersion++;items=[];loadedAt=0;loading=null;hide();editor.close();detail.close();form.reset();retainedImages=[];uploadedImages=[];clearPhotos();$('specs-list').replaceChildren();markers?.clearLayers();
    if(map){map.remove();map=null;markers=null;}if(picker){picker.remove();picker=null;pickMarker=null;}
  });
  nav.hidden=!admin();
  if(window.location.hash==='#specs')show();
})();
