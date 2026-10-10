// Bounty TCG desktop shell: serves the game from app://bounty/ and stands in
// for the claude.ai services (card art files, saved uploads, card reading).
// It also keeps the game up to date from the GitHub repository (see "updates" below).
const { app, BrowserWindow, protocol, net, ipcMain, Menu, shell, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const Anthropic = require("@anthropic-ai/sdk").default;

const APP_DIR = __dirname;
const WEB_DIR = path.join(APP_DIR, "web");
// Raise SHELL_VERSION whenever main.js or preload.js change. An update that needs a newer shell
// than this one asks the player to download the full app instead of installing itself.
const SHELL_VERSION = 2;
const UPDATE_URL = process.env.BOUNTY_UPDATE_URL || "https://raw.githubusercontent.com/ryanmTCG/Bounty-TCG/main/updates/";
const DOWNLOAD_PAGE = "https://github.com/ryanmTCG/Bounty-TCG";
const STATIC_BLOBS = {
  "621dd934e12d43b3703a3254ac86e6f1": "static/don.png",
  "5007a88060d94cddba918a54d7623a4d": "static/sleeve.png",
  "b036544e3d3c22722ee091f688ffa3e1": "static/dondeck.jpg"
};

protocol.registerSchemesAsPrivileged([{
  scheme: "app",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

// Steam (and a portable copy) can put the card folder next to the .exe instead of inside the app.
function cardsDir() {
  const tries = [
    path.join(APP_DIR, "cards"),
    path.join(process.resourcesPath || APP_DIR, "cards"),
    path.join(path.dirname(process.execPath), "cards")
  ];
  return tries.find(d => fs.existsSync(d)) || tries[0];
}
const uploadsDir = () => path.join(app.getPath("userData"), "art");
const keyFile = () => path.join(app.getPath("userData"), "claude-key.bin");
const isId = s => /^[0-9a-f]{8,64}$/i.test(s);
const isCode = s => /^[A-Z0-9]{1,8}-[A-Z0-9]{1,6}$/i.test(s);

function fileResponse(file) {
  return net.fetch(pathToFileURL(file).toString());
}

// ---------- updates ----------
// updates/latest.json in the repository names the newest game version and a gzipped bundle of its web
// files. A newer version is downloaded into <userData>/updates/web-<version>, checked against its
// SHA-256, and used from the next launch. Files an update leaves out (card art, the DON!! images)
// still come from the copy that shipped with the app.
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const vparts = v => String(v).split(".").map(n => parseInt(n, 10) || 0);
function newer(a, b) {
  const x = vparts(a), y = vparts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } }
const BUNDLED = readJson(path.join(WEB_DIR, "version.json")) || { version: "1.0.0" };
const updatesDir = () => path.join(app.getPath("userData"), "updates");
let web = { dir: WEB_DIR, version: BUNDLED.version };
function pickWeb() {
  const a = readJson(path.join(updatesDir(), "active.json"));
  if (a && VERSION_RE.test(a.version) && (a.shell || 1) <= SHELL_VERSION && newer(a.version, BUNDLED.version)) {
    const dir = path.join(updatesDir(), "web-" + a.version);
    if (fs.existsSync(path.join(dir, "index.html"))) return { dir, version: a.version };
  }
  return { dir: WEB_DIR, version: BUNDLED.version };
}
// a game file: from the installed update first, then from the copy that shipped with the app
function webFile(rel) {
  for (const base of web.dir === WEB_DIR ? [WEB_DIR] : [web.dir, WEB_DIR]) {
    const f = path.normalize(path.join(base, rel));
    if (f.startsWith(base + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

let updateState = { state: "idle", version: "" };
function setUpdate(s) {
  updateState = Object.assign({ current: web.version }, s);
  if (win && !win.isDestroyed()) win.webContents.send("ui:update", updateState);
}
async function fetchUpdateFile(name) {
  const res = await net.fetch(UPDATE_URL + name, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + name);
  return Buffer.from(await res.arrayBuffer());
}
function pruneUpdates(keep) {
  try {
    for (const n of fs.readdirSync(updatesDir())) {
      if (!/^web-/.test(n)) continue;
      const v = n.slice(4).replace(/\.part$/, "");
      if (n.endsWith(".part") || (v !== keep && v !== web.version)) fs.rmSync(path.join(updatesDir(), n), { recursive: true, force: true });
    }
  } catch (e) {}
}
async function checkForUpdate(manual) {
  if (updateState.state === "checking") return;
  setUpdate({ state: "checking", manual: !!manual });
  try {
    const m = JSON.parse((await fetchUpdateFile("latest.json")).toString("utf8"));
    if (!m || !VERSION_RE.test(m.version) || !/^[0-9a-f]{64}$/.test(m.sha256 || "") || !/^web-[\w.-]+\.json\.gz$/.test(m.bundle || "")) throw new Error("The update list didn't look right.");
    const notes = String(m.notes || "").slice(0, 300);
    if (!newer(m.version, web.version)) return setUpdate({ state: "current", version: web.version, manual: !!manual });
    if ((m.shell || 1) > SHELL_VERSION) return setUpdate({ state: "needs-download", version: m.version, notes, url: DOWNLOAD_PAGE, manual: !!manual });
    const dir = path.join(updatesDir(), "web-" + m.version);
    if (!fs.existsSync(path.join(dir, "index.html"))) {
      const buf = await fetchUpdateFile(m.bundle);
      if (crypto.createHash("sha256").update(buf).digest("hex") !== m.sha256) throw new Error("The download didn't match its checksum, so it wasn't used.");
      const bundle = JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
      const files = bundle && bundle.files;
      if (!files || typeof files !== "object" || typeof files["index.html"] !== "string") throw new Error("The download was missing the game.");
      const tmp = dir + ".part";
      fs.rmSync(tmp, { recursive: true, force: true });
      for (const [rel, b64] of Object.entries(files)) {
        if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(rel) || typeof b64 !== "string") throw new Error("The download had a bad file name.");
        const f = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, Buffer.from(b64, "base64"));
      }
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
    }
    fs.writeFileSync(path.join(updatesDir(), "active.json"), JSON.stringify({ version: m.version, shell: m.shell || 1 }));
    pruneUpdates(m.version);
    setUpdate({ state: "ready", version: m.version, notes, manual: !!manual });
  } catch (err) {
    setUpdate({ state: "error", message: String(err && err.message || err).slice(0, 200), manual: !!manual });
  }
}
ipcMain.handle("update:state", () => updateState);
ipcMain.handle("update:check", () => checkForUpdate(true));
ipcMain.handle("update:restart", () => { if (updateState.state === "ready") { app.relaunch(); app.exit(0); } });

function handleApp(request) {
  const url = new URL(request.url);
  let p = decodeURIComponent(url.pathname);
  const blob = p.match(/^\/_blob\/([^/]+)$/);
  if (blob) {
    const id = blob[1];
    if (STATIC_BLOBS[id]) { const f = webFile(STATIC_BLOBS[id]); return f ? fileResponse(f) : new Response("", { status: 404 }); }
    if (id.startsWith("card_") && isCode(id.slice(5))) {
      const f = path.join(cardsDir(), id.slice(5) + ".webp");
      if (fs.existsSync(f)) return fileResponse(f);
      return new Response("", { status: 404 });
    }
    if (isId(id)) {
      const f = path.join(uploadsDir(), id);
      if (fs.existsSync(f)) {
        let type = "image/webp";
        try { type = fs.readFileSync(f + ".type", "utf8") || type; } catch (e) {}
        return new Response(fs.readFileSync(f), { headers: { "Content-Type": type, "Cache-Control": "no-cache" } });
      }
    }
    return new Response("", { status: 404 });
  }
  if (p === "/" || p === "") p = "/index.html";
  const f = webFile(p.replace(/^\/+/, ""));
  if (!f) return new Response("", { status: 404 });
  return fileResponse(f);
}

// ---------- IPC ----------
ipcMain.handle("cards:list", () => {
  try { return fs.readdirSync(cardsDir()).filter(n => n.endsWith(".webp")).map(n => n.slice(0, -5)).filter(isCode); }
  catch (e) { return []; }
});
ipcMain.handle("art:put", (_e, id, bytes, type) => {
  if (!isId(id)) throw new Error("bad id");
  fs.mkdirSync(uploadsDir(), { recursive: true });
  fs.writeFileSync(path.join(uploadsDir(), id), Buffer.from(bytes));
  fs.writeFileSync(path.join(uploadsDir(), id + ".type"), String(type || "image/webp"));
  return true;
});
ipcMain.handle("art:delete", (_e, id) => {
  if (!isId(id)) return false;
  for (const f of [id, id + ".type"]) { try { fs.unlinkSync(path.join(uploadsDir(), f)); } catch (e) {} }
  return true;
});
ipcMain.handle("art:list", () => {
  try {
    return fs.readdirSync(uploadsDir()).filter(isId).map(id => {
      const f = path.join(uploadsDir(), id);
      let type = "image/webp"; try { type = fs.readFileSync(f + ".type", "utf8"); } catch (e) {}
      return { id, sizeBytes: fs.statSync(f).size, contentType: type };
    });
  } catch (e) { return []; }
});

function readKey() {
  try {
    const buf = fs.readFileSync(keyFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
  } catch (e) { return ""; }
}
ipcMain.handle("key:has", () => !!readKey());
ipcMain.handle("key:set", (_e, key) => {
  key = String(key || "").trim();
  if (!key) { try { fs.unlinkSync(keyFile()); } catch (e) {} return false; }
  fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
  fs.writeFileSync(keyFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, "utf8"));
  return true;
});

// Card reading: the game asks for JSON about one or more card pictures.
const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
ipcMain.handle("sample:json", async (_e, prompt, images) => {
  const apiKey = readKey();
  if (!apiKey) return { error: { code: "no_key", message: "No Claude API key is set." } };
  const client = new Anthropic({ apiKey });
  const content = (images || []).filter(im => MEDIA.has(im.type)).map(im => ({
    type: "image", source: { type: "base64", media_type: im.type, data: im.b64 }
  }));
  content.push({ type: "text", text: String(prompt) + "\n\nReply with only the JSON, no other text." });
  try {
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }]
    });
    if (msg.stop_reason === "refusal") return { error: { code: "image_rejected", message: "The card reader declined this picture." } };
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
    const m = text.match(/[\[{][\s\S]*[\]}]/);
    if (!m) return { error: { code: "bad_reply", message: "No JSON in the reply." } };
    return { value: JSON.parse(m[0]) };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { error: { code: "rate_limited", message: err.message } };
    if (err instanceof Anthropic.AuthenticationError) return { error: { code: "not_granted", message: "The Claude API key was rejected." } };
    if (err instanceof Anthropic.APIError) return { error: { code: "api_error", message: err.message } };
    if (err instanceof SyntaxError) return { error: { code: "bad_reply", message: err.message } };
    return { error: { code: "error", message: String(err && err.message || err) } };
  }
});

// ---------- window ----------
let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 900, minHeight: 600,
    backgroundColor: "#04202F", title: "Bounty TCG", show: false,
    icon: path.join(WEB_DIR, "static", "icon.png"),
    webPreferences: { preload: path.join(APP_DIR, "preload.js"), contextIsolation: true, sandbox: true, spellcheck: false }
  });
  win.once("ready-to-show", () => { win.maximize(); win.show(); setTimeout(() => checkForUpdate(false), 4000); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("app://")) e.preventDefault(); });
  win.loadURL("app://bounty/index.html" + (process.env.BOUNTY_QUERY || ""));
}

function buildMenu() {
  const template = [
    { label: "Game", submenu: [
      { label: "Bounty TCG " + web.version, enabled: false },
      { label: "Check for updates", click: () => checkForUpdate(true) },
      { type: "separator" },
      { label: "Card reading (Claude API key)…", click: () => win && win.webContents.send("ui:key") },
      { type: "separator" },
      { role: "reload" },
      { role: "togglefullscreen" },
      { type: "separator" },
      { role: "quit" }
    ] },
    { label: "View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "toggleDevTools" }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (process.env.BOUNTY_PROFILE) app.setPath("userData", process.env.BOUNTY_PROFILE);
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  web = pickWeb();
  protocol.handle("app", handleApp);
  buildMenu();
  createWindow();
});
app.on("window-all-closed", () => app.quit());
