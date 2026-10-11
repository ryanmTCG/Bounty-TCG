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
  await openPlay(p); await p.click('[data-do="homefriends"]'); await p.click('[data-do="homejoin"]');
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
await atk.page.evaluate(() => (S.turn = Math.max(S.turn, 2), attackWith)("ld", "ld"));
await def.page.waitForTimeout(3000);
const d1 = await def.page.evaluate(() => ({mid: document.querySelector("#mid").textContent, ctrs: [...document.querySelectorAll("#mid .cmbctr")].map(b => b.textContent), res: (document.querySelector('#mid [data-do="dfresolve"]') || {}).textContent}));
console.log("defender", JSON.stringify(d1));
check(/5000 vs 5000/.test(d1.mid) && /You take 1 damage unless you add \+1000/.test(d1.mid), "defender sees the power check and what it takes to survive");
check(d1.ctrs.length === 0 && /Tap a Counter card in your hand/.test(d1.mid), "no counter buttons, just a hint to tap the hand");
check(d1.res === "Take 1 damage", "resolve button says what will happen");
const a1 = await atk.page.evaluate(() => document.querySelector("#mid").textContent);
check(/5000 vs 5000/.test(a1) && /Hits for 1 damage/.test(a1), "attacker sees the same power check");
await def.page.screenshot({ path: OUT + "/defender.png" });
await def.page.evaluate(() => openCardMenu("hand:" + S.hand.findIndex(c => (CARDDB.get(c.c) || {}).ctr === 1000), 300, 300));
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
await atk.page.evaluate(() => { S.leader.r = false; S.turn = Math.max(S.turn, 2); attackWith("ld", "ld"); });
await def.page.waitForTimeout(3000);
await def.page.click('#mid [data-do="dfresolve"]');
await def.page.waitForTimeout(2000);
const d4 = await def.page.evaluate(() => S.life.length);
check(d4 === setup.life - 1, "an unanswered hit takes 1 Life");
// an attack resolves once: the bar goes away and resolving again does nothing
check(await def.page.$('#mid [data-do="dfresolve"]') === null, "the defender bar closes after resolving");
await def.page.evaluate(() => defResolve(true)); await def.page.waitForTimeout(500);
check(await def.page.evaluate(() => S.life.length) === d4, "a resolved attack can't deal damage again");
check(await def.page.$('#mid [data-do^="cmbcnt"]') === null && (await A.page.$('#mid [data-do^="cmbcnt"]')) === null, "no free +power buttons when defending");
// a cancelled attack also takes counters back off
await atk.page.evaluate(() => { S.leader.r = false; S.turn = Math.max(S.turn, 2); attackWith("ld", "ld"); });
await def.page.waitForTimeout(3000);
await def.page.evaluate(() => { const code = [...CARDDB.keys()].find(k => (CARDDB.get(k) || {}).ctr === 2000); S.hand.push({u: 998, c: code, n: ""}); commit(); });
await def.page.waitForTimeout(800);
await def.page.evaluate(() => openCardMenu("hand:" + S.hand.findIndex(c => (CARDDB.get(c.c) || {}).ctr === 2000), 300, 300));
await def.page.waitForTimeout(1500);
await atk.page.click('#mid [data-do="cmbdone"]');
await def.page.waitForTimeout(3000);
const d5 = await def.page.evaluate(() => ({pm: S.leader.pm || 0, bc: S.leader.bc || 0}));
check(d5.pm === 0 && d5.bc === 0, "cancelled attack takes counters back off");
// a K.O.: the defender has a small Character, the attacker's Leader beats it
await def.page.evaluate(() => { const code = [...CARDDB.keys()].find(k => /^OP01-/.test(k) && /Character/.test((CARDDB.get(k) || {}).t || "") && (CARDDB.get(k) || {}).p > 0 && CARDDB.get(k).p <= 3000); S.chars.push({card: {u: 999, c: code, n: ""}, r: false, d: 0}); commit(); });
await A.page.waitForTimeout(2000);
// an active Character can't be attacked, and no one attacks on their first turn
const rule = await atk.page.evaluate(() => { const t0 = S.turn; S.turn = 1; S.leader.r = false; attackWith("ld", "ld"); const first = !S.atk; S.turn = Math.max(t0, 2); attackWith("ld", "ch:0"); const act = !S.atk; S.leader.r = false; return {first, act}; });
check(rule.first, "no attacks on your first turn");
check(rule.act, "an active Character can't be attacked");
// cards that let a card attack active Characters: OP04-090 by itself, OP01-021 with 1 DON!!, OP11-119 grants it
const grant = await atk.page.evaluate(async () => {
  const has = c => CARDDB.has(c);
  const f1 = {card: {c: "OP04-090"}, d: 0}, f2 = {card: {c: "OP01-021"}, d: 0}, f3 = {card: {c: "OP01-021"}, d: 1};
  const plain = {card: {u: 997, c: "OP01-001", n: ""}, r: false, d: 0};
  S.chars.push(plain);
  grantActiveAtk({c: "OP11-119"}, (EFX.get("OP11-119") || BFX.get("OP11-119") || {ab: []}).ab ? "[On Play] Up to 1 of your Characters can also attack active Characters during this turn." : "");
  await new Promise(r => setTimeout(r, 900));
  const menu = !!document.querySelector("#menu button");
  if (menu) [...document.querySelectorAll("#menu button")].find(b => b.textContent === lab(plain.card) || b.textContent.includes("OP01-001")).click();
  const out = {has: has("OP04-090") && has("OP01-021"), self: canHitActive(f1), don0: canHitActive(f2), don1: canHitActive(f3), granted: canHitActive(plain)};
  S.chars.splice(S.chars.indexOf(plain), 1); commit();
  return out;
});
console.log("active attack", JSON.stringify(grant));
check(grant.self && !grant.don0 && grant.don1, "cards that attack active Characters themselves work, with their DON!! need");
check(grant.granted, "an effect can let another card attack active Characters");
await def.page.evaluate(() => { S.chars[S.chars.length - 1].r = true; commit(); });
await A.page.waitForTimeout(2000);
await atk.page.evaluate(() => { S.leader.r = false; S.turn = Math.max(S.turn, 2); attackWith("ld", "ch:0"); });
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
// a room-code table is Friends only: Reset board, Refresh and Undo are there, and turns start by themselves (no Draw/DON!! for turn buttons)
const tools = await def.page.evaluate(() => ({shown: ["resetboard", "refresh", "undo"].filter(k => !document.querySelector(`[data-do="${k}"]`).hidden), turnBtns: !!document.querySelector('[data-do="drawturn"], [data-do="donturn"], #turn-auto'), pubt: !!S.pubt}));
console.log("tools", JSON.stringify(tools));
check(tools.shown.length === 3 && !tools.pubt, "a Friends only table has Reset board, Refresh and Undo");
check(!tools.turnBtns, "no Draw for turn, DON!! for turn or Auto start of turn switch");
// playing from hand takes as many active DON!! as the card costs; an effect can play one for free
const pay = await def.page.evaluate(() => {
  const ch = k => [...CARDDB.keys()].find(c => /^OP01-/.test(c) && /Character/.test((CARDDB.get(c) || {}).t || "") && (CARDDB.get(c) || {}).k === k);
  S.hand.push({c: ch(3), n: ""}, {c: ch(2), n: ""}); commit();
  const big = S.hand.length - 2, n0 = S.chars.length;
  moveCard("hand:" + big, "chars");
  const refused = {chars: S.chars.length - n0, hand: S.hand.length, don: S.donActive, toast: document.querySelector("#toast").textContent};
  moveCard("hand:" + (S.hand.length - 1), "chars");
  const paid = {chars: S.chars.length - n0, don: S.donActive, rested: S.donRested};
  openCardMenu("hand:" + (S.hand.length - 1), 200, 200);
  const free = [...document.querySelectorAll("#menu button")].find(b => /Play for free/.test(b.textContent));
  if (free) free.click();
  return {refused, paid, menu: !!free, after: {chars: S.chars.length - n0, don: S.donActive}, log: LOG.slice(-2).map(l => l.t || l.m || String(l))};
});
console.log("DON!! cost", JSON.stringify(pay));
check(pay.refused.chars === 0 && pay.refused.don === 2 && /costs 3, and you have 2 active DON!!/.test(pay.refused.toast), "a 3-cost card can't be played with 2 active DON!!");
check(pay.paid.chars === 1 && pay.paid.don === 0, "a 2-cost card rests both DON!!");
check(pay.menu && pay.after.chars === 2 && pay.after.don === 0, "Play for free plays it without DON!!");
// cards that cost less from hand: every such condition is understood, and ST33-004 gets cheaper once a card in hand is trashed this turn
const disc = await def.page.evaluate(() => {
  const unread = [];
  for (const [code] of BFX) for (const a of fxAb(code)) {
    const m = a.text.match(/^(?:If|During) (.+?), give this card in your hand [\u2212-](\d+) cost\.?$/);
    if (m && m[1].split(/,\s*|\s+and\s+(?=(?:you|your|the number)\b)/).map(costCond).includes(null)) unread.push(code);
  }
  S.hand.push({c: "ST33-004", n: ""}); commit();
  const before = handCost(S.hand[S.hand.length - 1]);
  moveCard("hand:0", "trash");
  const after = handCost(S.hand[S.hand.length - 1]);
  render();
  const badge = (document.querySelector(`#hand [data-src="hand:${S.hand.length - 1}"] .hcost`) || {}).textContent;
  S.donActive = 3; commit();
  moveCard("hand:" + (S.hand.length - 1), "chars");
  return {unread, before, after, badge, played: S.chars.some(f => f.card.c === "ST33-004"), don: S.donActive, log: LOG.slice(-1).map(l => l.m)};
});
console.log("cheaper from hand", JSON.stringify(disc));
check(disc.unread.length === 0, "every 'cheaper in your hand' condition is understood");
check(disc.before.cost === 6 && disc.after.cost === 3 && disc.badge === "3", "ST33-004 drops to 3 after a card in hand is trashed this turn, and the hand shows it");
check(disc.played && disc.don === 0, "ST33-004 plays for 3 DON!!");
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
// Life sits on the board: both sides show it, and tapping your own opens the Life actions
const lz = await A.page.evaluate(() => ({me: document.querySelectorAll("#me .lifez .lifecard").length, opp: document.querySelectorAll("#opp .lifez .lifecard").length, life: S.life.length, olife: oppM.lf, hand: document.querySelector("#oppHand").textContent}));
console.log("life zones", JSON.stringify(lz));
check(lz.me === lz.life && lz.opp === lz.olife && /hand/.test(lz.hand), "both Life zones and the opponent's hand show");
await A.page.click("#me .lifez"); await A.page.waitForTimeout(300);
check(await A.page.evaluate(() => [...document.querySelectorAll("#menu button")].some(b => /Take damage/.test(b.textContent))), "tapping your Life opens the Life actions");
await A.page.keyboard.press("Escape");
// smoother play: playable cards light up, tap to attack, the opponent's new card lights up, an attack you can't answer
// resolves by itself, effect wording picks the right cards, and E ends the turn
const glowN = await def.page.evaluate(async () => { S.donActive = 5; commit(); await new Promise(r => setTimeout(r, 300)); return {can: document.querySelectorAll("#hand .card.canplay").length, want: S.hand.filter(c => (handCost(c) || {cost: 99}).cost <= 5).length}; });
console.log("playable", JSON.stringify(glowN));
check(glowN.can > 0 && glowN.can === glowN.want, "hand cards your DON!! can pay for light up");
await def.page.evaluate(() => { S.leader.r = false; S.turn = Math.max(S.turn, 2); commit(); openCardMenu("ld", 300, 300); [...document.querySelectorAll("#menu button")].find(b => b.textContent === "Attack").click(); });
await def.page.waitForTimeout(300);
const lit = await def.page.evaluate(() => document.querySelectorAll("#opp .atkpick").length);
await def.page.click('#opp [data-atk="ld"]'); await def.page.waitForTimeout(300);
const tapAtk = await def.page.evaluate(() => S.atk && S.atk.t);
check(lit > 0 && tapAtk === "ld", "tap Attack, then tap the target, starts the attack");
await def.page.evaluate(() => doAction("cmbdone")); await def.page.waitForTimeout(2500);
await def.page.evaluate(() => { const i = S.hand.findIndex(c => (CARDDB.get(c.c) || {}).t === "Character"); moveCard("hand:" + i, "chars", true); });
await atk.page.waitForTimeout(1500);
check(await atk.page.evaluate(() => document.querySelectorAll("#opp .oppnew").length) > 0, "the opponent's new card lights up");
await atk.page.evaluate(() => { S.hand = S.hand.filter(c => !(CARDDB.get(c.c) || {}).ctr && !fxAb(c.c).some(a => a.t === "counter")); S.chars.forEach(f => f.r = true); commit(); });
await def.page.waitForTimeout(1500);
await def.page.evaluate(() => { S.leader.r = false; S.turn = Math.max(S.turn, 2); attackWith("ld", "ld"); });
await def.page.waitForTimeout(5000);
const qr = await def.page.evaluate(() => ({atk: !!S.atk}));
const qrLife = await atk.page.evaluate(() => S.life.length);
console.log("quick resolve", JSON.stringify(qr), qrLife);
check(!qr.atk, "an attack the defender can't answer resolves by itself");
const spec = await def.page.evaluate(() => { const nami = fxAb("OP01-016").map(a => lookSpec(a.text)).find(Boolean); return {n: nami && nami.n, bottom: nami && nami.bottom, zoro: nami && nami.pred("OP01-025"), nami: nami && nami.pred("OP01-016"), navy: nami && nami.pred("ST33-004")}; });
console.log("look spec", JSON.stringify(spec));
check(spec.n === 1 && spec.bottom && spec.zoro && !spec.nami && !spec.navy, "Nami's search only offers Straw Hat Crew cards other than Nami");
await def.page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", {key: "e", bubbles: true})));
await def.page.waitForTimeout(1500);
check(await def.page.evaluate(() => !S.myTurn), "E ends the turn");
console.log("errorsA", A.errs.slice(0, 5)); console.log("errorsB", B.errs.slice(0, 5));
await A.app.close(); await B.app.close(); peer.kill();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
