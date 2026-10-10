// Checks the updater against a local stand-in for GitHub: a good update installs and is used on the
// next launch, a bad checksum is refused, and an update that needs a newer shell asks for a download.
//   python3 tools/build.py && xvfb-run -a node tests/testupdate.mjs
import { _electron as electron } from "playwright-core";
import http from "http";
import fs from "fs";
import zlib from "zlib";
import crypto from "crypto";
import path from "path";

const APP = "dist/kit/app", WEB = APP + "/web";
const wait = ms => new Promise(r => setTimeout(r, ms));
let served = {};
const server = http.createServer((req, res) => {
  const body = served[req.url.slice(1)];
  if (body === undefined) { res.writeHead(404); res.end(); return; }
  res.writeHead(200); res.end(body);
}).listen(9100, "127.0.0.1");

function makeUpdate(version, { shell = 2, badSha = false } = {}) {
  const files = {};
  const walk = d => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) walk(f); else files[path.relative(WEB, f).replace(/\\/g, "/")] = fs.readFileSync(f); } };
  walk(WEB);
  delete files["static/don.png"]; delete files["static/sleeve.png"]; delete files["static/dondeck.jpg"];
  files["index.html"] = Buffer.from(files["index.html"].toString().replace("<title>Bounty TCG</title>", `<title>Bounty TCG</title><meta name="bounty-test" content="${version}">`));
  files["version.json"] = Buffer.from(JSON.stringify({ version, shell }));
  const b64 = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString("base64")]));
  const data = zlib.gzipSync(JSON.stringify({ version, files: b64 }));
  const bundle = `web-${version}.json.gz`;
  const sha = crypto.createHash("sha256").update(data).digest("hex");
  served = { [bundle]: data, "latest.json": JSON.stringify({ version, shell, bundle, sha256: badSha ? "0".repeat(64) : sha, size: data.length, notes: "Test update." }) };
}
async function launch(prof) {
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", APP],
    env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_UPDATE_URL: "http://127.0.0.1:9100/" } });
  const page = await app.firstWindow();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.waitForLoadState("load");
  return { app, page, errs };
}
const look = p => p.evaluate(async () => ({
  marker: (document.querySelector('meta[name="bounty-test"]') || {}).content || "",
  version: (await (await fetch("version.json")).json()).version,
  don: (await fetch("/_blob/621dd934e12d43b3703a3254ac86e6f1")).status,
  bar: (document.querySelector("#bounty-update") || {}).innerText || "",
  state: await bountyDesktop.updateState()
}));

// 1. a good update downloads, then is used from the next launch
const prof = "/tmp/bounty-prof-upd"; fs.rmSync(prof, { recursive: true, force: true });
makeUpdate("99.0.1");
let A = await launch(prof);
await wait(7000);
console.log("first launch", JSON.stringify(await look(A.page)));
console.log("active.json", fs.readFileSync(prof + "/updates/active.json", "utf8"), fs.readdirSync(prof + "/updates"));
await A.page.screenshot({ path: "dist/update-ready.png" });
await A.app.close();
A = await launch(prof);
await wait(6000);
console.log("second launch", JSON.stringify(await look(A.page)));
await A.page.evaluate(() => bountyDesktop.checkForUpdate());
await wait(500);
console.log("manual check toast", await A.page.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden ? t.textContent : ""; }));
// a newer one replaces it and the old folder is cleaned up
makeUpdate("99.0.2");
await A.page.evaluate(() => bountyDesktop.checkForUpdate());
await wait(2500);
console.log("99.0.2 while running 99.0.1", JSON.stringify(await look(A.page)), fs.readdirSync(prof + "/updates"));
console.log("errors", JSON.stringify(A.errs));
await A.app.close();

// 2. a download that doesn't match its checksum is refused
const prof2 = "/tmp/bounty-prof-upd2"; fs.rmSync(prof2, { recursive: true, force: true });
makeUpdate("99.0.3", { badSha: true });
A = await launch(prof2);
await wait(7000);
console.log("bad checksum", JSON.stringify(await look(A.page)), fs.existsSync(prof2 + "/updates/active.json"));
await A.app.close();

// 3. an update that needs a newer shell asks for a fresh download
makeUpdate("2.0.0", { shell: 3 });
A = await launch(prof2);
await wait(7000);
console.log("needs shell 3", JSON.stringify(await look(A.page)));
await A.page.screenshot({ path: "dist/update-download.png" });
await A.app.close();

// 4. no update server at all: the game still starts normally
served = {};
A = await launch(prof2);
await wait(6000);
console.log("offline", JSON.stringify(await look(A.page)));
console.log("errors", JSON.stringify(A.errs));
await A.app.close();
server.close();
