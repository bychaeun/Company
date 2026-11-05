(function () {
  'use strict';
  const $=id=>document.getElementById(id),api=window.ZIP_API;
  const admin=()=>window.CHAE_AUTH?.user?.status==='approved'&&window.CHAE_AUTH.user.role==='admin';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tabs=['map','sites','numbers'],pencil='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm9.5-13.5 4 4"/></svg>';
  const clipboardIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="6" width="12" height="15" rx="2"/><path d="M16 6V3H4v14h4"/></svg>';
  let active='map',data=null,loading=false,saving=false,epoch=0,revision=0,page=1,sortColumn=-1,sortDirection=1,editing;
  const editor=document.createElement('dialog');editor.id='registry-editor';editor.className='board-editor registry-editor';editor.setAttribute('aria-labelledby','registry-editor-title');
  editor.innerHTML='<h2 id="registry-editor-title"></h2><form><div data-fields class="registry-fields"></div><p data-message role="status"></p><footer><button type="button" class="install-button" data-remove>삭제</button><button type="button" class="install-button" data-cancel>취소</button><button type="submit" class="install-button">시트에 저장</button></footer></form>';document.body.append(editor);
  const form=editor.querySelector('form');
  const fold=v=>String(v??'').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g,'');
  function selectTab(kind,focus=false){
    if(!tabs.includes(kind))return;active=kind;page=1;sortColumn=-1;$('registry-search').value='';
    tabs.forEach(k=>{const b=$('spec-tab-'+k);b.setAttribute('aria-selected',String(k===kind));b.tabIndex=k===kind?0:-1;});
    $('spec-map-panel').hidden=kind!=='map';$('spec-registry-panel').hidden=kind==='map';
    $('spec-registry-panel').setAttribute('aria-labelledby','spec-tab-'+kind);
    if(focus)$('spec-tab-'+kind).focus();
    if(kind==='map'){window.dispatchEvent(new Event('spec-map-visible'));return;}
    $('registry-search').placeholder=kind==='numbers'?'종이넘버, 스펙넘버, 경면, 비고':'현장명, 종이넘버, 스펙넘버, 경면, 설계사';
    $('registry-add').textContent=kind==='numbers'?'＋ 스펙 추가':'＋ 현장 내역';render();refresh();
  }
  tabs.forEach(kind=>{const b=$('spec-tab-'+kind);b.onclick=()=>selectTab(kind);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=tabs.indexOf(active);selectTab(e.key==='Home'?tabs[0]:e.key==='End'?tabs[2]:tabs[(i+(e.key==='ArrowRight'?1:2))%3],true);};});
  function rows(){
    if(!data||active==='map')return [];const result=data.lists[active].items.map(item=>({...item,kind:active}));
    if(active==='sites')for(const item of data.mapItems||[])for(const paper of item.papers||[]){result.push({id:'map-'+item.id+'-'+result.length,source:item,values:[item.name,paper.number,paper.spec||'', '',item.openMonth||'',item.completionMonth||'',item.designer||'','',paper.area||''],kind:'sites'});}
    return result;
  }
  function render(){
    const table=$('registry-table'),pager=$('registry-pagination');$('registry-add').disabled=!data||loading||saving;
    if(!data||active==='map'){table.querySelector('thead').replaceChildren();table.querySelector('tbody').replaceChildren();pager.hidden=true;return;}
    const headers=data.lists[active].headers,query=fold($('registry-search').value);
    let filtered=rows().filter(r=>fold(r.values.join(' ')).includes(query));
    if(sortColumn>=0)filtered.sort((a,b)=>sortDirection*String(a.values[sortColumn]).localeCompare(String(b.values[sortColumn]),'ko',{numeric:true}));
    const pages=Math.max(1,Math.ceil(filtered.length/50));page=Math.min(page,pages);
    table.querySelector('thead').innerHTML='<tr>'+headers.map((h,i)=>`<th scope="col" aria-sort="${sortColumn===i?(sortDirection===1?'ascending':'descending'):'none'}"><button type="button" data-sort="${i}">${esc(h)}${sortColumn===i?(sortDirection===1?' ↑':' ↓'):''}</button></th>`).join('')+'<th scope="col">관리</th></tr>';
    table.querySelector('tbody').innerHTML=filtered.length?filtered.slice((page-1)*50,page*50).map(r=>'<tr>'+r.values.map((v,i)=>`<td>${v&&i===(active==='numbers'?0:1)?`<span class="registry-paper-number"><span>${esc(v)}</span><button type="button" class="registry-copy" data-copy="${esc(v)}" aria-label="종이넘버 ${esc(v)} 복사" title="종이넘버 복사">${clipboardIcon}</button></span>`:esc(v)||'<span class="registry-blank">—</span>'}</td>`).join('')+`<td><button class="registry-row-edit" type="button" data-id="${esc(r.id)}" aria-label="${esc(r.values[0])} ${r.source?'지도 상세 보기':'수정'}">${r.source?'지도':pencil}</button></td></tr>`).join(''):`<tr><td colspan="${headers.length+1}" class="registry-empty">${query?'검색 결과가 없어요.':'등록된 내역이 없어요. 추가 버튼으로 첫 내역을 작성하세요.'}</td></tr>`;
    $('registry-count').textContent=`${filtered.length}개${query?' 검색됨':''}`;pager.hidden=pages<=1;
    pager.innerHTML=`<button type="button" data-page="${page-1}" ${page===1?'disabled':''}>이전</button><span>${page} / ${pages}</span><button type="button" data-page="${page+1}" ${page===pages?'disabled':''}>다음</button>`;
  }
  async function refresh(force=false){
    if(!admin()||loading||saving)return;if(data&&!force&&Date.now()-Date.parse(data.syncedAt)<86400000)return;
    loading=true;render();$('registry-sync').disabled=true;$('registry-message').textContent='시트에서 목록을 불러오는 중…';const access=epoch,start=revision;
    try{const result=await api.request('specRegistry');if(access!==epoch||start!==revision)return;data=result;render();$('registry-synced').textContent='최근 동기화 '+new Date(result.syncedAt).toLocaleString('ko-KR');$('registry-message').textContent='';}
    catch(error){if(access===epoch)$('registry-message').textContent=error.message;}
    finally{loading=false;$('registry-sync').disabled=false;render();}
  }
  function edit(item){
    if(!admin()||saving||!data)return;
    if(item?.source){selectTab('map');window.dispatchEvent(new CustomEvent('spec-map-detail',{detail:item.source}));return;}
    const kind=active;editing={kind,id:item?.id||crypto.randomUUID(),version:item?.version||'',values:item?[...item.values]:Array(data.lists[kind].headers.length).fill('')};
    $('registry-editor-title').textContent=(kind==='numbers'?'스펙번호':'현장 내역')+(item?' 수정':' 추가');
    editor.querySelector('[data-fields]').innerHTML=data.lists[kind].headers.map((h,i)=>{
      const required=i<2?' required':'';let input;
      if(kind==='sites'&&i===7&&data.statuses.length)input=`<select name="field-${i}"><option value="">선택 안 함</option>${[...new Set(data.statuses.concat(editing.values[i]||[]))].map(v=>`<option ${v===editing.values[i]?'selected':''}>${esc(v)}</option>`).join('')}</select>`;
      else if(h==='비고')input=`<textarea name="field-${i}" maxlength="4000">${esc(editing.values[i])}</textarea>`;
      else input=`<input name="field-${i}" value="${esc(editing.values[i])}" maxlength="${i<2?300:4000}"${required}${/예정일/.test(h)?' placeholder="예: 2027-03 또는 2027-03-15"':''}>`;
      return `<label>${esc(h)}${required?' *':''}${input}</label>`;
    }).join('');editor.querySelector('[data-remove]').hidden=!item;editor.querySelector('[data-message]').textContent='';editor.showModal();
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(saving||!admin())return;const access=epoch,item={...editing,values:editing.values.map((_,i)=>form.elements['field-'+i].value.trim())};
    saving=true;editor.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);editor.querySelector('[data-message]').textContent='시트에 저장 중…';
    try{const result=await api.request('saveSpecRegistry',item);if(access!==epoch)return;revision++;const list=data.lists[item.kind].items;const index=list.findIndex(r=>r.id===item.id);if(index<0)list.push(result.item);else list[index]=result.item;editor.close();$('registry-message').textContent='시트에 저장했어요.';render();}
    catch(error){if(access===epoch)editor.querySelector('[data-message]').textContent=error.message+' 입력 내용은 그대로 유지됩니다.';}
    finally{saving=false;editor.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=false);render();}
  };
  editor.querySelector('[data-cancel]').onclick=()=>{if(!saving)editor.close();};
  editor.querySelector('[data-remove]').onclick=async()=>{
    if(saving||!admin()||!confirm('이 내역을 목록에서 삭제할까요? 시트의 앱 삭제일을 비우면 복구할 수 있어요.'))return;
    saving=true;const access=epoch;editor.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await api.request('deleteSpecRegistry',editing);if(access!==epoch)return;revision++;data.lists[editing.kind].items=data.lists[editing.kind].items.filter(r=>r.id!==editing.id);editor.close();render();}
    catch(error){if(access===epoch)editor.querySelector('[data-message]').textContent=error.message;}
    finally{saving=false;editor.querySelectorAll('button').forEach(b=>b.disabled=false);render();}
  };
  $('registry-add').onclick=()=>edit();$('registry-sync').onclick=()=>refresh(true);
  $('registry-search').oninput=()=>{page=1;render();};
  async function copyPaperNumber(button){
    if(button.disabled||!admin())return;const value=button.dataset.copy;if(!value)return;button.disabled=true;let field;
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
      else{field=document.createElement('textarea');field.value=value;field.setAttribute('readonly','');field.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(field);field.select();if(!document.execCommand('copy'))throw Error('Copy failed');}
      if(admin()){$('registry-message').textContent=`종이넘버 ${value} 복사했어요.`;button.dataset.copied='true';}
    }catch{if(admin())$('registry-message').textContent='복사하지 못했어요. 종이넘버를 길게 눌러 복사해 주세요.';}
    finally{field?.remove();button.disabled=false;button.focus();}
  }
  $('registry-table').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.copy!==undefined){copyPaperNumber(b);return;}if(b.dataset.sort!==undefined){const col=Number(b.dataset.sort);sortDirection=sortColumn===col?-sortDirection:1;sortColumn=col;render();}else if(b.dataset.id)edit(rows().find(r=>r.id===b.dataset.id));};
  $('registry-pagination').onclick=e=>{const b=e.target.closest('[data-page]');if(b&&!b.disabled){page=Number(b.dataset.page);render();}};
  $('specs-nav-button').addEventListener('click',()=>{if(active!=='map')refresh();});
  window.addEventListener('access-change',()=>{if(!admin()){epoch++;revision++;data=null;editing=null;editor.close();editor.querySelector('[data-fields]').replaceChildren();$('registry-synced').textContent='';$('registry-count').textContent='';$('registry-message').textContent='';render();selectTab('map');}});
  setInterval(()=>{if(!document.hidden&&!$('specs-view').hidden&&active!=='map')refresh();},60000);
})();
