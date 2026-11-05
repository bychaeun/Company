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
  function normalizeNumbers(result){
    const list=result.lists.numbers;
    if(list.headers.length===4){result.legacyNumberColumns=true;list.headers=[list.headers[0],list.headers[1],list.headers[3]];list.items=list.items.map(item=>({...item,legacyMirror:item.values[2],values:[item.values[0],item.values[1],item.values[3]]}));}
    return result;
  }
  function numberWrite(item){return item.kind==='numbers'&&data.legacyNumberColumns?{...item,values:[item.values[0],item.values[1],item.legacyMirror||'',item.values[2]]}:item;}
  function selectTab(kind,focus=false){
    if(!tabs.includes(kind))return;active=kind;page=1;sortColumn=-1;$('registry-search').value='';
    $('spec-tab-map').parentElement.style.setProperty('--active-tab',String(tabs.indexOf(kind)));
    tabs.forEach(k=>{const b=$('spec-tab-'+k);b.setAttribute('aria-selected',String(k===kind));b.tabIndex=k===kind?0:-1;});
    $('spec-map-panel').hidden=kind!=='map';$('spec-registry-panel').hidden=kind==='map';
    $('spec-registry-panel').setAttribute('aria-labelledby','spec-tab-'+kind);
    if(focus)$('spec-tab-'+kind).focus();
    if(kind==='map'){window.dispatchEvent(new Event('spec-map-visible'));return;}
    $('registry-search').placeholder=kind==='numbers'?'종이넘버, 스펙넘버, 비고':'현장명, 종이넘버, 스펙넘버, 경면, 설계사';
    $('registry-add').textContent=kind==='numbers'?'＋ 스펙 추가':'＋ 현장 내역';render();refresh();
  }
  tabs.forEach(kind=>{const b=$('spec-tab-'+kind);b.onclick=()=>selectTab(kind);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=tabs.indexOf(active);selectTab(e.key==='Home'?tabs[0]:e.key==='End'?tabs[2]:tabs[(i+(e.key==='ArrowRight'?1:2))%3],true);};});
  function rows(){
    if(!data||active==='map')return [];const result=data.lists[active].items.map(item=>({...item,kind:active}));
    if(active==='sites'&&!data.unifiedSites)for(const item of data.mapItems||[])for(const paper of item.papers||[]){result.push({id:'map-'+item.id+'-'+result.length,source:item,values:[item.name,paper.number||'',paper.spec||'',paper.mirror||'',item.openMonth||'',item.completionMonth||'',item.designer||'','',paper.area||''],kind:'sites'});}
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
    table.querySelector('tbody').innerHTML=filtered.length?filtered.slice((page-1)*50,page*50).map(r=>'<tr>'+r.values.map((v,i)=>`<td>${v&&i===(active==='numbers'?0:1)?`<span class="registry-paper-number"><span>${esc(v)}</span><button type="button" class="registry-copy" data-copy="${esc(v)}" aria-label="종이넘버 ${esc(v)} 복사" title="종이넘버 복사">${clipboardIcon}</button></span>`:esc(v)||'<span class="registry-blank">—</span>'}</td>`).join('')+`<td><button class="registry-row-edit" type="button" data-id="${esc(r.id)}" aria-label="${esc(r.values[0])} 수정">${pencil}</button></td></tr>`).join(''):`<tr><td colspan="${headers.length+1}" class="registry-empty">${query?'검색 결과가 없어요.':'등록된 내역이 없어요. 추가 버튼으로 첫 내역을 작성하세요.'}</td></tr>`;
    $('registry-count').textContent=`${filtered.length}개${query?' 검색됨':''}`;pager.hidden=pages<=1;
    pager.innerHTML=`<button type="button" data-page="${page-1}" ${page===1?'disabled':''}>이전</button><span>${page} / ${pages}</span><button type="button" data-page="${page+1}" ${page===pages?'disabled':''}>다음</button>`;
  }
  async function refresh(force=false){
    if(!admin()||loading||saving)return;if(data&&!force&&Date.now()-Date.parse(data.syncedAt)<86400000)return;
    loading=true;render();$('registry-sync').disabled=true;$('registry-message').textContent='시트에서 목록을 불러오는 중…';const access=epoch,start=revision;
    try{const result=await api.request('specRegistry',{force});if(access!==epoch||start!==revision)return;data=normalizeNumbers(structuredClone(result));render();$('registry-synced').textContent='최근 동기화 '+new Date(result.syncedAt).toLocaleString('ko-KR');$('registry-message').textContent='';}
    catch(error){if(access===epoch)$('registry-message').textContent=error.message;}
    finally{loading=false;$('registry-sync').disabled=false;render();}
  }
  function edit(item){
    if(!admin()||saving||!data)return;
    if(item?.source){selectTab('map');window.dispatchEvent(new CustomEvent('spec-map-edit',{detail:item.source}));return;}
    const kind=active;editing={kind,id:item?.id||crypto.randomUUID(),version:item?.version||'',legacyMirror:item?.legacyMirror||'',values:item?[...item.values]:Array(data.lists[kind].headers.length).fill('')};
    $('registry-editor-title').textContent=(kind==='numbers'?'스펙번호':'현장 내역')+(item?' 수정':' 추가');
    editor.querySelector('[data-fields]').innerHTML=data.lists[kind].headers.map((h,i)=>{
      const required=(kind==='numbers'?i<2:i===0)?' required':'';let input;
      if(kind==='sites'&&i===7&&data.statuses.length)input=`<select name="field-${i}"><option value="">선택 안 함</option>${[...new Set(data.statuses.concat(editing.values[i]||[]))].map(v=>`<option ${v===editing.values[i]?'selected':''}>${esc(v)}</option>`).join('')}</select>`;
      else if(h==='비고'||kind==='sites'&&[1,2,3].includes(i))input=`<textarea name="field-${i}" maxlength="4000"${kind==='sites'&&[1,2,3].includes(i)?' placeholder="여러 개는 줄바꿈 또는 쉼표로 구분"':''}>${esc(editing.values[i])}</textarea>`;
      else input=`<input name="field-${i}" value="${esc(editing.values[i])}" maxlength="${i<2?300:4000}"${required}${/예정일/.test(h)?' placeholder="예: 2027-03 또는 2027-03-15"':''}>`;
      return `<label>${esc(h)}${required?' *':''}${input}</label>`;
    }).join('');editor.querySelector('[data-remove]').hidden=!item;editor.querySelector('[data-message]').textContent='';
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
    event.preventDefault();if(saving||!admin())return;const access=epoch,item={...editing,values:editing.values.map((_,i)=>form.elements['field-'+i].value.trim())};
    if(item.kind==='sites'&&!item.values[1]&&!item.values[2]){editor.querySelector('[data-message]').textContent='종이넘버 또는 스펙넘버를 입력해 주세요.';return;}
    if(item.kind==='sites'){const split=v=>v.split(/[,\n\r]+/).map(s=>s.trim()).filter(Boolean),a=split(item.values[1]),b=split(item.values[2]),m=split(item.values[3]);if(a.length&&b.length&&a.length!==b.length||m.length>1&&m.length!==Math.max(a.length,b.length)){editor.querySelector('[data-message]').textContent='종이넘버·스펙넘버·경면 개수를 순서대로 맞춰 주세요. 경면 1개는 모든 스펙에 공통 적용됩니다.';return;}}
    saving=true;editor.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);editor.querySelector('[data-message]').textContent='시트에 저장 중…';
    try{const result=await api.request('saveSpecRegistry',numberWrite(item));if(access!==epoch)return;revision++;let saved=result.item;if(item.kind==='numbers'&&data.legacyNumberColumns)saved={...saved,legacyMirror:saved.values[2],values:[saved.values[0],saved.values[1],saved.values[3]]};const list=data.lists[item.kind].items;const index=list.findIndex(r=>r.id===item.id);if(index<0)list.push(saved);else list[index]=saved;editor.close();$('registry-message').textContent='시트에 저장했어요.';render();}
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
