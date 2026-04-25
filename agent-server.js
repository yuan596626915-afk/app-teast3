const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const host = process.env.LAN_AGENT_HOST || "0.0.0.0";
const port = Number(process.env.LAN_AGENT_PORT || 8787);
const dataRoot = path.resolve(process.env.LAN_AGENT_ROOT || path.join(__dirname, "lan-agent-data"));

const state = {
  automationState: "测试待命",
  safetyState: "正常",
  emergencyActive: false,
};

async function ensureDataRoot() {
  await fs.mkdir(path.join(dataRoot, "logs"), { recursive: true });
  await fs.mkdir(path.join(dataRoot, "videos"), { recursive: true });
  await fs.mkdir(path.join(dataRoot, "control"), { recursive: true });
  await fs.writeFile(path.join(dataRoot, "logs", "agent.log"), `[${new Date().toISOString()}] LAN agent started\n`, {
    flag: "a",
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function safePath(inputPath = "/") {
  const withoutDrive = String(inputPath).replace(/^[a-zA-Z]:/, "");
  const cleanInput = withoutDrive.startsWith("/") ? withoutDrive : `/${withoutDrive}`;
  const resolved = path.resolve(dataRoot, `.${cleanInput}`);
  if (!resolved.startsWith(dataRoot)) {
    throw new Error("Path is outside LAN agent data root");
  }
  return resolved;
}

function inferType(name) {
  if (/\.(log|txt|csv|json)$/i.test(name)) return "log";
  if (/\.(mp4|webm|m3u8|mov|avi)$/i.test(name)) return "video";
  return "file";
}

function publicFileUrl(filePath) {
  const relative = path.relative(dataRoot, filePath).replaceAll(path.sep, "/");
  return `/api/download?path=/${encodeURIComponent(relative).replaceAll("%2F", "/")}`;
}

async function listFiles(url) {
  const target = safePath(url.searchParams.get("path") || "/logs");
  const entries = await fs.readdir(target, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(target, entry.name);
    const stat = await fs.stat(filePath);
    const type = entry.isDirectory() ? "folder" : inferType(entry.name);
    const item = {
      name: entry.name,
      path: `/${path.relative(dataRoot, filePath).replaceAll(path.sep, "/")}`,
      type,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };

    if (type === "log") {
      const content = await fs.readFile(filePath, "utf8");
      item.preview = content.slice(-8000);
    }

    if (type === "video" || type === "file") {
      item.url = publicFileUrl(filePath);
    }

    files.push(item);
  }

  return { files };
}

async function sendDownload(url, response) {
  const target = safePath(url.searchParams.get("path") || "");
  const content = await fs.readFile(target);
  const type = inferType(target);
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": type === "video" ? "video/mp4" : "application/octet-stream",
  });
  response.end(content);
}

async function recordDecision(payload) {
  if (payload.type === "set_value") {
    const value = Number(payload.value);
    if (!Number.isFinite(value)) throw new Error("set_value requires a numeric value");
  }

  const record = { ...payload, receivedAt: new Date().toISOString() };
  if (payload.type === "pause") state.automationState = "人工暂停";
  if (payload.type === "resume") state.automationState = "测试待命";
  if (payload.type === "set_value") state.automationState = "目标值已写入";

  await fs.writeFile(path.join(dataRoot, "control", "last-decision.json"), JSON.stringify(record, null, 2));
  await fs.writeFile(path.join(dataRoot, "logs", "decisions.log"), `${JSON.stringify(record)}\n`, { flag: "a" });
}

async function recordEmergency(payload) {
  state.emergencyActive = true;
  state.safetyState = "急停已触发";
  state.automationState = "紧急停止";

  const record = { ...payload, receivedAt: new Date().toISOString() };
  await fs.writeFile(path.join(dataRoot, "control", "emergency-state.json"), JSON.stringify(record, null, 2));
  await fs.writeFile(path.join(dataRoot, "logs", "emergency.log"), `${JSON.stringify(record)}\n`, { flag: "a" });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/status") {
      sendJson(response, 200, {
        serverOnline: true,
        agentOnline: true,
        automationState: state.automationState,
        safetyState: state.safetyState,
        emergencyActive: state.emergencyActive,
        dataRoot,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/files") {
      sendJson(response, 200, await listFiles(url));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/download") {
      await sendDownload(url, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/decision") {
      await recordDecision(await readBody(request));
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/emergency-stop") {
      await recordEmergency(await readBody(request));
      sendJson(response, 200, { ok: true, emergencyActive: true });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

ensureDataRoot().then(() => {
  http.createServer(handleRequest).listen(port, host, () => {
    console.log(`LAN agent running at http://${host}:${port}`);
    console.log(`Data root: ${dataRoot}`);
  });
});
