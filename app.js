(function () {
  "use strict";

  const config = window.COMPANY_CONFIG || {};
  const syncMinutes = Number(config.SYNC_INTERVAL_MINUTES) || 30;
  const pageSize = 20;

  const state = {
    records: [],
    query: "",
    category: "",
    subcategory: "",
    page: 1,
    currentRecordId: null
  };

  const el = {
    list: document.querySelector("#knowledge-list"),
    empty: document.querySelector("#empty-state"),
    count: document.querySelector("#result-count"),
    search: document.querySelector("#search-input"),
    subcategory: document.querySelector("#subcategory-select"),
    pagination: document.querySelector("#pagination"),
    categories: document.querySelector("#category-nav"),
    syncDot: document.querySelector("#sync-dot"),
    syncLabel: document.querySelector("#sync-label"),
    refresh: document.querySelector("#refresh-button"),
    banner: document.querySelector("#connection-banner"),
    dialog: document.querySelector("#detail-dialog"),
    dialogContent: document.querySelector("#dialog-content"),
    install: document.querySelector("#install-button"),
    installDialog: document.querySelector("#install-dialog"),
    addNote: document.querySelector("#add-note-button"),
    noteEditor: document.querySelector("#note-editor-dialog"),
    noteEditorForm: document.querySelector("#note-editor-form"),
    noteEditorMessage: document.querySelector("#note-editor-message"),
    noteDelete: document.querySelector("#note-delete-button"),
    noteCategory: document.querySelector("#note-category"),
    noteCategoryNew: document.querySelector("#note-category-new"),
    noteSubcategory: document.querySelector("#note-subcategory"),
    noteSubcategoryNew: document.querySelector("#note-subcategory-new"),
    noteAddress: document.querySelector("#note-address"),
    noteImages: document.querySelector("#note-images"),
    noteImageIds: document.querySelector("#note-image-ids"),
    noteImagePreview: document.querySelector("#note-image-preview"),
    toast: document.querySelector("#toast")
  };
  let pendingImages = [];

  function jsonToRecords(data) {
    const rows = Array.isArray(data) ? data : data.records;
    if (!Array.isArray(rows)) return [];
    return rows.map((record, index) => ({
      id: index,
      noteId: String(record.noteId || ""),
      category: String(record.category || record["대분류"] || "기타").trim(),
      subcategory: String(record.subcategory || record["소분류"] || "").trim(),
      title: String(record.title || record["제목"] || "제목 없음").trim(),
      address: String(record.address || record["주소"] || "").trim(),
      content: String(record.content || record["내용"] || "").trim(),
      images: Array.isArray(record.images) ? record.images.map(normalizeImageUrl).filter(Boolean) : splitImages(String(record.images || record["이미지"] || "")),
      imageText: String(record.imageText || record["이미지"] || "").trim(),
      updatedAt: String(record.updatedAt || record["수정일"] || "").trim()
    })).filter((record) => record.title !== "제목 없음" || record.content);
  }

  function splitImages(value) {
    return value.split(/\s*[|\n;]\s*/).map(normalizeImageUrl).filter(Boolean);
  }

  function normalizeImageUrl(url) {
    const value = url.trim();
    if (!value) return "";
    if (/^[-\w]{10,200}$/.test(value)) return value;
    return "";
  }

  function escapeHTML(value) {
    const node = document.createElement("div");
    node.textContent = String(value || "");
    return node.innerHTML;
  }

  function searchable(record) {
    return [record.category, record.subcategory, record.title, record.address, record.content]
      .join(" ")
      .toLocaleLowerCase("ko");
  }

  function visibleRecords() {
    const query = state.query.trim().toLocaleLowerCase("ko");
    return state.records.filter((record) => {
      const queryMatch = !query || searchable(record).includes(query);
      const categoryMatch = !state.category || record.category === state.category;
      const subcategoryMatch = !state.subcategory || record.subcategory === state.subcategory;
      return queryMatch && categoryMatch && subcategoryMatch;
    });
  }

  function renderCategories() {
    const counts = new Map();
    state.records.forEach((record) => counts.set(record.category, (counts.get(record.category) || 0) + 1));
    const categoryButtons = Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([category, count]) => [category, category, count]);
    const buttons = [["", "전체 메모", state.records.length], ...categoryButtons];
    el.categories.innerHTML = buttons.map(([value, label, count]) => `
      <button class="category-button ${state.category === value ? "active" : ""}" type="button" data-category="${escapeHTML(value)}">
        <span>${escapeHTML(label)}</span><span>${count}</span>
      </button>`).join("");
  }

  function renderSubcategories() {
    const values = Array.from(new Set(state.records
      .filter((record) => !state.category || record.category === state.category)
      .map((record) => record.subcategory)
      .filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
    if (state.subcategory && !values.includes(state.subcategory)) state.subcategory = "";
    el.subcategory.innerHTML = `<option value="">모든 소분류</option>${values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}`;
    el.subcategory.value = state.subcategory;
  }

  function renderCards() {
    const records = visibleRecords();
    const canEdit = window.CHAE_AUTH?.user?.role === "admin";
    const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
    state.page = Math.min(Math.max(1, state.page), pageCount);
    const pageRecords = records.slice((state.page - 1) * pageSize, state.page * pageSize);
    el.count.textContent = records.length.toLocaleString("ko-KR");
    el.empty.hidden = records.length > 0;
    el.list.hidden = records.length === 0;
    el.list.innerHTML = pageRecords.map((record) => {
      const image = record.images[0];
      return `<article class="knowledge-card ${image ? "has-image" : ""}">
        <button class="card-button" type="button" data-id="${record.id}" aria-label="${escapeHTML(record.title)} 자세히 보기">
          <div>
            <div class="card-category"><span>${escapeHTML(record.category)}</span>${record.subcategory ? `<span>${escapeHTML(record.subcategory)}</span>` : ""}</div>
            <h2 class="card-title">${escapeHTML(record.title)}</h2>
            ${record.address ? `<p class="card-address"><span aria-hidden="true">⌖</span>${escapeHTML(record.address)}</p>` : ""}
            <p class="card-preview">${escapeHTML(record.content)}</p>
          </div>
          ${image ? `<img class="card-image" data-private-image="${escapeHTML(image)}" alt="메모 참고 이미지" loading="lazy" />` : ""}
        </button>
        ${canEdit && record.noteId ? `<button class="card-edit-icon" type="button" data-edit-id="${record.id}" aria-label="${escapeHTML(record.title)} 수정" title="메모 수정"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm9.5-13.5 4 4" /></svg></button>` : ""}
        <div class="card-actions">
          <button class="card-save" type="button" data-save-id="${record.id}" aria-label="${escapeHTML(record.title)} 이미지로 저장">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
            이미지 저장
          </button>
        </div>
      </article>`;
    }).join("");
    el.pagination.hidden = records.length <= pageSize;
    el.pagination.innerHTML = records.length <= pageSize ? "" : `
      <button class="page-arrow" type="button" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""} aria-label="이전 페이지">‹</button>
      <span class="page-pudding" aria-hidden="true">🍮</span>
      ${Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => `<button type="button" data-page="${page}" class="page-number ${page === state.page ? "active" : ""}" ${page === state.page ? 'aria-current="page"' : ""}>${page}</button>`).join("")}
      <button class="page-arrow" type="button" data-page="${state.page + 1}" ${state.page === pageCount ? "disabled" : ""} aria-label="다음 페이지">›</button>`;
    hydrateImages(el.list);
  }

  function render() {
    renderCategories();
    renderSubcategories();
    renderCards();
  }

  function openDetail(id) {
    const record = state.records.find((item) => item.id === Number(id));
    if (!record) return;
    state.currentRecordId = record.id;
    el.dialogContent.innerHTML = `<article class="dialog-body">
      <p class="dialog-category">${escapeHTML(record.category)}${record.subcategory ? ` · ${escapeHTML(record.subcategory)}` : ""}</p>
      <h2>${escapeHTML(record.title)}</h2>
      ${record.address ? `<p class="dialog-address"><span aria-hidden="true">⌖</span><span>${escapeHTML(record.address)}</span></p>` : ""}
      <div class="dialog-copy">${escapeHTML(record.content)}</div>
      ${record.images.length ? `<div class="dialog-images">${record.images.map((url, index) => `<img data-private-image="${escapeHTML(url)}" alt="${escapeHTML(record.title)} 참고 이미지 ${index + 1}" loading="lazy" />`).join("")}</div>` : ""}
      ${record.updatedAt ? `<p class="dialog-updated">마지막 수정 ${escapeHTML(record.updatedAt)}</p>` : ""}
      <button class="dialog-save" type="button" data-dialog-save>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
        이 메모를 이미지로 저장
      </button>
    </article>`;
    document.querySelector("#dialog-edit-button").hidden = !(window.CHAE_AUTH?.user?.role === "admin" && record.noteId);
    el.dialog.showModal();
    hydrateImages(el.dialogContent);
  }

  function editorValue(select, input) {
    return select.value === "__new__" ? input.value.trim() : select.value.trim();
  }

  function renderEditorSubcategories(category, selected = "") {
    const values = Array.from(new Set(state.records.filter((item) => item.category === category).map((item) => item.subcategory).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
    if (selected && !values.includes(selected)) values.unshift(selected);
    el.noteSubcategory.innerHTML = `<option value="">소분류 없음</option>${values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}<option value="__new__">＋ 새 소분류 추가</option>`;
    el.noteSubcategory.value = selected || "";
    el.noteSubcategoryNew.hidden = true;
    el.noteSubcategoryNew.value = "";
  }

  function renderImagePreview() {
    const saved = el.noteImageIds.value.split(/[|\n;]/).map((value) => value.trim()).filter(Boolean);
    const rows = [
      ...saved.map((id, index) => `<span>기존 사진 ${index + 1}<button type="button" data-remove-saved="${index}" aria-label="기존 사진 ${index + 1} 제외">×</button></span>`),
      ...pendingImages.map((file, index) => `<span>${escapeHTML(file.name)}<button type="button" data-remove-pending="${index}" aria-label="${escapeHTML(file.name)} 제외">×</button></span>`)
    ];
    el.noteImagePreview.innerHTML = rows.join("");
  }

  function openNoteEditor(record = null) {
    if (window.CHAE_AUTH?.user?.role !== "admin") return;
    const categories = Array.from(new Set(state.records.map((item) => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
    const selectedCategory = record?.category || state.category || categories[0] || "";
    if (selectedCategory && !categories.includes(selectedCategory)) categories.unshift(selectedCategory);
    el.noteCategory.innerHTML = `${categories.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}<option value="__new__">＋ 새 대분류 추가</option>`;
    el.noteCategory.value = selectedCategory || "__new__";
    el.noteCategoryNew.hidden = el.noteCategory.value !== "__new__";
    el.noteCategoryNew.value = "";
    renderEditorSubcategories(selectedCategory, record?.subcategory || "");
    document.querySelector("#note-editor-title").textContent = record ? "메모 수정" : "새 메모 작성";
    document.querySelector("#note-editor-id").value = record?.noteId || "";
    document.querySelector("#note-title").value = record?.title || "";
    el.noteAddress.value = record?.address || "";
    document.querySelector("#note-content").value = record?.content || "";
    el.noteImageIds.value = record?.imageText || "";
    el.noteImages.value = "";
    pendingImages = [];
    renderImagePreview();
    el.noteDelete.hidden = !record;
    el.noteEditorMessage.textContent = "저장하면 Google 시트와 앱에 바로 반영돼요.";
    el.noteEditor.showModal();
    document.querySelector(record ? "#note-title" : "#note-category").focus();
  }

  async function imagePayload(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024) throw new Error("PNG·JPG·WebP 사진은 장당 20MB까지 첨부할 수 있어요.");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .84));
      if (!blob) throw new Error("사진을 처리하지 못했어요.");
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      return { name: file.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg", base64: String(dataUrl).split(",")[1] };
    } finally { URL.revokeObjectURL(url); }
  }

  async function saveNote(event) {
    event.preventDefault();
    if (window.CHAE_AUTH?.user?.role !== "admin") return;
    const submit = el.noteEditorForm.querySelector('button[type="submit"]');
    const noteId = document.querySelector("#note-editor-id").value;
    const payload = {
      noteId,
      category: editorValue(el.noteCategory, el.noteCategoryNew),
      subcategory: editorValue(el.noteSubcategory, el.noteSubcategoryNew),
      title: document.querySelector("#note-title").value.trim(),
      address: el.noteAddress.value.trim(),
      content: document.querySelector("#note-content").value.trim(),
      imageText: el.noteImageIds.value.trim()
    };
    submit.disabled = true;
    el.noteEditorMessage.textContent = "Google 시트에 저장하고 있어요.";
    try {
      const uploaded = [];
      for (let index = 0; index < pendingImages.length; index += 1) {
        el.noteEditorMessage.textContent = `사진 ${index + 1}/${pendingImages.length}을 올리고 있어요.`;
        const result = await window.ZIP_API.request("uploadNoteImage", await imagePayload(pendingImages[index]));
        uploaded.push(result.fileId);
      }
      payload.imageText = [payload.imageText, ...uploaded].filter(Boolean).join("|");
      el.noteEditorMessage.textContent = "Google 시트에 저장하고 있어요.";
      await window.ZIP_API.request(noteId ? "updateNote" : "createNote", payload);
      el.noteEditor.close();
      state.page = 1;
      await loadData(true);
      showToast(noteId ? "메모와 시트를 수정했어요" : "새 메모를 시트에 저장했어요");
    } catch (error) {
      el.noteEditorMessage.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  async function deleteNote() {
    const noteId = document.querySelector("#note-editor-id").value;
    if (!noteId || window.CHAE_AUTH?.user?.role !== "admin") return;
    if (!window.confirm("이 메모를 Google 시트에서도 삭제할까요? 삭제한 내용은 되돌릴 수 없어요.")) return;
    el.noteDelete.disabled = true;
    el.noteEditorMessage.textContent = "Google 시트에서 메모를 삭제하고 있어요.";
    try {
      await window.ZIP_API.request("deleteNote", { noteId });
      el.noteEditor.close();
      await loadData(true);
      showToast("메모를 삭제했어요");
    } catch (error) {
      el.noteEditorMessage.textContent = error.message;
    } finally {
      el.noteDelete.disabled = false;
    }
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => el.toast.classList.remove("show"), 2600);
  }

  function wrapCanvasText(context, text, maxWidth) {
    const lines = [];
    String(text || "").split("\n").forEach((paragraph) => {
      if (!paragraph) {
        lines.push("");
        return;
      }
      let line = "";
      Array.from(paragraph).forEach((character) => {
        const next = line + character;
        if (line && context.measureText(next).width > maxWidth) {
          lines.push(line.trimEnd());
          line = character.trimStart();
        } else {
          line = next;
        }
      });
      if (line) lines.push(line.trimEnd());
    });
    return lines;
  }

  async function loadCanvasImage(fileId) {
    const url = await window.ZIP_API.image(fileId);
    return new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  const imageObserver = new IntersectionObserver(entries => {
    entries.filter(entry => entry.isIntersecting).forEach(entry => {
      imageObserver.unobserve(entry.target);
      window.ZIP_API.image(entry.target.dataset.privateImage).then(url => {
        if (url && entry.target.isConnected && window.CHAE_AUTH.user?.status === 'approved') entry.target.src = url;
      }).catch(() => { entry.target.alt = '이미지를 불러오지 못했어요'; });
    });
  }, {rootMargin:'100px'});
  function hydrateImages(container) { container.querySelectorAll('[data-private-image]').forEach(img=>imageObserver.observe(img)); }

  function roundedRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.closePath();
  }

  async function saveRecordAsImage(record) {
    if (!record) return;
    showToast("메모 이미지를 만들고 있어요…");
    try {
      const loadedImages = (await Promise.all(record.images.map(loadCanvasImage))).filter(Boolean);
      if (window.CHAE_AUTH.user?.status !== 'approved') return;
      const width = 1200;
      const padding = 86;
      const contentWidth = width - padding * 2;
      const measureCanvas = document.createElement("canvas");
      const measure = measureCanvas.getContext("2d");
      measure.font = "800 58px Pretendard, Arial, sans-serif";
      const titleLines = wrapCanvasText(measure, record.title, contentWidth);
      measure.font = "400 31px Pretendard, Arial, sans-serif";
      const contentLines = wrapCanvasText(measure, record.content, contentWidth);
      const addressLines = record.address ? wrapCanvasText(measure, `주소  ${record.address}`, contentWidth) : [];
      const imageSizes = loadedImages.map((image) => {
        const ratio = Math.min(contentWidth / image.width, 620 / image.height, 1);
        return { image, width: image.width * ratio, height: image.height * ratio };
      });
      const imageHeight = imageSizes.reduce((sum, size) => sum + size.height + 24, 0);
      const height = Math.max(720, 190 + titleLines.length * 72 + addressLines.length * 44 + contentLines.length * 48 + imageHeight + 180);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      context.fillStyle = "#fff8fb";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#f7e7ff";
      context.beginPath();
      context.arc(width - 80, 80, 230, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fff0c9";
      context.beginPath();
      context.arc(20, height - 20, 260, 0, Math.PI * 2);
      context.fill();
      roundedRect(context, 42, 42, width - 84, height - 84, 44);
      context.fillStyle = "rgba(255,255,255,.92)";
      context.fill();
      context.strokeStyle = "#eaddea";
      context.lineWidth = 3;
      context.stroke();

      let y = 104;
      context.fillStyle = "#f08aa7";
      context.font = "800 24px Pretendard, Arial, sans-serif";
      context.fillText("CHAE EUN.ZIP  ·  채은 지식 저장소", padding, y);
      y += 58;
      context.fillStyle = "#8d6bb4";
      context.font = "700 24px Pretendard, Arial, sans-serif";
      context.fillText(`${record.category}${record.subcategory ? `  ·  ${record.subcategory}` : ""}`, padding, y);
      y += 68;
      context.fillStyle = "#352f3f";
      context.font = "800 58px Pretendard, Arial, sans-serif";
      titleLines.forEach((line) => { context.fillText(line, padding, y); y += 72; });
      y += 14;
      if (addressLines.length) {
        context.fillStyle = "#a45f7c";
        context.font = "700 27px Pretendard, Arial, sans-serif";
        addressLines.forEach((line) => { context.fillText(line, padding, y); y += 44; });
        y += 8;
      }
      context.strokeStyle = "#eaddea";
      context.lineWidth = 2;
      context.beginPath(); context.moveTo(padding, y); context.lineTo(width - padding, y); context.stroke();
      y += 58;
      context.fillStyle = "#4e4657";
      context.font = "400 31px Pretendard, Arial, sans-serif";
      contentLines.forEach((line) => { context.fillText(line, padding, y); y += 48; });
      y += 28;

      imageSizes.forEach((size) => {
        roundedRect(context, padding, y, size.width, size.height, 26);
        context.save();
        context.clip();
        context.drawImage(size.image, padding, y, size.width, size.height);
        context.restore();
        y += size.height + 24;
      });

      context.fillStyle = "#a196aa";
      context.font = "500 22px Pretendard, Arial, sans-serif";
      context.fillText(record.updatedAt ? `마지막 수정  ${record.updatedAt}` : "CHAE EUN.ZIP · 채은 지식 저장소", padding, height - 92);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG 생성 실패");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${record.title.replace(/[\\/:*?\"<>|]/g, "_")}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("메모 이미지를 저장했어요");
    } catch (error) {
      console.error("Image export failed:", error);
      showToast("이미지 저장에 실패했어요");
    }
  }

  async function loadData(manual) {
    el.syncDot.className = "sync-dot loading";
    el.syncLabel.textContent = manual ? "새 자료를 확인하는 중" : "동기화 중";
    el.refresh.disabled = true;
    try {
      if (!window.CHAE_AUTH?.user || window.CHAE_AUTH.user.status !== 'approved') return;
      const payload = await window.ZIP_API.request('notes');
      if (window.CHAE_AUTH?.user?.status !== 'approved') return;
      const nextRecords = jsonToRecords(payload);
      window.ZIP_API.clearImages();
      state.records = nextRecords;
      render();
      const time = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
      el.syncDot.className = "sync-dot ready";
      el.syncLabel.textContent = window.ZIP_LOCAL_PREVIEW
        ? '로컬 미리보기 · 실제 저장 안 됨'
        : payload?.syncedAt
        ? `시트 반영 ${new Date(payload.syncedAt).toLocaleString("ko-KR")}`
        : `${time} 저장된 자료 로드`;
      el.banner.hidden = payload?.syncMode === "scheduled" || payload?.syncMode === "preview";
      el.refresh.title = "Google 시트에서 최신 자료 가져오기";
      el.refresh.setAttribute("aria-label", "지금 시트 동기화");
    } catch (error) {
      console.error("Sheet sync failed:", error);
      el.syncDot.className = "sync-dot error";
      el.syncLabel.textContent = state.records.length ? "동기화 지연 · 기존 자료 표시 중" : "자료를 불러오지 못했어요";
      if (!state.records.length) {
        el.list.innerHTML = `<div class="load-error"><strong>자료를 불러오지 못했습니다.</strong><br>Google Sheet 게시 주소와 인터넷 연결을 확인해 주세요.</div>`;
      }
    } finally {
      el.refresh.disabled = false;
    }
  }

  el.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.page = 1;
    renderCards();
  });

  el.subcategory.addEventListener("change", (event) => {
    state.subcategory = event.target.value;
    state.page = 1;
    renderCards();
  });

  el.categories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    state.subcategory = "";
    state.page = 1;
    render();
    window.dispatchEvent(new Event("show-notes"));
    document.body.classList.remove("sidebar-open");
  });

  el.list.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-id]");
    if (editButton) {
      event.stopPropagation();
      openNoteEditor(state.records.find((item) => item.id === Number(editButton.dataset.editId)));
      return;
    }
    const saveButton = event.target.closest("[data-save-id]");
    if (saveButton) {
      event.stopPropagation();
      saveRecordAsImage(state.records.find((item) => item.id === Number(saveButton.dataset.saveId)));
      return;
    }
    const button = event.target.closest("[data-id]");
    if (button) openDetail(button.dataset.id);
  });

  el.pagination.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;
    state.page = Number(button.dataset.page) || 1;
    renderCards();
    document.querySelector("#notes-view").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelector("#clear-filters").addEventListener("click", () => {
    state.query = "";
    state.category = "";
    state.subcategory = "";
    state.page = 1;
    el.search.value = "";
    render();
  });

  const topbarMenuButton = document.querySelector("#topbar-menu-button");
  const closeTopbarMenu = () => {
    document.body.classList.remove("topbar-menu-open");
    topbarMenuButton.setAttribute("aria-expanded", "false");
    topbarMenuButton.setAttribute("aria-label", "상단 메뉴 열기");
  };
  topbarMenuButton.addEventListener("click", () => {
    const open = !document.body.classList.contains("topbar-menu-open");
    document.body.classList.toggle("topbar-menu-open", open);
    topbarMenuButton.setAttribute("aria-expanded", String(open));
    topbarMenuButton.setAttribute("aria-label", open ? "상단 메뉴 닫기" : "상단 메뉴 열기");
  });
  document.querySelector("#topbar-actions").addEventListener("click", (event) => {
    if (event.target.closest("button")) closeTopbarMenu();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".topbar")) closeTopbarMenu();
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 680) closeTopbarMenu();
  });

  document.querySelector("#open-sidebar").addEventListener("click", () => {
    closeTopbarMenu();
    document.body.classList.add("sidebar-open");
  });
  document.querySelector("#close-sidebar").addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  document.querySelector("#sidebar-backdrop").addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  document.querySelector("#dialog-close").addEventListener("click", () => el.dialog.close());
  el.dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-dialog-edit]")) {
      const record = state.records.find((item) => item.id === state.currentRecordId);
      el.dialog.close();
      openNoteEditor(record);
      return;
    }
    if (event.target.closest("[data-dialog-save]")) {
      saveRecordAsImage(state.records.find((item) => item.id === state.currentRecordId));
      return;
    }
    if (event.target === el.dialog) el.dialog.close();
  });
  el.addNote.addEventListener("click", () => openNoteEditor());
  el.noteCategory.addEventListener("change", () => {
    const isNew = el.noteCategory.value === "__new__";
    el.noteCategoryNew.hidden = !isNew;
    if (isNew) el.noteCategoryNew.focus();
    renderEditorSubcategories(isNew ? "" : el.noteCategory.value);
  });
  el.noteSubcategory.addEventListener("change", () => {
    const isNew = el.noteSubcategory.value === "__new__";
    el.noteSubcategoryNew.hidden = !isNew;
    if (isNew) el.noteSubcategoryNew.focus();
  });
  el.noteImages.addEventListener("change", () => {
    const savedCount = el.noteImageIds.value.split(/[|\n;]/).map((value) => value.trim()).filter(Boolean).length;
    const available = Math.max(0, 4 - savedCount);
    pendingImages = Array.from(el.noteImages.files || []).slice(0, available);
    if ((el.noteImages.files?.length || 0) > available) el.noteEditorMessage.textContent = `사진은 기존 사진을 포함해 최대 4장까지 첨부할 수 있어요.`;
    renderImagePreview();
  });
  el.noteImagePreview.addEventListener("click", (event) => {
    const savedButton = event.target.closest("[data-remove-saved]");
    const pendingButton = event.target.closest("[data-remove-pending]");
    if (savedButton) {
      const saved = el.noteImageIds.value.split(/[|\n;]/).map((value) => value.trim()).filter(Boolean);
      saved.splice(Number(savedButton.dataset.removeSaved), 1);
      el.noteImageIds.value = saved.join("|");
    }
    if (pendingButton) pendingImages.splice(Number(pendingButton.dataset.removePending), 1);
    renderImagePreview();
  });
  el.noteEditorForm.addEventListener("submit", saveNote);
  el.noteDelete.addEventListener("click", deleteNote);
  document.querySelector("#note-editor-close").addEventListener("click", () => el.noteEditor.close());
  el.noteEditor.addEventListener("click", (event) => { if (event.target === el.noteEditor) el.noteEditor.close(); });
  el.refresh.addEventListener("click", () => loadData(true));

  let deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    el.install.classList.add("ready");
  });
  el.install.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (choice.outcome === "accepted") showToast("웹앱 설치를 시작했어요");
    } else {
      el.installDialog.showModal();
    }
  });
  document.querySelector("#install-dialog-close").addEventListener("click", () => el.installDialog.close());
  el.installDialog.addEventListener("click", (event) => { if (event.target === el.installDialog) el.installDialog.close(); });
  window.addEventListener("appinstalled", () => {
    el.install.innerHTML = "<span>설치 완료</span>";
    el.install.disabled = true;
    showToast("CHAE EUN.ZIP 웹앱이 설치됐어요");
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      el.search.focus();
    }
  });

  window.addEventListener('access-change', event => {
    el.addNote.hidden = event.detail?.role !== 'admin';
    if (event.detail?.status === 'approved') { if (!state.records.length) loadData(false); }
    else { imageObserver.disconnect(); state.records = []; state.currentRecordId = null; el.dialogContent.replaceChildren(); el.noteEditor.close(); render(); }
  });
  window.addEventListener('notes-refresh', () => loadData(true));
  if (document.modelContext?.registerTool) {
    Promise.resolve(document.modelContext.registerTool({name:'search_notes',description:'승인된 사용자의 화면에서 메모를 검색합니다.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{
      if (!input || typeof input.query !== 'string' || input.query.length > 300) throw new Error('검색어를 300자 이하로 입력하세요.');
      if (window.CHAE_AUTH.user?.status !== 'approved') throw new Error('로그인 및 승인이 필요합니다.');
      await window.CHAE_AUTH.check();
      if (window.CHAE_AUTH.user?.status !== 'approved') throw new Error('접근이 제한되었습니다.');
      state.query=input.query;el.search.value=input.query;renderCards();
      return {count:visibleRecords().length};
    }})).catch(()=>{});
  }
  window.setInterval(() => loadData(false), syncMinutes * 60 * 1000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch((error) => console.error("Service worker:", error));
})();

