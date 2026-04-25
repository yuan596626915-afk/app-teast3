const configKeys = {
  serverBase: "remoteSite.serverBase",
  statusPath: "remoteSite.statusPath",
  filesPath: "remoteSite.filesPath",
  decisionPath: "remoteSite.decisionPath",
  emergencyPath: "remoteSite.emergencyPath",
  authToken: "remoteSite.authToken",
  remotePath: "remoteSite.remotePath",
};

const state = {
  connected: false,
  pollingTimer: null,
  files: [],
};

const elements = {
  serverStatus: document.querySelector("#serverStatus"),
  connectionHint: document.querySelector("#connectionHint"),
  connectButton: document.querySelector("#connectButton"),
  serverBase: document.querySelector("#serverBase"),
  statusPath: document.querySelector("#statusPath"),
  filesPath: document.querySelector("#filesPath"),
  decisionPath: document.querySelector("#decisionPath"),
  emergencyPath: document.querySelector("#emergencyPath"),
  authToken: document.querySelector("#authToken"),
  emergencyButton: document.querySelector("#emergencyButton"),
  serverState: document.querySelector("#serverState"),
  agentState: document.querySelector("#agentState"),
  automationState: document.querySelector("#automationState"),
  safetyState: document.querySelector("#safetyState"),
  lastUpdate: document.querySelector("#lastUpdate"),
  decisionType: document.querySelector("#decisionType"),
  decisionTarget: document.querySelector("#decisionTarget"),
  decisionValue: document.querySelector("#decisionValue"),
  decisionUnit: document.querySelector("#decisionUnit"),
  decisionReason: document.querySelector("#decisionReason"),
  decisionState: document.querySelector("#decisionState"),
  sendDecisionButton: document.querySelector("#sendDecisionButton"),
  remotePath: document.querySelector("#remotePath"),
  refreshFilesButton: document.querySelector("#refreshFilesButton"),
  fileList: document.querySelector("#fileList"),
  previewTitle: document.querySelector("#previewTitle"),
  previewType: document.querySelector("#previewType"),
  previewBox: document.querySelector("#previewBox"),
};

function loadConfig() {
  elements.serverBase.value =
    localStorage.getItem(configKeys.serverBase) || "http://192.168.1.100:8787";
  elements.statusPath.value = localStorage.getItem(configKeys.statusPath) || "/api/status";
  elements.filesPath.value = localStorage.getItem(configKeys.filesPath) || "/api/files";
  elements.decisionPath.value =
    localStorage.getItem(configKeys.decisionPath) || "/api/decision";
  elements.emergencyPath.value =
    localStorage.getItem(configKeys.emergencyPath) || "/api/emergency-stop";
  elements.authToken.value = localStorage.getItem(configKeys.authToken) || "";
  elements.remotePath.value = localStorage.getItem(configKeys.remotePath) || "/logs";
}

function saveConfig() {
  Object.entries(configKeys).forEach(([field, key]) => {
    localStorage.setItem(key, elements[field].value.trim());
  });
}

function joinUrl(base, path) {
  const normalizedBase = /^https?:\/\//i.test(base.trim()) ? base.trim() : `http://${base.trim()}`;
  const cleanBase = normalizedBase.replace(/\/+$/, "");
  const cleanPath = path.trim().replace(/^\/?/, "/");
  return `${cleanBase}${cleanPath}`;
}

function apiUrl(pathElement, params = {}) {
  const url = new URL(joinUrl(elements.serverBase.value, pathElement.value));
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  });
  return url.toString();
}

function assetUrl(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value, joinUrl(elements.serverBase.value, "/")).toString();
}

function headers() {
  const token = elements.authToken.value.trim();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` } : {}),
  };
}

function formatTime(value) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatSize(size) {
  if (size === undefined || size === null || size === "") return "--";
  const value = Number(size);
  if (Number.isNaN(value)) return String(size);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function setConnection(connected, message = "") {
  state.connected = connected;
  elements.serverStatus.textContent = connected ? "已连接" : "未连接";
  elements.serverStatus.classList.toggle("offline", !connected);
  elements.connectionHint.textContent = connected ? "电脑代理在线，正在同步测试数据" : message || "等待电脑代理地址";
  elements.connectButton.textContent = connected ? "重新连接" : "连接电脑";
  elements.serverState.textContent = connected ? "代理在线" : message || "未连接";
  elements.refreshFilesButton.disabled = !connected;
  elements.sendDecisionButton.disabled = !connected;
  elements.emergencyButton.disabled = !connected;
}

function normalizeStatus(raw) {
  const data = raw?.data && typeof raw.data === "object" ? raw.data : raw;
  return {
    serverOnline: Boolean(data.serverOnline ?? true),
    agentOnline: Boolean(data.agentOnline ?? data.siteComputer?.online ?? data.agent?.online),
    automationState:
      data.automationState ??
      data.robotArm?.state ??
      data.machine?.state ??
      data.runningState ??
      "测试待命",
    safetyState:
      data.safetyState ??
      data.safety?.state ??
      (data.emergencyActive ? "急停已触发" : "正常"),
    updatedAt: data.updatedAt ?? data.lastHeartbeat ?? data.time ?? new Date().toISOString(),
  };
}

function renderStatus(status) {
  elements.serverState.textContent = status.serverOnline ? "代理在线" : "代理异常";
  elements.agentState.textContent = status.agentOnline ? "测试电脑在线" : "测试电脑离线";
  elements.automationState.textContent = status.automationState;
  elements.safetyState.textContent = status.safetyState;
  elements.lastUpdate.textContent = formatTime(status.updatedAt);
}

function normalizeFile(raw, index) {
  if (typeof raw === "string") {
    return {
      id: `file-${index}`,
      name: raw.split(/[\\/]/).pop() || raw,
      path: raw,
      type: inferType(raw),
      size: "",
      url: "",
      preview: "",
    };
  }

  return {
    id: raw.id ?? `file-${index}`,
    name: raw.name ?? raw.fileName ?? raw.path?.split(/[\\/]/).pop() ?? `文件 ${index + 1}`,
    path: raw.path ?? raw.fullPath ?? raw.name ?? "",
    type: raw.type ?? raw.kind ?? inferType(raw.name ?? raw.path ?? ""),
    size: raw.size ?? raw.bytes ?? "",
    url: raw.url ?? raw.downloadUrl ?? raw.previewUrl ?? "",
    preview: normalizePreview(raw.preview ?? raw.content ?? raw.text ?? ""),
    updatedAt: raw.updatedAt ?? raw.modifiedAt ?? "",
  };
}

function inferType(name) {
  if (/\.(log|txt|csv|json)$/i.test(name)) return "log";
  if (/\.(mp4|webm|m3u8|mov|avi)$/i.test(name)) return "video";
  return "file";
}

function renderFiles(files) {
  state.files = files;

  if (!files.length) {
    elements.fileList.innerHTML = '<div class="empty-state">当前目录没有可显示文件。</div>';
    return;
  }

  elements.fileList.innerHTML = files
    .map(
      (file, index) => `
        <button class="file-row" type="button" data-index="${index}">
          <span class="file-kind">${escapeHtml(file.type)}</span>
          <span class="file-name">${escapeHtml(file.name)}</span>
          <span class="file-size">${formatSize(file.size)}</span>
        </button>
      `,
    )
    .join("");
}

function renderPreview(file) {
  elements.previewTitle.textContent = file.name;
  elements.previewType.textContent = file.type;

  if (file.type === "video" && file.url) {
    elements.previewBox.innerHTML = `<video class="preview-video" src="${assetUrl(file.url)}" controls autoplay muted playsinline></video>`;
    return;
  }

  if (file.preview) {
    elements.previewBox.innerHTML = `<pre class="preview-text">${escapeHtml(file.preview)}</pre>`;
    return;
  }

  const link = file.url
    ? `<a href="${assetUrl(file.url)}" target="_blank" rel="noreferrer">打开或下载文件</a>`
    : "服务器未返回预览内容或下载地址";
  elements.previewBox.innerHTML = `<div class="preview-link">${link}</div>`;
}

function normalizePreview(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchStatus() {
  if (!elements.serverBase.value.trim()) {
    setConnection(false, "缺少服务器地址");
    return;
  }

  try {
    const response = await fetch(apiUrl(elements.statusPath), {
      method: "GET",
      headers: headers(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();
    setConnection(true);
    renderStatus(normalizeStatus(json));
  } catch (error) {
    setConnection(false, error.message.includes("Failed to fetch") ? "无法访问服务器" : error.message);
  }
}

async function fetchFiles() {
  if (!state.connected) return;
  saveConfig();
  elements.fileList.innerHTML = '<div class="empty-state">正在读取局域网电脑文件...</div>';

  try {
    const response = await fetch(apiUrl(elements.filesPath, { path: elements.remotePath.value }), {
      method: "GET",
      headers: headers(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();
    const data = json?.data && typeof json.data === "object" ? json.data : json;
    const files = Array.isArray(data.files) ? data.files : Array.isArray(data) ? data : [];
    renderFiles(files.map(normalizeFile));
  } catch (error) {
    elements.fileList.innerHTML = `<div class="empty-state">读取失败：${escapeHtml(error.message)}</div>`;
  }
}

async function sendDecision() {
  if (!state.connected) return;

  const payload = {
    type: elements.decisionType.value,
    target: elements.decisionTarget.value.trim(),
    value: elements.decisionValue.value.trim(),
    unit: elements.decisionUnit.value.trim(),
    reason: elements.decisionReason.value.trim(),
    requestedAt: new Date().toISOString(),
  };

  elements.decisionState.textContent = "正在下发";

  try {
    const response = await fetch(apiUrl(elements.decisionPath), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    elements.decisionState.textContent = "已下发";
    await fetchStatus();
  } catch (error) {
    elements.decisionState.textContent = `失败：${error.message}`;
  }
}

async function sendEmergencyStop() {
  if (!state.connected) return;
  const confirmed = window.confirm("确认触发紧急停止？该指令会写入局域网电脑代理的急停状态文件。");
  if (!confirmed) return;

  elements.emergencyButton.disabled = true;
  elements.emergencyButton.textContent = "急停发送中";

  try {
    const response = await fetch(apiUrl(elements.emergencyPath), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        action: "emergency_stop",
        reason: "operator_pressed_red_button",
        requestedAt: new Date().toISOString(),
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    elements.safetyState.textContent = "急停已触发";
    elements.decisionState.textContent = "急停指令已发送";
    await fetchStatus();
  } catch (error) {
    elements.decisionState.textContent = `急停失败：${error.message}`;
  } finally {
    elements.emergencyButton.textContent = "红色急停";
    elements.emergencyButton.disabled = !state.connected;
  }
}

function startPolling() {
  window.clearInterval(state.pollingTimer);
  state.pollingTimer = window.setInterval(fetchStatus, 2000);
}

function connectServer() {
  saveConfig();
  fetchStatus();
  startPolling();
}

elements.connectButton.addEventListener("click", connectServer);
elements.refreshFilesButton.addEventListener("click", fetchFiles);
elements.sendDecisionButton.addEventListener("click", sendDecision);
elements.emergencyButton.addEventListener("click", sendEmergencyStop);
elements.fileList.addEventListener("click", (event) => {
  const row = event.target.closest(".file-row");
  if (!row) return;
  const file = state.files[Number(row.dataset.index)];
  if (file) renderPreview(file);
});

[
  elements.serverBase,
  elements.statusPath,
  elements.filesPath,
  elements.decisionPath,
  elements.emergencyPath,
  elements.authToken,
  elements.remotePath,
].forEach((element) => element.addEventListener("change", saveConfig));

loadConfig();
setConnection(false);
