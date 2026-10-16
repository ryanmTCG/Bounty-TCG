import { _electron as electron, chromium } from "playwright-core";
import fs from "fs";
import path from "path";
// Links: bounty://deck/<code> and bounty://replay/<code> open in the game (the shell passes them on, shell 4), the share
// buttons copy an https link to docs/open.html, and that page sends the browser on to bounty://.
const OUT = process.argv[2] || "shots-link";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-link"; fs.rmSync(prof, { recursive: true, force: true });
const launch = extra => electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app", ...extra], env: { ...process.env, BOUNTY_PROFILE: prof } });
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(300); } return false; };
const deck = ["OP05-003","OP05-004","OP05-006","OP05-007","OP05-009","OP05-010","OP05-011","OP05-013","OP05-015","OP05-016","OP05-017","OP05-018","OP05-019"].map(c => "4x" + c).join("\n").replace("4xOP05-019", "2xOP05-019");
const errs = [];
const watch = page => { page.on("pageerror", e => errs.push(String(e))); page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]/.test(m.text())) errs.push(m.text()); }); };

// the deck share dialog's Copy link
let app = await launch([]), page = await app.firstWindow(); watch(page);
await page.waitForLoadState("load"); await wait(1500);
const code = await page.evaluate(d => deckCode({leader: "OP05-001", deck: d}), deck);
await page.click('[data-do="homebuilder"]'); await wait(600);
await page.evaluate(d => { bdImport("Leader: OP05-001\n" + d); renderBdDeck(); }, deck);
await page.evaluate(() => { window.__clip = ""; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
await page.click('[data-do="bdshare"]'); await page.waitForSelector('[data-do="dslink"]');
await page.click('[data-do="dslink"]'); await wait(300);
const link = await page.evaluate(() => window.__clip);
console.log("deck link", link.slice(0, 90) + "…");
check(link === "https://ryanmtcg.github.io/Bounty-TCG/open.html#d=" + code, "Copy link gives an https link holding the deck code");
// a replay's share copies a link too
await page.evaluate(() => rpCopyCode("abcdefgh")); await wait(300);
check(await page.evaluate(() => window.__clip === "https://ryanmtcg.github.io/Bounty-TCG/open.html#r=ABCD-EFGH"), "a replay code is copied as a link");
// a broken or hostile link does nothing
check(await page.evaluate(async () => { await openLink("bounty://deck/<img src=x>"); await openLink("https://example.com"); await openLink("bounty://deck/BTCG1-AAAAAAAAAAAA"); return /deck link is broken/.test(document.querySelector("#toast").textContent); }), "a broken link is turned away");
// a replay link looks the code up
await page.evaluate(async () => { closeModal(); closeBuilder(); window.__fetched = ""; const f = rpFetch; window.rpFetch = c => { window.__fetched = c; return Promise.resolve({err: "There's no replay with that code."}); }; await openLink("bounty://replay/ABCD-EFGH"); window.rpFetch = f; });
check(await page.evaluate(() => window.__fetched === "abcdefgh"), "a replay link opens that replay code");
await app.close();

// starting the app from a deck link opens the deck
app = await launch(["bounty://deck/" + code]); page = await app.firstWindow(); watch(page);
await page.waitForLoadState("load");
check(await until(() => page.evaluate(() => typeof BD !== "undefined" && !!BD.leader && BD.leader.c === "OP05-001" && bdTotal() === 50 && !!document.querySelector("#bd-deck"))), "starting the app from a deck link opens that deck in the Deck editor");
await page.screenshot({ path: OUT + "/opened.png" });
// a link clicked while the game is open goes to the open copy
await page.evaluate(() => { closeBuilder(); BD.cards = new Map(); BD.leader = null; });
const second = await launch(["bounty://deck/" + code]).catch(e => null);
check(await until(() => page.evaluate(() => !!BD.leader && bdTotal() === 50)), "a link opened while the game runs goes to the open game");
if (second) await second.close().catch(() => {});
await app.close();

// the https page sends the browser on to bounty://
const exe = fs.readdirSync("/opt/pw-browsers").find(d => /^chromium-\d+$/.test(d));
const br = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`, args: ["--no-sandbox"] });
const bp = await br.newPage(), tried = [];
bp.on("framenavigated", f => tried.push(f.url()));
await bp.route(/^bounty:/, r => { tried.push(r.request().url()); r.abort(); }).catch(() => {});
const file = "file://" + path.resolve("docs/open.html");
const look = async h => { await bp.goto("about:blank"); await bp.goto(file + h).catch(() => {}); await wait(600); return bp.evaluate(() => ({go: document.getElementById("go").getAttribute("href"), hidden: document.getElementById("go").hidden, t: document.getElementById("title").textContent, m: document.getElementById("manual").textContent})).catch(e => ({err: String(e)})); };
const r1 = await look("#r=ABCD-EFGH"), r2 = await look("#d=" + code), r3 = await look("#d=<script>alert(1)</script>");
console.log("page", JSON.stringify([r1, {go: r2.go && r2.go.slice(0, 40)}, r3]));
check(r1.go === "bounty://replay/ABCD-EFGH" && /Open a code and type ABCD-EFGH/.test(r1.m), "the link page opens a replay, and says how to type the code if nothing opens");
check(r2.go === "bounty://deck/" + code, "and a deck");
check(r3.hidden && r3.t === "This link is broken", "a broken link page goes nowhere");
await br.close();

console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
