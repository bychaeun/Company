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
  let items = [];

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

  function showNotes() {
    notesView.hidden = false;
    checklistView.hidden = true;
    navButton.classList.remove("active");
  }

  async function showChecklist() {
    if (window.CHAE_AUTH.user?.role !== "admin") return;
    notesView.hidden = true;
    checklistView.hidden = false;
    navButton.classList.add("active");
    document.body.classList.remove("sidebar-open");
    await load();
  }

  function render() {
    if (!items.length) {
      list.innerHTML = '<div class="checklist-empty">등록된 할 일이 없습니다. 첫 일정을 추가해 보세요.</div>';
      return;
    }
    list.innerHTML = items.map((item) => `
      <div class="checklist-item ${item.done ? "done" : ""}">
        <input type="checkbox" data-checklist-row="${Number(item.row)}" ${item.done ? "checked" : ""} />
        <span><strong>${escapeHTML(item.task)}</strong><span>${escapeHTML(item.note || "Google 캘린더에 등록됨")}</span></span>
        <time datetime="${escapeHTML(item.date)}">${escapeHTML(item.date)}${item.time ? ` · ${escapeHTML(item.time)}` : ""}</time>
        <button type="button" data-delete-row="${Number(item.row)}" aria-label="${escapeHTML(item.task)} 삭제">삭제</button>
      </div>`).join("");
  }

  async function load() {
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
      await api.request("addChecklist", {
        task: $("checklist-task").value.trim(),
        date: dateInput.value,
        time: $("checklist-time").value,
        note: $("checklist-note").value.trim()
      });
      form.reset();
      dateInput.value = today();
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
    checkbox.disabled = true;
    message.textContent = "완료 상태를 캘린더에 반영하고 있어요.";
    try {
      await api.request("toggleChecklist", { row: Number(checkbox.dataset.checklistRow), done: checkbox.checked });
      await load();
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      checkbox.disabled = false;
      message.textContent = error.message;
    }
  });

  dateInput.value = today();
  list.addEventListener('click', async event => {
    const button=event.target.closest('[data-delete-row]');
    if(!button || window.CHAE_AUTH.user?.role!=='admin')return;
    if(!window.confirm('체크리스트에서 삭제할까요? 연결된 Google 캘린더 일정은 유지됩니다.'))return;
    button.disabled=true;
    try {await api.request('deleteChecklist',{row:Number(button.dataset.deleteRow)});await load();}
    catch(error){message.textContent=error.message;button.disabled=false;}
  });
  setInterval(()=>{if(!document.hidden && !checklistView.hidden && window.CHAE_AUTH.user?.role==='admin')load();},60000);
})();
