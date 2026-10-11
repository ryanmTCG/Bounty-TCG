import { _electron as electron } from "playwright-core";
import { spawn } from "child_process";
import fs from "fs";
// Battle helper: the combat bar shows power against power, counters from hand add up, and resolving deals the result.
const openPlay = async p => { const b = await p.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await p.waitForTimeout(300); } };
const OUT = process.argv[2] || "shots-battle";
fs.mkdirSync(OUT, { recursive: true });
const peer = spawn("node", ["node_modules/peer/dist/bin/peerjs.js", "--port", "9000", "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const q = "?peerhost=127.0.0.1&peerport=9000&peersecure=0&peerpath=/";
async function launch(n) {
  const prof = `/tmp/bounty-prof-bt${n}`; fs.rmSync(prof, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"],
    env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: q } });
  const page = await app.firstWindow();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await page.waitForLoadState("load");
  return { app, page, errs };
}
const deck = ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"].map(c => "4x" + c).join("\n");
async function join(p, nick) {
  await openPlay(p); await p.click('[data-do="homejoin"]');
  await p.fill("#f-nick", nick);
  await p.fill("#f-room", "battle-room-1");
  await p.fill("#f-leader", "OP01-001");
  await p.fill("#f-deck", deck);
  await p.click('[data-do="join"]');
}
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const A = await launch(1), B = await launch(2);
await A.page.waitForTimeout(1500);
await join(A.page, "Ryan"); await join(B.page, "Friend");
await A.page.waitForTimeout(6000);
for (let i = 0; i < 12; i++) {
  for (const x of [A, B]) {
    const b = await x.page.$(".banner .btn.pri, .banner .btn");
    if (b) { await b.click().catch(() => {}); await x.page.waitForTimeout(700); }
  }
}
await A.page.waitForTimeout(1500);
// record the effects that pop up over the board
for (const x of [A, B]) await x.page.evaluate(() => { window.__fx = []; new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && (n.classList.contains("fxf") || n.classList.contains("fxsvg"))) window.__fx.push((n.getAttribute("class") || "") + "|" + (n.textContent || "")); }).observe(document.body, {childList: true, subtree: true}); });
const aTurn = await A.page.evaluate(() => S.myTurn);
const [atk, def] = aTurn ? [A, B] : [B, A];
// make sure the defender holds a 1000 counter card and know the leaders' power
const setup = await def.page.evaluate(() => {
  const code = [...CARDDB.keys()].find(k => /^OP01-/.test(k) && (CARDDB.get(k) || {}).ctr === 1000);
  S.hand.push({c: code, n: ""}); commit();
  return {code, ld: (CARDDB.get("OP01-001") || {}).p, hand: S.hand.length, trash: S.trash.length, life: S.life.length};
});
console.log("setup", JSON.stringify(setup));
await def.page.waitForTimeout(1500);
await atk.page.evaluate(() => attackWith("ld", "ld"));
await def.page.waitForTimeout(3000);
const d1 = await def.page.evaluate(() => ({mid: document.querySelector("#mid").textContent, ctrs: [...document.querySelectorAll("#mid .cmbctr")].map(b => b.textContent), res: (document.querySelector('#mid [data-do="dfresolve"]') || {}).textContent}));
console.log("defender", JSON.stringify(d1));
check(/5000 vs 5000/.test(d1.mid) && /You take 1 damage unless you add \+1000/.test(d1.mid), "defender sees the power check and what it takes to survive");
check(d1.ctrs.some(t => /^\+1000/.test(t)), "defender sees counter cards from hand");
check(d1.res === "Take 1 damage", "resolve button says what will happen");
const a1 = await atk.page.evaluate(() => document.querySelector("#mid").textContent);
check(/5000 vs 5000/.test(a1) && /Hits for 1 damage/.test(a1), "attacker sees the same power check");
await def.page.screenshot({ path: OUT + "/defender.png" });
await def.page.evaluate(() => [...document.querySelectorAll("#mid .cmbctr")].find(b => /^\+1000/.test(b.textContent)).click());
await def.page.waitForTimeout(2500);
const d2 = await def.page.evaluate(() => ({mid: document.querySelector("#mid").textContent, pm: S.leader.pm, bc: S.leader.bc, hand: S.hand.length, trash: S.trash.length}));
console.log("after counter", JSON.stringify(d2));
check(/5000 vs 6000/.test(d2.mid) && /You take no damage/.test(d2.mid) && /Counters \+1000/.test(d2.mid), "counter adds up on the defender");
check(d2.pm === 1000 && d2.bc === 1000 && d2.hand === setup.hand - 1 && d2.trash === setup.trash + 1, "counter card went from hand to trash");
const a2 = await atk.page.evaluate(() => document.querySelector("#mid").textContent);
check(/5000 vs 6000/.test(a2) && /Needs \+1000 more power/.test(a2), "attacker sees the counter live");
await atk.page.screenshot({ path: OUT + "/attacker.png" });
await def.page.click('#mid [data-do="dfresolve"]');
await def.page.waitForTimeout(2500);
const d3 = await def.page.evaluate(() => ({pm: S.leader.pm || 0, bc: S.leader.bc || 0, life: S.life.length, mid: document.querySelector("#mid").textContent}));
console.log("after resolve", JSON.stringify(d3));
check(d3.pm === 0 && d3.bc === 0 && d3.life === setup.life, "counter came off after the battle and no damage was taken");
const a3 = await atk.page.evaluate(() => ({atk: S.atk, mid: document.querySelector("#mid").textContent}));
check(!a3.atk && !/vs/.test(a3.mid), "attacker's combat bar cleared");
// second attack, no counter: resolving takes a Life card
await atk.page.evaluate(() => { S.leader.r = false; attackWith("ld", "ld"); });
await def.page.waitForTimeout(3000);
await def.page.click('#mid [data-do="dfresolve"]');
await def.page.waitForTimeout(2000);
const d4 = await def.page.evaluate(() => S.life.length);
check(d4 === setup.life - 1, "an unanswered hit takes 1 Life");
// a cancelled attack also takes counters back off
await atk.page.evaluate(() => { S.leader.r = false; attackWith("ld", "ld"); });
await def.page.waitForTimeout(3000);
await def.page.click('#mid [data-do="cmbcnt:2000"]');
await def.page.waitForTimeout(1500);
await atk.page.click('#mid [data-do="cmbdone"]');
await def.page.waitForTimeout(3000);
const d5 = await def.page.evaluate(() => ({pm: S.leader.pm || 0, bc: S.leader.bc || 0}));
check(d5.pm === 0 && d5.bc === 0, "cancelled attack takes counters back off");
// a K.O.: the defender has a small Character, the attacker's Leader beats it
await def.page.evaluate(() => { const code = [...CARDDB.keys()].find(k => /^OP01-/.test(k) && /Character/.test((CARDDB.get(k) || {}).t || "") && (CARDDB.get(k) || {}).p > 0 && CARDDB.get(k).p <= 3000); S.chars.push({card: {u: 999, c: code, n: ""}, r: false, d: 0}); commit(); });
await A.page.waitForTimeout(2000);
await atk.page.evaluate(() => { S.leader.r = false; attackWith("ld", "ch:0"); });
await def.page.waitForTimeout(3000);
await def.page.click('#mid [data-do="dfresolve"]');
await A.page.waitForTimeout(3000);
check(await def.page.evaluate(() => S.chars.length) === 0, "the beaten Character is K.O.'d");
// effects: the attack slash on both screens, the counter, and the Life lost on both screens
const fxA = await atk.page.evaluate(() => window.__fx), fxD = await def.page.evaluate(() => window.__fx);
console.log("fx", JSON.stringify(fxA), JSON.stringify(fxD));
check(fxA.some(f => /fxsvg/.test(f)) && fxD.some(f => /fxsvg/.test(f)), "attack slash shows on both screens");
check(fxD.some(f => /fxf ctr\|\+1000/.test(f)), "counter pops up on the defender");
check(fxD.some(f => /fxf ko\|K\.O\.!/.test(f)) && fxA.some(f => /fxf ko\|K\.O\.!/.test(f)), "K.O. shows on both screens");
check(fxD.some(f => /fxf dmg\|\u22121 Life/.test(f)) && fxA.some(f => /fxf dmg\|\u22121 Life/.test(f)), "Life lost shows on both screens");
// automatic start of turn: going first gets 1 DON!! and no draw; the other player then gets a card and 2 DON!! when the turn passes
const t1 = await atk.page.evaluate(() => ({don: S.donActive, deck: S.donDeck, hand: S.hand.length}));
check(t1.don === 1 && t1.deck === 9 && t1.hand === 5, "first turn added 1 DON!! and skipped the draw");
const before = await def.page.evaluate(() => ({hand: S.hand.length, deck: S.deck.length, don: S.donDeck}));
await atk.page.click('[data-do="endturn"]');
await def.page.waitForTimeout(3000);
const t2 = await def.page.evaluate(() => ({mine: S.myTurn, hand: S.hand.length, deck: S.deck.length, don: S.donDeck, active: S.donActive, toast: document.querySelector("#toast").textContent}));
console.log("turn 2", JSON.stringify(t2));
check(t2.mine && t2.hand === before.hand + 1 && t2.deck === before.deck - 1 && t2.don === before.don - 2 && t2.active === 2, "second player's turn drew 1 and added 2 DON!! by itself");
check(/drew 1 card and added 2 DON!!/.test(t2.toast), "the turn toast says what happened");
await def.page.click('[data-do="donturn"]'); await def.page.waitForTimeout(500);
check(await def.page.evaluate(() => S.donActive) === 2, "DON!! for turn doesn't add a second time");
// quick chat: a phrase from the menu shows up on the other player's screen and in the table log
check(await A.page.isVisible("#qcbtn"), "chat button shows in a match");
await A.page.click("#qcbtn"); await A.page.waitForTimeout(300);
await A.page.evaluate(() => [...document.querySelectorAll("#menu button")].find(b => /Good game/.test(b.textContent)).click());
await B.page.waitForTimeout(2500);
const qc = await B.page.evaluate(() => { const b = document.querySelector("#qcopp"); return {text: b && b.textContent, show: !!(b && b.classList.contains("show")), log: document.querySelector("#log") ? document.querySelector("#log").textContent : document.body.textContent}; });
console.log("chat", JSON.stringify({text: qc.text, show: qc.show}));
check(qc.show && qc.text === "Ryan: \u{1F389} Good game!", "opponent sees the message bubble");
check(/says \u201C\u{1F389} Good game!\u201D/u.test(qc.log), "message is in the table log");
await B.page.screenshot({ path: OUT + "/chat.png" });
console.log("errorsA", A.errs.slice(0, 5)); console.log("errorsB", B.errs.slice(0, 5));
await A.app.close(); await B.app.close(); peer.kill();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
