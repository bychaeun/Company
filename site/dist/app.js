(function () {
  "use strict";

  const config = window.COMPANY_CONFIG || {};
  const syncMinutes = Number(config.SYNC_INTERVAL_MINUTES) || 30;
  const sampleUrl = "sample-data.csv";
  const dataUrl = String(config.DATA_URL || "").trim();
  const sourceUrl = String(config.SHEET_CSV_URL || "").trim();

  const state = {
    records: [],
    query: "",
    category: "",
    subcategory: "",
    currentRecordId: null
  };

  const el = {
    list: document.querySelector("#knowledge-list"),
    empty: document.querySelector("#empty-state"),
    count: document.querySelector("#result-count"),
    search: document.querySelector("#search-input"),
    subcategory: document.querySelector("#subcategory-select"),
    categories: document.querySelector("#category-nav"),
    syncDot: document.querySelector("#sync-dot"),
    syncLabel: document.querySelector("#sync-label"),
    refresh: document.querySelector("#refresh-button"),
    banner: document.querySelector("#connection-banner"),
    dialog: document.querySelector("#detail-dialog"),
    dialogContent: document.querySelector("#dialog-content"),
    install: document.querySelector("#install-button"),
    installDialog: document.querySelector("#install-dialog"),
    toast: document.querySelector("#toast")
  };

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    return rows;
  }

  const aliases = {
    category: ["대분류", "카테고리", "category"],
    subcategory: ["소분류", "세부분류", "subcategory"],
    title: ["제목", "title"],
    subtitle: ["부제목", "업체명", "subtitle"],
    content: ["내용", "본문", "content"],
    images: ["이미지", "이미지url", "image", "images"],
    updatedAt: ["수정일", "업데이트", "updated_at", "updatedat"]
  };

  function normalizeHeader(value) {
    return value.toLowerCase().replace(/[\s_-]/g, "");
  }

  function csvToRecords(csv) {
    const rows = parseCSV(csv.replace(/^\uFEFF/, ""));
    if (rows.length < 2) return [];
    const headers = rows[0].map(normalizeHeader);
    const indexOf = (field) => headers.findIndex((header) => aliases[field].map(normalizeHeader).includes(header));
    const indexes = Object.fromEntries(Object.keys(aliases).map((key) => [key, indexOf(key)]));

    return rows.slice(1).map((row, index) => ({
      id: index,
      category: valueAt(row, indexes.category) || "기타",
      subcategory: valueAt(row, indexes.subcategory),
      title: valueAt(row, indexes.title) || "제목 없음",
      subtitle: valueAt(row, indexes.subtitle),
      content: valueAt(row, indexes.content),
      images: splitImages(valueAt(row, indexes.images)),
      updatedAt: valueAt(row, indexes.updatedAt)
    })).filter((record) => record.title !== "제목 없음" || record.content);
  }

  function jsonToRecords(data) {
    const rows = Array.isArray(data) ? data : data.records;
    if (!Array.isArray(rows)) return [];
    return rows.map((record, index) => ({
      id: index,
      category: String(record.category || record["대분류"] || "기타").trim(),
      subcategory: String(record.subcategory || record["소분류"] || "").trim(),
      title: String(record.title || record["제목"] || "제목 없음").trim(),
      subtitle: String(record.subtitle || record["부제목"] || "").trim(),
      content: String(record.content || record["내용"] || "").trim(),
      images: Array.isArray(record.images) ? record.images.map(normalizeImageUrl).filter(Boolean) : splitImages(String(record.images || record["이미지"] || "")),
      updatedAt: String(record.updatedAt || record["수정일"] || "").trim()
    })).filter((record) => record.title !== "제목 없음" || record.content);
  }

  function valueAt(row, index) {
    return index >= 0 ? String(row[index] || "").trim() : "";
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
    return [record.category, record.subcategory, record.title, record.subtitle, record.content]
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
    el.count.textContent = records.length.toLocaleString("ko-KR");
    el.empty.hidden = records.length > 0;
    el.list.hidden = records.length === 0;
    el.list.innerHTML = records.map((record) => {
      const image = record.images[0];
      return `<article class="knowledge-card ${image ? "has-image" : ""}">
        <button class="card-button" type="button" data-id="${record.id}" aria-label="${escapeHTML(record.title)} 자세히 보기">
          <div>
            <div class="card-category"><span>${escapeHTML(record.category)}</span>${record.subcategory ? `<span>${escapeHTML(record.subcategory)}</span>` : ""}</div>
            <h2 class="card-title">${escapeHTML(record.title)}</h2>
            ${record.subtitle ? `<p class="card-subtitle">${escapeHTML(record.subtitle)}</p>` : ""}
            <p class="card-preview">${escapeHTML(record.content)}</p>
          </div>
          ${image ? `<img class="card-image" data-private-image="${escapeHTML(image)}" alt="메모 참고 이미지" loading="lazy" />` : ""}
        </button>
        <button class="card-save" type="button" data-save-id="${record.id}" aria-label="${escapeHTML(record.title)} 이미지로 저장">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
          이미지 저장
        </button>
      </article>`;
    }).join("");
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
      ${record.subtitle ? `<p class="dialog-subtitle">${escapeHTML(record.subtitle)}</p>` : ""}
      <div class="dialog-copy">${escapeHTML(record.content)}</div>
      ${record.images.length ? `<div class="dialog-images">${record.images.map((url, index) => `<img data-private-image="${escapeHTML(url)}" alt="${escapeHTML(record.title)} 참고 이미지 ${index + 1}" loading="lazy" />`).join("")}</div>` : ""}
      ${record.updatedAt ? `<p class="dialog-updated">마지막 수정 ${escapeHTML(record.updatedAt)}</p>` : ""}
      <button class="dialog-save" type="button" data-dialog-save>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
        이 메모를 이미지로 저장
      </button>
    </article>`;
    el.dialog.showModal();
    hydrateImages(el.dialogContent);
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
      const imageSizes = loadedImages.map((image) => {
        const ratio = Math.min(contentWidth / image.width, 620 / image.height, 1);
        return { image, width: image.width * ratio, height: image.height * ratio };
      });
      const imageHeight = imageSizes.reduce((sum, size) => sum + size.height + 24, 0);
      const height = Math.max(720, 190 + titleLines.length * 72 + (record.subtitle ? 58 : 0) + contentLines.length * 48 + imageHeight + 180);
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
      if (record.subtitle) {
        y += 2;
        context.fillStyle = "#75697f";
        context.font = "700 31px Pretendard, Arial, sans-serif";
        context.fillText(record.subtitle, padding, y);
        y += 58;
      }
      y += 14;
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
      const nextRecords = payload ? jsonToRecords(payload) : csvToRecords(text);
      window.ZIP_API.clearImages();
      state.records = nextRecords;
      render();
      const time = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
      el.syncDot.className = "sync-dot ready";
      el.syncLabel.textContent = payload?.syncedAt
        ? `시트 반영 ${new Date(payload.syncedAt).toLocaleString("ko-KR")}`
        : `${time} 저장된 자료 로드`;
      el.banner.hidden = payload?.syncMode === "scheduled";
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
    renderCards();
  });

  el.subcategory.addEventListener("change", (event) => {
    state.subcategory = event.target.value;
    renderCards();
  });

  el.categories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    state.subcategory = "";
    render();
    document.body.classList.remove("sidebar-open");
  });

  el.list.addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-id]");
    if (saveButton) {
      event.stopPropagation();
      saveRecordAsImage(state.records.find((item) => item.id === Number(saveButton.dataset.saveId)));
      return;
    }
    const button = event.target.closest("[data-id]");
    if (button) openDetail(button.dataset.id);
  });

  document.querySelector("#clear-filters").addEventListener("click", () => {
    state.query = "";
    state.category = "";
    state.subcategory = "";
    el.search.value = "";
    render();
  });

  document.querySelector("#open-sidebar").addEventListener("click", () => document.body.classList.add("sidebar-open"));
  document.querySelector("#close-sidebar").addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  document.querySelector("#sidebar-backdrop").addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  document.querySelector("#dialog-close").addEventListener("click", () => el.dialog.close());
  el.dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-dialog-save]")) {
      saveRecordAsImage(state.records.find((item) => item.id === state.currentRecordId));
      return;
    }
    if (event.target === el.dialog) el.dialog.close();
  });
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
    if (event.detail?.status === 'approved') { if (!state.records.length) loadData(false); }
    else { imageObserver.disconnect(); state.records = []; state.currentRecordId = null; el.dialogContent.replaceChildren(); render(); }
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
