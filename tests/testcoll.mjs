import { _electron as electron } from "playwright-core";
import fs from "fs";
import { startFakeFire } from "./fakefire.mjs";
// My collection: the Deck editor's collection mode sets how many of each card you own, a list or a whole deck can be
// added at once, the deck shows which cards it still needs (and copies them as a list), and signed in the collection
// is kept in the account.
const OUT = process.argv[2] || "shots-coll";
fs.mkdirSync(OUT, { recursive: true });
const fire = await startFakeFire(9101);
async function launch(n) {
  const prof = `/tmp/bounty-prof-coll${n}`; fs.rmSync(prof, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: "?fbtest=http://127.0.0.1:9101" } });
  const page = await app.firstWindow(); const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]/.test(m.text())) errs.push(m.text()); });
  await page.setViewportSize({ width: 1400, height: 950 }).catch(() => {});
  await page.waitForLoadState("load"); await page.waitForTimeout(1500);
  return { app, page, errs };
}
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(300); } return false; };
const deck = ["OP05-003","OP05-004","OP05-006","OP05-007","OP05-009","OP05-010","OP05-011","OP05-013","OP05-015","OP05-016","OP05-017","OP05-018","OP05-019"].map(c => "4x" + c).join("\n").replace("4xOP05-019", "2xOP05-019");
const A = await launch("a"), pg = A.page;
await pg.evaluate(() => window.bountyAccount.signUp("ryan@example.com", "secret1"));
await pg.reload(); await wait(1500);
const uid = await pg.evaluate(() => acctUid());
await pg.click('[data-do="homebuilder"]'); await wait(800);
await pg.evaluate(() => { const d = document.querySelector("#bd-paste").closest("details"); if (d) d.open = true; document.querySelector("#bd-coll").open = true; });
await pg.fill("#bd-paste", "1xOP05-001\n" + deck);
await pg.click('[data-do="bdimport"]'); await wait(400);
check(await pg.evaluate(() => bdTotal() === 50 && !document.querySelector("#bd-collchip")), "with no collection the deck shows nothing about it");

// collection mode: − and + set how many you own
await pg.check("#bd-collmode"); await wait(400);
await pg.fill("#bd-q", "OP05-004"); await pg.dispatchEvent("#bd-q", "input"); await wait(500);
const c0 = await pg.evaluate(() => ({lbl: (document.querySelector('#bd-lib .ownlbl') || {}).textContent, plus: !!document.querySelector('#bd-lib [data-bd="O+:OP05-004"]')}));
check(c0.lbl === "Own 0" && c0.plus, "collection mode shows how many you own, with − and +");
for (let i = 0; i < 3; i++) await pg.click('#bd-lib [data-bd="O+:OP05-004"]');
await pg.click('#bd-lib [data-bd="O-:OP05-004"]'); await wait(300);
const c1 = await pg.evaluate(() => ({own: COLL["OP05-004"], deck: BD.cards.get("OP05-004").count, lbl: document.querySelector('#bd-lib .ownlbl').textContent, ls: localStorage.getItem("bounty:coll"), chip: (document.querySelector("#bd-collchip") || {}).textContent, miss: document.querySelectorAll("#bd-deck .cmiss").length}));
console.log("owned", JSON.stringify(c1));
check(c1.own === 2 && c1.deck === 4 && c1.lbl === "Own 2" && c1.ls === "OP05-004*2", "it counts what you own without changing the deck");
check(c1.chip === "You need 49 more cards" && c1.miss === 13, "the deck says how many cards it still needs and marks them");
await pg.screenshot({ path: OUT + "/collmode.png" });

// a pasted list adds to the collection; the deck's own cards can be added at once
await pg.fill("#bd-collpaste", "4xOP05-003\n2 Sabo (OP05-001)"); await pg.click('[data-do="collimport"]'); await wait(300);
check(await pg.evaluate(() => COLL["OP05-003"] === 4 && COLL["OP05-001"] === 2 && /You need 44 more/.test(document.querySelector("#bd-collchip").textContent)), "a pasted list adds to what you own");
await pg.click('[data-do="collmiss"]'); await wait(300);
const need = await pg.evaluate(() => document.querySelector("#bd-collpaste").value);
check(/^2xOP05-004/m.test(need) && !/OP05-003/.test(need) && !/OP05-001/.test(need) && need.split("\n").length === 12, "Copy the cards I need lists only what's missing");
await pg.fill("#bd-collpaste", "");
await pg.click('[data-do="colldeck"]'); await wait(300);
check(await pg.evaluate(() => document.querySelector("#bd-collchip").textContent === "You own every card" && !document.querySelector("#bd-deck .cmiss") && COLL["OP05-004"] === 4 && COLL["OP05-001"] === 2), "I own this deck adds what's missing");
// only cards I own
await pg.uncheck("#bd-collmode"); await pg.fill("#bd-q", ""); await pg.dispatchEvent("#bd-q", "input"); await pg.check("#bd-ownonly"); await wait(500);
const only = await pg.evaluate(() => ({n: bdLast.codes.length, k: Object.keys(COLL).length, plus: !!document.querySelector('#bd-lib [data-bd="+:OP05-004"]')}));
check(only.n === only.k && only.plus, "Only cards I own lists just those, back to adding to the deck");
await pg.uncheck("#bd-ownonly");

// kept in the account
const cloud = await until(() => fire.docs.has(`data/users/${uid}/_coll`));
const saved = cloud ? fire.plain(fire.docs.get(`data/users/${uid}/_coll`)).c : "";
check(cloud && /OP05-004\*4/.test(saved) && saved.split(" ").length === 14, "signed in, the collection is saved to the account");
check(await pg.evaluate(() => DECKS.every(d => d.id !== "_coll")), "and doesn't show up as a saved deck");
const B = await launch("b");
await B.page.evaluate(() => window.bountyAccount.signIn("ryan@example.com", "secret1"));
await B.page.reload(); await wait(2500);
check(await B.page.evaluate(() => COLL["OP05-004"] === 4 && Object.keys(COLL).length === 14), "signing in on another computer brings it along");
// a broken or hostile list in the account is cleaned
check(await pg.evaluate(() => JSON.stringify(collUnpack("OP05-004*4 <img>*2 OP05-003*0 OP05-006*999 ST01-001*3"))) === '{"OP05-004":4,"ST01-001":3}', "only card numbers with sensible counts are read");

// clearing asks first
await pg.click('[data-do="collclear"]'); await wait(200);
await pg.click('#menu button:has-text("Clear it")'); await wait(300);
check(await pg.evaluate(() => !Object.keys(COLL).length && !document.querySelector("#bd-collchip") && localStorage.getItem("bounty:coll") === ""), "Clear my collection empties it");

const errs = [A, B].flatMap(x => x.errs);
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
for (const x of [A, B]) await x.app.close();
fire.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
