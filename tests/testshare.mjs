import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
// Sharing decks: the Deck editor's Share gives a deck code and a picture of the deck, a code pastes back into the
// Deck editor or the decklist box at setup, and after an online match each player can see the list the other played
// (unless the other turned sharing off in Profile).
const OUT = process.argv[2] || "shots-share";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-sh${n}`; fs.rmSync(prof, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: q } });
  const page = await app.firstWindow(); const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/40[034]|peerjs\.com|ERR_CONNECTION/.test(m.text())) errs.push(m.text()); });
  await page.setViewportSize({ width: 1400, height: 950 }).catch(() => {});
  await page.waitForLoadState("load"); await page.waitForTimeout(1500);
  return { app, page, errs };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(400); } return false; };
const deckA = ["OP05-003","OP05-004","OP05-006","OP05-007","OP05-009","OP05-010","OP05-011","OP05-013","OP05-015","OP05-016","OP05-017","OP05-018","OP05-019"].map(c => "4x" + c).join("\n").replace("4xOP05-019", "2xOP05-019");
const deckB = ["OP01-004","OP01-006","OP01-013","OP01-014","OP01-015","OP01-016","OP01-017","OP01-021","OP01-022","OP01-024","OP01-025","OP01-026","OP01-029"].map(c => "4x" + c).join("\n").replace("4xOP01-029", "2xOP01-029");
const A = await launch("a"), B = await launch("b");
for (const [x, nick, ld, d] of [[A, "Ryan", "OP05-001", deckA], [B, "Bea", "OP01-001", deckB]]) {
  await x.page.evaluate(([d, n, l]) => localStorage.setItem("nakama:setup", JSON.stringify({nick: n, leader: l, deck: d, life: 5})), [d, nick, ld]);
  await x.page.reload(); await x.page.waitForTimeout(1500);
}
const pg = A.page;

// the Deck editor's Share: a picture and a code
await pg.click('[data-do="homebuilder"]'); await wait(800);
await pg.evaluate(() => { const d = document.querySelector("#bd-paste").closest("details"); if (d) d.open = true; });
await pg.fill("#bd-paste", "1xOP05-001\n" + deckA);
await pg.click('[data-do="bdimport"]'); await wait(400);
await pg.fill("#bd-name", "Sabo test");
const before = await pg.evaluate(() => ({l: BD.leader && BD.leader.c, text: bdText(), n: bdTotal()}));
check(before.l === "OP05-001" && before.n === 50, "a 50-card deck is in the Deck editor");
await pg.click('[data-do="bdshare"]');
await pg.waitForSelector("#ds-img", { timeout: 15000 }).catch(() => {});
const sh = await pg.evaluate(() => { const im = document.querySelector("#ds-img"); return {w: im ? im.naturalWidth : 0, h: im ? im.naturalHeight : 0, code: document.querySelector("#ds-code").value, title: document.querySelector("#modal h2").textContent}; });
console.log("share", JSON.stringify({ w: sh.w, h: sh.h, code: sh.code.slice(0, 30) + "…", len: sh.code.length }));
check(sh.w === 1400 && sh.h > 400, "Share draws a picture of the deck");
check(/^BTCG1-[A-Za-z0-9_-]+$/.test(sh.code) && sh.code.length < 400, "Share gives a short deck code");
await pg.screenshot({ path: OUT + "/share.png" });
const dl = await pg.evaluate(() => new Promise(res => { const a0 = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { HTMLAnchorElement.prototype.click = a0; res(this.download); }; dsSave(); setTimeout(() => res(""), 4000); }));
check(dl === "bounty-sabo-test.png", "Save picture names the file after the deck");
await pg.evaluate(() => closeModal());

// the code pastes back into the Deck editor
await pg.evaluate(() => { BD.cards = new Map(); BD.leader = null; renderBdDeck(); });
await pg.fill("#bd-paste", "  " + sh.code + "\n");
await pg.click('[data-do="bdimport"]'); await wait(400);
const back = await pg.evaluate(() => ({l: BD.leader && BD.leader.c, text: bdText(), n: bdTotal()}));
check(back.l === before.l && back.n === 50 && back.text.replace(/ .*$/gm, "") === before.text.replace(/ .*$/gm, ""), "a deck code pastes back as the same deck");
// a broken code isn't taken
const bad = await pg.evaluate(() => [deckFromCode("BTCG1-AAAAAAAAAAAA"), deckFromCode("BTCG1-" + btoa("OP05-001|<img>*4")), deckFromCode("BTCG2-" + document.querySelector("#bd-paste").value.trim().slice(6)), deckFromCode("hello")]);
check(bad.every(x => x === null), "a broken or unknown code isn't read as a deck");
await pg.fill("#bd-paste", "BTCG1-AAAAAAAAAAAA");
await pg.click('[data-do="bdimport"]'); await wait(300);
check(await pg.evaluate(() => bdTotal() === 50 && /Paste a decklist first/.test(document.querySelector("#toast").textContent)), "pasting a broken code leaves the deck as it was");
await pg.evaluate(() => closeBuilder());

// the code in the decklist box when sitting down
await pg.evaluate(() => openSetup({}));
await wait(500);
await pg.fill("#f-leader", ""); await pg.fill("#f-deck", sh.code);
const cfg = await pg.evaluate(() => readDeckFields());
check(/^OP05-001\b/.test(cfg.leader) && (cfg.deck.match(/\n/g) || []).length === 12 && /^4xOP05-003/.test(cfg.deck), "a deck code in the decklist box fills in the Leader and the list");
await pg.evaluate(() => closeModal());

// after an online match each player sees the other's list
async function match(room) {
  for (const x of [A, B]) await x.page.evaluate(r => { sitAt(r, loadSaved()).then(() => { S.pubt = true; S.fmt = "std"; }); }, room);
  return until(async () => (await A.page.evaluate(() => !!oppM && !!S.statOpp)) && (await B.page.evaluate(() => !!oppM && !!S.statOpp)), 25000);
}
check(await match("share-test-1"), "both players sit down at the table");
await wait(1500);
check(await A.page.evaluate(() => !oppM.dl && !S.oppDl && !document.querySelector('[data-do="oppdeck"]')), "nobody's list is shown during the match");
await B.page.evaluate(() => { S.conceded = true; addLog("conceded the match"); commit(); render(); });
check(await until(() => A.page.evaluate(() => !!document.querySelector('#mid [data-do="oppdeck"]'))), "when the match ends the winner can see the loser's deck");
check(await until(() => B.page.evaluate(() => !!document.querySelector('#mid [data-do="oppdeck"]'))), "and the loser can see the winner's");
await A.page.click('#mid [data-do="oppdeck"]'); await wait(400);
const od = await A.page.evaluate(() => ({h: document.querySelector("#modal h2").textContent, n: document.querySelectorAll("#modal .tndeck span").length, ld: document.querySelector("#modal .tndeck b").textContent}));
console.log("their deck", JSON.stringify(od));
check(od.h === "Bea's deck" && od.n === 13 && /OP01-001/.test(od.ld), "the deck shows its Leader and every card");
await A.page.screenshot({ path: OUT + "/oppdeck.png" });
await A.page.click('[data-do="oppdeckopen"]'); await wait(800);
const ed = await A.page.evaluate(() => ({l: BD.leader && BD.leader.c, n: bdTotal(), has: BD.cards.has("OP01-016")}));
check(ed.l === "OP01-001" && ed.n === 50 && ed.has, "their list opens in the Deck editor");
await A.page.evaluate(() => closeBuilder());
const bSaw = await B.page.evaluate(() => S.oppDl && deckUnpack(S.oppDl.d));
check(bSaw && bSaw.l === "OP05-001" && bSaw.n === 50, "the loser got the winner's list");

// with sharing off, a player's list isn't sent
await B.page.evaluate(() => { openProfile(); const c = document.querySelector("#pf-share"); c.checked = false; c.dispatchEvent(new Event("change")); closeModal(); });
await wait(800);
check(await match("share-test-2"), "a second match starts");
await wait(1500);
await B.page.evaluate(() => { S.conceded = true; addLog("conceded the match"); commit(); render(); });
check(await until(() => B.page.evaluate(() => !!document.querySelector('#mid [data-do="oppdeck"]'))), "the player who shares still sends their list");
await wait(2500);
check(await A.page.evaluate(() => !!(oppM && oppM.cd) && !oppM.dl && !S.oppDl && !document.querySelector('[data-do="oppdeck"]')), "the player who turned sharing off doesn't send theirs");

const errs = [A, B].flatMap(x => x.errs);
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
for (const x of [A, B]) await x.app.close();
peer.kill();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
