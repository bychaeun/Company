(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const api = window.ZIP_API;
  const notesView = $("notes-view");
  const checklistView = $("checklist-view");
  const navButton = $("checklist-nav-button");
  const form = $("checklist-form");
  const list = $("checklist-list");
  const message = $("checklist-message");
  const dateInput = $("checklist-date");
  const notesButton = $("checklist-notes-button");
  const addNoteButton = $("add-note-button");
  const formToggle = $("checklist-form-toggle");
  const formCancel = $("checklist-form-cancel");
  const calendarGrid = $("calendar-grid");
  const calendarTitle = $("calendar-month-title");
  const selectedTitle = $("checklist-selected-title");
  let items = [];
  let loading = null;
  let saving = false;
  let selectedDate = today();
  let visibleMonth = selectedDate.slice(0, 7);

  function escapeHTML(value) {
    const node = document.createElement("div");
    node.textContent = String(value || "");
    return node.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function today() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function dateKey(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function formatSelectedDate(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('ko-KR', {month:'long',day:'numeric',weekday:'short'}).format(new Date(year, month - 1, day));
  }

  function showNotes() {
    notesView.hidden = false;
    checklistView.hidden = true;
    navButton.classList.remove("active");
    addNoteButton.hidden = window.CHAE_AUTH.user?.role !== "admin";
  }

  async function showChecklist() {
    if (window.CHAE_AUTH.user?.role !== "admin") return;
    notesView.hidden = true;
    checklistView.hidden = false;
    navButton.classList.add("active");
    addNoteButton.hidden = true;
    form.hidden = true;
    document.body.classList.remove("sidebar-open");
    await load();
  }

  function renderCalendar() {
    const [year, month] = visibleMonth.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const start = first.getDay();
    calendarTitle.textContent = `${year}년 ${month}월`;
    calendarGrid.innerHTML = Array.from({length:42}, (_, index) => {
      const date = new Date(year, month - 1, index - start + 1);
      const key = dateKey(date);
      const dayItems = items.filter(item => item.date === key);
      const labels = dayItems.slice(0, 2).map(item => `<span class="calendar-task ${item.done ? 'done' : ''}">${escapeHTML(item.time || '종일')} ${escapeHTML(item.task)}</span>`).join('');
      const more = dayItems.length > 2 ? `<span class="calendar-more">+${dayItems.length - 2}개</span>` : '';
      return `<button class="calendar-day ${date.getMonth() !== month - 1 ? 'outside' : ''} ${key === today() ? 'today' : ''} ${key === selectedDate ? 'selected' : ''}" type="button" role="gridcell" data-calendar-date="${key}" aria-selected="${key === selectedDate}">
        <span class="calendar-day-number">${date.getDate()}</span>${labels}${more}
      </button>`;
    }).join('');
  }

  function renderAgenda() {
    const dayItems = items.filter(item => item.date === selectedDate);
    selectedTitle.textContent = `${formatSelectedDate(selectedDate)} 일정`;
    if (!dayItems.length) {
      list.innerHTML = '<div class="checklist-empty">이 날짜에는 등록된 일정이 없어요. 위에서 새 할 일을 추가해 보세요.</div>';
      return;
    }
    list.innerHTML = dayItems.map((item) => `
      <div class="checklist-item ${item.done ? "done" : ""}">
        <label class="checklist-toggle">
          <input type="checkbox" data-checklist-row="${Number(item.row)}" ${item.done ? "checked" : ""} />
          <span><strong>${escapeHTML(item.task)}</strong><span>${escapeHTML(item.note || "Google 캘린더에 등록됨")}</span></span>
        </label>
        <time datetime="${escapeHTML(item.date)}">${escapeHTML(item.date)}${item.time ? ` · ${escapeHTML(item.time)}` : ""}</time>
        <button type="button" data-delete-row="${Number(item.row)}" aria-label="${escapeHTML(item.task)} 삭제">삭제</button>
      </div>`).join("");
  }

  function render() {
    renderCalendar();
    renderAgenda();
  }

  function load() {
    if (loading) return loading;
    loading = fetchItems().finally(() => { loading = null; });
    return loading;
  }

  async function fetchItems() {
    message.textContent = "체크리스트와 캘린더 상태를 확인하고 있어요.";
    try {
      const data = await api.request("checklist");
      items = Array.isArray(data.items) ? data.items : [];
      render();
      message.textContent = `${items.length}개의 할 일을 불러왔어요.`;
    } catch (error) {
      message.textContent = error.message;
    }
  }

  navButton.addEventListener("click", showChecklist);
  notesButton.addEventListener("click", showNotes);
  formToggle.addEventListener('click', () => {
    form.hidden = false;
    dateInput.value = selectedDate;
    $("checklist-task").focus();
    form.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  formCancel.addEventListener('click', () => { form.hidden = true; });
  calendarGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-calendar-date]');
    if(!button)return;
    selectedDate = button.dataset.calendarDate;
    visibleMonth = selectedDate.slice(0, 7);
    dateInput.value = selectedDate;
    render();
  });
  $("calendar-prev").addEventListener('click', () => {
    const [year, month] = visibleMonth.split('-').map(Number);
    visibleMonth = dateKey(new Date(year, month - 2, 1)).slice(0, 7);
    renderCalendar();
  });
  $("calendar-next").addEventListener('click', () => {
    const [year, month] = visibleMonth.split('-').map(Number);
    visibleMonth = dateKey(new Date(year, month, 1)).slice(0, 7);
    renderCalendar();
  });
  window.addEventListener("show-notes", showNotes);
  window.addEventListener("access-change", (event) => {
    if (event.detail?.role !== "admin") showNotes();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (window.CHAE_AUTH.user?.role !== "admin") return;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    message.textContent = "Google 캘린더에 할 일을 추가하고 있어요.";
    try {
      selectedDate = dateInput.value;
      visibleMonth = selectedDate.slice(0, 7);
      await api.request("addChecklist", {
        task: $("checklist-task").value.trim(),
        date: dateInput.value,
        time: $("checklist-time").value,
        note: $("checklist-note").value.trim()
      });
      form.reset();
      dateInput.value = selectedDate;
      form.hidden = true;
      await load();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  list.addEventListener("change", async (event) => {
    const checkbox = event.target.closest("[data-checklist-row]");
    if (!checkbox) return;
    if (saving || loading) { checkbox.checked = !checkbox.checked; return; }
    saving = true;
    const previous = !checkbox.checked;
    const row = checkbox.closest('.checklist-item');
    row.classList.toggle('done', checkbox.checked);
    list.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
    row.setAttribute('aria-busy', 'true');
    message.textContent = "완료 상태를 캘린더에 반영하고 있어요.";
    try {
      await api.request("toggleChecklist", { row: Number(checkbox.dataset.checklistRow), done: checkbox.checked });
      await load();
    } catch (error) {
      checkbox.checked = previous;
      row.classList.toggle('done', previous);
      message.textContent = error.message;
    } finally {
      saving = false;
      row.removeAttribute('aria-busy');
      list.querySelectorAll('input, button').forEach(control => { control.disabled = false; });
    }
  });

  dateInput.value = selectedDate;
  dateInput.addEventListener('change', () => {
    if(!dateInput.value)return;
    selectedDate = dateInput.value;
    visibleMonth = selectedDate.slice(0, 7);
    render();
  });
  list.addEventListener('click', async event => {
    const button=event.target.closest('[data-delete-row]');
    if(!button || saving || loading || window.CHAE_AUTH.user?.role!=='admin')return;
    if(!window.confirm('체크리스트에서 삭제할까요? 연결된 Google 캘린더 일정은 유지됩니다.'))return;
    saving=true;
    list.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
    try {await api.request('deleteChecklist',{row:Number(button.dataset.deleteRow)});await load();}
    catch(error){message.textContent=error.message;}
    finally{saving=false;list.querySelectorAll('input, button').forEach(control => { control.disabled = false; });}
  });
  setInterval(()=>{if(!saving && !document.hidden && !checklistView.hidden && window.CHAE_AUTH.user?.role==='admin')load();},60000);
})();
