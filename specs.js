(function () {
  'use strict';
  const $ = id => document.getElementById(id), api = window.ZIP_API;
  const view = $('specs-view'), nav = $('specs-nav-button'), message = $('specs-message');
  let items = [], map, markers, picker, pickMarker, mapReady, loading, generation = 0, editing = null, location = null, saving = false;
  let retainedImages = [], uploadedImages = [], imageUrls = [], detailVersion = 0, searchVersion = 0, editorVersion = 0;
  let dataRevision = 0;
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
    <label>M/H 오픈날<input name="openMonth" type="month"></label><label>완공 연월<input name="completionMonth" type="month"></label></div>
    <p class="specs-help">주소 검색을 누르면 입력한 주소만 카카오에 전달됩니다. 담당자나 비공개 메모는 주소 칸에 넣지 마세요. API 연결 전에는 아래 지도에서 직접 위치를 찍을 수 있어요.</p>
    <button id="specs-locate" type="button">주소로 위치 찾기</button><div id="specs-candidates"></div>
    <p id="specs-location" role="status">지도에서 현장 위치를 선택해 주세요.</p><div id="specs-pick-map" class="specs-pick-map" aria-label="현장 위치 선택 지도"></div>
    <input name="lat" type="hidden"><input name="lng" type="hidden">
    <h3>사용 종이 목록</h3><div id="specs-papers"></div><button id="specs-paper-add" type="button">＋ 종이 추가</button>
    <label>현장 사진 (최대 4장)<input id="specs-files" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div id="specs-retained"></div>
    </fieldset><p id="specs-save-message" role="status"></p><div class="specs-actions"><button id="specs-cancel" type="button">취소</button><button type="submit">시트에 저장</button></div></form>`;
  document.body.append(editor);
  editor.addEventListener('close',()=>{editorVersion++;searchVersion++;});
  const form = $('specs-form');
  const detail = document.createElement('dialog');detail.className = 'specs-dialog';detail.setAttribute('aria-label','현장 스펙 상세');document.body.append(detail);
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
    ['강릉시',37.752,128.876,7],['원주시',37.342,127.92,8],['속초시',38.207,128.591,8],['동해시',37.524,129.114,9],
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
    if(!geography)geography=fetch('korea-map.json').then(r=>{if(!r.ok)throw Error('평면 지도를 불러오지 못했어요. 새로고침해 주세요.');return r.json();}).catch(e=>{geography=null;throw e;});
    return geography;
  }
  function makeMap(id, data) {
    const result=L.map(id,{minZoom:5,maxZoom:17,touchZoom:true,bounceAtZoomLimits:false,zoomSnap:0.25,zoomAnimation:animateMap(),fadeAnimation:animateMap()}).setView([36.0,127.8],7);
    result.zoomControl.setPosition('topright');
    result.zoomControl.getContainer().querySelector('.leaflet-control-zoom-in').setAttribute('aria-label','지도 확대');
    result.zoomControl.getContainer().querySelector('.leaflet-control-zoom-out').setAttribute('aria-label','지도 축소');
    L.geoJSON(data,{interactive:false,style:f=>({color:'#c8ced0',weight:1,fillColor:f.properties.name==='South Korea'?'#fafbf9':'#e5e8e6',fillOpacity:1})}).addTo(result);
    result.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>');
    const labels=L.layerGroup().addTo(result);
    const renderLabels=()=>{labels.clearLayers();const occupied=[];cities.forEach(([name,lat,lng,zoom])=>{
      if(result.getZoom()<zoom)return;
      const p=result.latLngToContainerPoint([lat,lng]);
      if(occupied.some(q=>Math.abs(q.x-p.x)<62&&Math.abs(q.y-p.y)<22))return;
      occupied.push(p);
      L.marker([lat,lng],{interactive:false,keyboard:false,icon:L.divIcon({className:'specs-city',html:escape(name),iconSize:[72,20],iconAnchor:[36,10]})}).addTo(labels);
    });};
    result.on('zoomend moveend resize',renderLabels);renderLabels();
    return result;
  }
  function filtered() {const q=$('specs-search').value.trim().toLowerCase();return items.filter(x=>!q||[x.name,x.address,x.designer,x.contact,x.builder,...x.papers.flatMap(p=>[p.number,p.area,p.spec])].join(' ').toLowerCase().includes(q));}
  function render() {
    const rows=filtered();
    $('specs-list').innerHTML=rows.length?rows.map(x=>`<button type="button" data-spec-id="${escape(x.id)}"><strong>📍 ${escape(x.name)}</strong><span>${escape(x.address)}</span><span>${escape(x.builder || '건설사 미입력')} · 종이 ${x.papers.length}종</span><span>M/H ${escape(x.openMonth||'미정')} · 완공 ${escape(x.completionMonth||'미정')}</span></button>`).join(''):'<p>등록된 현장이 없거나 검색 결과가 없어요.</p>';
    if(!markers)return;markers.clearLayers();
    const groups=new Map();rows.forEach(x=>{if(!Number.isFinite(x.lat)||!Number.isFinite(x.lng)||x.lat<32||x.lat>39.5||x.lng<124||x.lng>132.5)return;const key=`${x.lat},${x.lng}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);});
    groups.forEach(group=>{
      const popup=document.createElement('div');group.forEach(x=>{const b=document.createElement('button');b.type='button';b.textContent=x.name;b.onclick=()=>showDetail(x);popup.append(b);});
      L.marker([group[0].lat,group[0].lng],{icon:pinIcon(),title:group.map(x=>x.name).join(', ')}).bindPopup(popup).addTo(markers);
    });
  }
  async function load() {
    if(!admin())return;if(loading)return loading;const version=generation,revision=dataRevision;
    message.textContent='현장 스펙을 불러오고 있어요.';
    loading=(async()=>{try{const data=await api.request('specs');if(version!==generation||revision!==dataRevision)return;items=(data.items||[]).map(x=>({...x,papers:Array.isArray(x.papers)?x.papers:[],images:Array.isArray(x.images)?x.images:[]}));render();message.textContent=`현장 ${items.length}개 · 핀이나 목록을 눌러 확인하세요.`;}catch(e){if(version===generation&&revision===dataRevision)message.textContent=e.message+' 새 API 배포가 필요할 수 있어요.';}finally{if(version===generation)loading=null;}})();return loading;
  }
  async function show() {
    if(!admin())return;
    $('notes-view').hidden=true;$('checklist-view').hidden=true;view.hidden=false;nav.classList.add('active');$('checklist-nav-button').classList.remove('active');$('add-note-button').hidden=true;document.body.classList.remove('sidebar-open');
    const version=generation;load();
    try{const [,data]=await Promise.all([loadMapLibrary(),loadGeography()]);if(version!==generation||view.hidden)return;if(!map){map=makeMap('specs-map',data);markers=L.layerGroup().addTo(map);}map.invalidateSize();render();}catch(e){message.textContent=e.message;}
  }
  function hide(){view.hidden=true;nav.classList.remove('active');}
  nav.addEventListener('click',show);
  $('checklist-nav-button').addEventListener('click',hide);
  $('category-nav').addEventListener('click',hide);
  window.addEventListener('show-notes',hide);
  $('specs-notes').onclick=()=>window.dispatchEvent(new Event('show-notes'));
  $('specs-home').onclick=()=>overview(map);
  $('specs-search').addEventListener('input',render);
  $('specs-list').onclick=e=>{const b=e.target.closest('[data-spec-id]');if(b){const x=items.find(x=>x.id===b.dataset.specId);if(x)showDetail(x);}};
  function addPaper(p={}) {
    const row=document.createElement('div');row.className='specs-paper';
    row.innerHTML=`<label>종이넘버 *<input data-paper="number" required maxlength="300" value="${escape(p.number)}"></label><label>사용부위<input data-paper="area" maxlength="300" value="${escape(p.area)}"></label><label>스펙명<input data-paper="spec" maxlength="300" value="${escape(p.spec)}"></label><button type="button" aria-label="이 종이 항목 삭제">삭제</button>`;
    row.querySelector('button').onclick=()=>row.remove();$('specs-papers').append(row);
  }
  function setLocation(lat,lng) {
    location={lat:Number(lat),lng:Number(lng)};form.elements.lat.value=lat;form.elements.lng.value=lng;
    $('specs-location').textContent='현장 위치를 선택했어요. 지도에 표시된 핀을 확인해 주세요.';
    if(picker){if(pickMarker)picker.removeLayer(pickMarker);pickMarker=L.marker([lat,lng],{icon:pinIcon()}).addTo(picker);}
  }
  async function edit(item=null) {
    if(!admin()||saving)return;const editVersion=++editorVersion;editing=item;searchVersion++;form.reset();location=null;retainedImages=[...(item?.images||[])];uploadedImages=[];
    $('specs-editor-title').textContent=item?'현장 수정':'현장 등록';$('specs-save-message').textContent='';$('specs-candidates').replaceChildren();$('specs-location').textContent='주소 검색 또는 지도 클릭으로 위치를 선택하세요.';
    for(const k of ['name','address','designer','contact','builder','openMonth','completionMonth'])form.elements[k].value=item?.[k]||'';
    $('specs-papers').replaceChildren();(item?.papers.length?item.papers:[{}]).forEach(addPaper);renderRetained();
    if(pickMarker&&picker){picker.removeLayer(pickMarker);pickMarker=null;}
    editor.showModal();const version=generation;
    if(item)setLocation(item.lat,item.lng);
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
    if(!location||!Number.isFinite(location.lat)||!Number.isFinite(location.lng)||location.lat<32||location.lat>39.5||location.lng<124||location.lng>132.5){$('specs-save-message').textContent='주소 검색 또는 지도에서 국내 현장 위치를 선택해 주세요.';return;}
    const files=Array.from($('specs-files').files);if(files.length+retainedImages.length>4){$('specs-save-message').textContent='사진은 기존 사진을 포함해 4장까지 가능해요.';return;}
    const payload={id:editing?.id||'',lat:Number(form.elements.lat.value),lng:Number(form.elements.lng.value)};
    for(const k of ['name','address','designer','contact','builder','openMonth','completionMonth'])payload[k]=form.elements[k].value.trim();
    payload.papers=Array.from($('specs-papers').children).map(row=>Object.fromEntries(Array.from(row.querySelectorAll('input')).map(input=>[input.dataset.paper,input.value.trim()])));
    const version=generation;saving=true;$('specs-fields').disabled=true;form.querySelector('[type=submit]').disabled=true;$('specs-cancel').disabled=true;
    try{
      for(let i=0;i<files.length;i++){if(uploadedImages[i])continue;$('specs-save-message').textContent=`사진 ${i+1}/${files.length} 업로드 중…`;const data=await photo(files[i]);if(version!==generation)return;const result=await api.request('uploadNoteImage',data);if(version!==generation)return;uploadedImages[i]=result.fileId;}
      payload.images=[...retainedImages,...uploadedImages];$('specs-save-message').textContent='현장과 종이 스펙을 저장하고 있어요.';
      const result=await api.request('saveSpec',payload);if(version!==generation)return;
      const saved={...payload,id:result.id||payload.id};dataRevision++;
      const index=items.findIndex(item=>item.id===saved.id);
      if(index<0)items.push(saved);else items[index]=saved;
      $('specs-search').value='';render();editor.close();
      map?.setView([saved.lat,saved.lng],Math.max(map.getZoom(),9),{animate:animateMap()});
      message.textContent=`저장했어요. 현장 ${items.length}개 · 지도와 목록에 반영되었습니다.`;
    }catch(error){if(version===generation)$('specs-save-message').textContent=error.message+' 입력 내용은 유지됩니다.';}
    finally{saving=false;$('specs-fields').disabled=false;form.querySelector('[type=submit]').disabled=false;$('specs-cancel').disabled=false;}
  });
  async function showDetail(item) {
    if(!admin())return;const version=++detailVersion,access=generation;clearPhotos();
    detail.innerHTML=`<div class="specs-actions"><button data-edit type="button">수정</button><button data-delete type="button">삭제</button><button data-close type="button">닫기</button></div><h2>${escape(item.name)}</h2><dl class="specs-detail-data">${[['주소',item.address],['설계사',item.designer],['담당자',item.contact],['건설사',item.builder],['M/H 오픈날',item.openMonth],['완공 연월',item.completionMonth]].map(([k,v])=>`<dt>${k}</dt><dd>${escape(v||'미입력')}</dd>`).join('')}</dl><h3>사용 종이</h3><table class="specs-table"><thead><tr><th>종이넘버</th><th>사용부위</th><th>스펙명</th></tr></thead><tbody>${item.papers.map(p=>`<tr><td>${escape(p.number)}</td><td>${escape(p.area)}</td><td>${escape(p.spec)}</td></tr>`).join('')}</tbody></table><h3>사진</h3><div class="specs-photos"></div><p data-status role="status"></p>`;
    detail.querySelector('[data-close]').onclick=()=>detail.close();detail.querySelector('[data-edit]').onclick=()=>{detail.close();edit(item);};
    detail.querySelector('[data-delete]').onclick=async e=>{if(!confirm('이 현장을 지도와 목록에서 숨길까요? 시트의 삭제일을 비우면 복구할 수 있어요.'))return;e.target.disabled=true;try{await api.request('deleteSpec',{id:item.id});if(access!==generation)return;detail.close();await load();}catch(error){if(version===detailVersion)detail.querySelector('[data-status]').textContent=error.message;}finally{e.target.disabled=false;}};
    detail.showModal();
    for(const id of item.images){try{const data=await api.request('specImage',{fileId:id});if(access!==generation||version!==detailVersion||!detail.open)return;if(!/^image\/(jpeg|png|webp)$/.test(data.mime))continue;const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(data.base64),x=>x.charCodeAt(0))],{type:data.mime}));imageUrls.push(url);const image=document.createElement('img');image.src=url;image.alt=item.name+' 현장 사진';detail.querySelector('.specs-photos').append(image);}catch(error){if(version===detailVersion)detail.querySelector('[data-status]').textContent='일부 사진을 불러오지 못했어요.';}}
  }
  window.addEventListener('access-change',()=>{
    nav.hidden=!admin();if(admin()){if(window.location.hash==='#specs')show();if(!view.hidden)$('add-note-button').hidden=true;return;}generation++;searchVersion++;detailVersion++;items=[];loading=null;hide();editor.close();detail.close();form.reset();retainedImages=[];uploadedImages=[];clearPhotos();$('specs-list').replaceChildren();markers?.clearLayers();
    if(map){map.remove();map=null;markers=null;}if(picker){picker.remove();picker=null;pickMarker=null;}
  });
  nav.hidden=!admin();
  if(window.location.hash==='#specs')show();
})();
