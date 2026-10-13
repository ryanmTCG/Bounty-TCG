import { _electron as electron } from "playwright-core";
import fs from "fs";
// Practice against the computer: it keeps a hand, takes its turns (plays Characters, gives DON!!, attacks),
// defends against your attacks, and hands the turn back. Runs offline: no PeerJS server is needed.
const OUT = process.argv[2] || "shots-bot";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-bot"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"],
  env: { ...process.env, BOUNTY_PROFILE: prof } });
const page = await app.firstWindow();
const errs = [];
page.on("pageerror", e => errs.push(String(e)));
await page.waitForLoadState("load");
await page.waitForTimeout(1500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const deck = ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"].map(c => "4x" + c).join("\n");

// Home > Play > Practice against the computer
{ const b = await page.$('[data-do="homeplay"]'); if (b && await b.isVisible()) { await b.click(); await page.waitForTimeout(300); } }
check(!!await page.$('[data-do="homebot"]'), "the Play page offers practice against the computer");
await page.click('[data-do="homebot"]');
await page.waitForTimeout(300);
check(await page.evaluate(() => document.querySelector('[data-do="vsbot"]').classList.contains("pri")), "setup highlights Play the computer");
await page.fill("#f-nick", "Ryan");
await page.fill("#f-leader", "OP01-001");
await page.fill("#f-deck", deck);
await page.click('[data-do="vsbot"]');
await page.waitForTimeout(800);
const st0 = await page.evaluate(() => ({bot: PR && PR.bot, me: S.nick, opp: oppM && oppM.nick, sw: document.querySelector("#pswitch").hidden, status: document.querySelector("#status").textContent, banner: document.querySelector("#banner").textContent}));
console.log("start", JSON.stringify(st0));
check(st0.bot === 1 && st0.me === "Ryan" && st0.opp === "Computer", "the table is you against the Computer");
check(st0.sw === true, "no Switch side button against the computer");
check(/against the computer/.test(st0.status) && /you or the computer/.test(st0.banner), "status and roll banner name the computer");

// roll until someone goes first; when you win, go first
await page.click('[data-do="prroll"]');
await page.waitForTimeout(400);
const roll = await page.evaluate(() => PR.roll);
console.log("roll", JSON.stringify(roll));
if (roll[0] > roll[1]) await page.click('[data-do="prfirst:0"]');
await page.waitForTimeout(2500);
const pre = await page.evaluate(() => ({order: PR.order, botKept: oppM && oppM.kp, first: S.first, log: LOG.map(e => e.who + ": " + e.m).join(" | ")}));
console.log("pre", JSON.stringify(pre));
check(!!pre.order, "the order is set" + (roll[0] < roll[1] ? " by the computer" : ""));
check(pre.botKept === 1, "the computer kept its hand by itself");
check(/goes first/.test(pre.log), "the log says who goes first");
await page.click('[data-do="keep"]');
await page.waitForTimeout(1500);

// play the match: on your turn attack the Leader with everything; on its turn resolve its attacks
const seen = {botTurn: false, botPlayed: 0, botDon: false, botAtk: 0, myTurnBack: 0, botDefended: 0, botCtr: false, botBlk: false, ended: ""};
let lastAk = null;
for (let step = 0; step < 400 && !seen.ended; step++) {
  const s = await page.evaluate(() => ({mine: S.myTurn, turn: S.turn, ak: oppM && oppM.ak ? oppM.ak.n : null, rs: S.rs, atk: S.atk ? S.atk.n : null, och: oppM ? oppM.ch.length : 0, odon: oppM ? (oppM.ld ? oppM.ld.d : 0) + oppM.ch.reduce((a, c) => a + (c.d || 0), 0) : 0, otn: oppM ? oppM.tn : 0, olf: oppM ? oppM.lf : 0, lf: S.life.length, done: S.conceded ? "lost" : oppM && oppM.cd ? "won" : "", modal: modal && modal.type, fx: !!fxCur}));
  if (s.done) { seen.ended = s.done; break; }
  if (s.otn > 0) seen.botTurn = true;
  seen.botPlayed = Math.max(seen.botPlayed, s.och);
  if (s.odon > 0) seen.botDon = true;
  // close anything a card effect opened (a Trigger offer, a search) so the match keeps going
  if (s.modal || s.fx) { await page.evaluate(() => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } if (modal && modal.type !== "home") closeModal(); closeMenu(); }).catch(() => {}); await page.waitForTimeout(300); continue; }
  if (s.ak != null && s.rs !== s.ak) {
    if (s.ak !== lastAk) { seen.botAtk++; lastAk = s.ak; }
    await page.evaluate(() => defResolve(true)); await page.waitForTimeout(400); continue;
  }
  if (s.mine && s.atk == null) {
    if (s.turn > 1 && !(await page.evaluate(() => S.leader.r))) {
      // give every active DON!! to the Leader and attack the computer's Leader
      const before = await page.evaluate(() => ({olf: oppM.lf, ohand: oppM.h}));
      await page.evaluate(() => { while (S.donActive > 0) moveDon({pool: "a"}, "ld"); attackWith("ld", "ld"); });
      await page.waitForTimeout(500);
      // the computer answers by itself after a short pause
      let n = 0, r = null;
      for (; n < 30; n++) { r = await page.evaluate(() => ({atk: S.atk, olf: oppM.lf, ohand: oppM.h, blk: oppM.bk, log: LOG.slice(-6).map(e => e.who + ": " + e.m).join(" | ")})); if (!r.atk) break; await page.waitForTimeout(250); }
      if (!r.atk) seen.botDefended++;
      if (/Counter on/.test(r.log)) seen.botCtr = true;
      if (/blocked with/.test(r.log)) seen.botBlk = true;
      console.log("my attack", JSON.stringify({before, after: {olf: r.olf, ohand: r.ohand}, waited: n, log: r.log}));
      continue;
    }
    await page.evaluate(() => endTurn()); seen.myTurnBack++;
    await page.waitForTimeout(600);
    continue;
  }
  await page.waitForTimeout(300);
}
const fin = await page.evaluate(() => ({log: LOG.filter(e => !e.mine).slice(-12).map(e => e.who + ": " + e.m), turn: S.turn, oturn: oppM.tn, lf: S.life.length, olf: oppM.lf}));
console.log("seen", JSON.stringify(seen));
console.log("final", JSON.stringify(fin));
await page.screenshot({ path: OUT + "/bot-board.png" });
check(seen.botTurn, "the computer took turns");
check(seen.botPlayed > 0, "the computer played Characters");
check(seen.botDon, "the computer gave DON!! to its cards");
check(seen.botAtk > 0, "the computer attacked");
check(seen.botDefended > 0, "the computer resolved your attacks by itself");
check(seen.myTurnBack > 2, "the turn came back to you after the computer's turns");
check(!!seen.ended, "the match played to the end (" + (seen.ended || "unfinished") + ")");
check(fin.log.every(l => l.startsWith("Computer")), "the computer's log lines carry its name");
// the computer's card abilities don't open anything on your side

// a fresh table to check how the computer defends: counters at low Life, and a Blocker that survives
await page.evaluate(() => { closeModal(); openSetup({bot: true}); });
await page.waitForTimeout(300);
await page.fill("#f-leader", "OP01-001");
await page.fill("#f-deck", deck);
await page.click('[data-do="vsbot"]');
await page.waitForTimeout(500);
await page.evaluate(() => { PR.roll = [6, 1]; practiceFirst(0); });
await page.waitForTimeout(2500);
await page.click('[data-do="keep"]');
await page.waitForTimeout(1000);
const prep = await page.evaluate(() => {
  const B = PR.sides[1].S, c2 = [...CARDDB.keys()].find(k => /^OP0/.test(k) && (CARDDB.get(k) || {}).ctr === 2000);
  B.life = B.life.slice(0, 1);
  B.hand = B.hand.filter(c => !(CARDDB.get(c.c) || {}).ctr); B.hand.push({c: c2, n: "", u: 99901});
  S.turn = 2; S.donActive = Math.max(S.donActive, 1); moveDon({pool: "a"}, "ld"); attackWith("ld", "ld");
  return {c2, my: S.myTurn};
});
let d1 = null;
for (let n = 0; n < 30; n++) { d1 = await page.evaluate(() => ({atk: !!S.atk, olf: oppM.lf, log: LOG.slice(-4).map(e => e.who + ": " + e.m).join(" | ")})); if (!d1.atk) break; await page.waitForTimeout(250); }
console.log("counter", JSON.stringify(prep), JSON.stringify(d1));
check(!d1.atk && d1.olf === 1 && /Computer: used .* as a \+2000 Counter/.test(d1.log) && /stopped OP01-001's attack/.test(d1.log), "at 1 Life the computer counters an attack it can stop");
const prep2 = await page.evaluate(() => {
  const B = PR.sides[1].S, bk = [...CARDDB.keys()].find(k => isBlocker(k) && (CARDDB.get(k) || {}).p >= 7000);
  B.chars.push({card: {c: bk, n: "", u: 99902}, r: false, d: 0, pt: 0});
  PR.pres[1] = JSON.parse(JSON.stringify((() => { practiceStash(); practiceLoad(1); const p = pubFull(); practiceStash(); practiceLoad(0); return p; })()));
  oppM = oppModel(PR.pres[1]); render();
  S.leader.r = false; attackWith("ld", "ld");
  return {bk};
});
let d2 = null;
for (let n = 0; n < 30; n++) { d2 = await page.evaluate(() => ({atk: !!S.atk, olf: oppM.lf, log: LOG.slice(-4).map(e => e.who + ": " + e.m).join(" | ")})); if (!d2.atk) break; await page.waitForTimeout(250); }
console.log("block", JSON.stringify(prep2), JSON.stringify(d2));
check(!d2.atk && d2.olf === 1 && /Computer: blocked with/.test(d2.log), "the computer blocks with a Blocker that survives the attack");
check(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" / ") : ""));
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
