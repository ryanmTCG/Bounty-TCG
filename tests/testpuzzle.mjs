import { _electron as electron } from "playwright-core";
import fs from "fs";
// The daily lethal puzzle: the same board for everyone on a date, one that can be won this turn, played against the
// computer, with a streak and achievements for solving it.
const OUT = process.argv[2] || "shots-puzzle";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-puzzle"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof } });
const page = await app.firstWindow(); const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]|raw\.githubusercontent|Failed to fetch|ERR_/.test(m.text())) errs.push(m.text()); });
await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
await page.waitForLoadState("load"); await page.waitForTimeout(3500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const wait = ms => page.waitForTimeout(ms);
// every day has a puzzle, the same one each time, and a winnable one
const days = await page.evaluate(() => {
  const out = {made: 0, ok: 0, same: JSON.stringify(pzMake("2026-10-18")) === JSON.stringify(pzMake("2026-10-18")), diff: JSON.stringify(pzMake("2026-10-18")) !== JSON.stringify(pzMake("2026-10-19")), rush: 0, trap: 0};
  for (let i = 0; i < 60; i++) { const d = new Date(Date.UTC(2026, 9, 1) + i * 864e5).toISOString().slice(0, 10), z = pzMake(d); if (!z) continue; out.made++; const s = pzSolve(z); if (s.ok && s.need >= 3) out.ok++; out[z.kind] = (out[z.kind] || 0) + 1; }
  return out;
});
console.log("days", JSON.stringify(days));
check(days.made === 60 && days.ok === 60, "every day has a puzzle that can be won this turn");
check(days.same && days.diff, "a date always gives the same puzzle, and the next day a new one");
check(days.rush > 0 && days.trap > 0 && days.tight > 0, "some need the Rush Character played, some are lost by playing it, and some need every DON!!");
// play one through
async function solve() {
  await page.evaluate(() => {
    const z = PZ.z;
    if (z.sol.rush && !z.sol.no) { const i = S.hand.findIndex(c => c.c === PZ_RUSH); moveCard("hand:" + i, "chars"); }
  });
  await wait(600);
  for (let k = 0; k < 8; k++) {
    const r = await page.evaluate(() => {
      if (PZ.done || (oppM && oppM.cd)) return "won";
      if (S.atk) return "busy";
      // the attacker that needs the least DON!! to reach 5000, among those that can still attack
      const can = [["ld", S.leader], ...S.chars.map((f, i) => ["ch:" + i, f])].filter(([s, f]) => !f.r && (s === "ld" || f.pt !== S.turn || f.card.c === PZ_RUSH));
      const need = ([s, f]) => Math.max(0, Math.ceil((5000 - (basePow(f.card.c) + (f.d || 0) * 1000)) / 1000));
      can.sort((a, b) => need(a) - need(b));
      const a = can[0]; if (!a || need(a) > S.donActive) return "stuck";
      for (let n = need(a); n > 0; n--) moveDon({pool: "a"}, a[0]);
      attackWith(a[0], "ld"); return "attacked";
    });
    if (r === "won") return true;
    if (r === "stuck") return false;
    for (let t = 0; t < 20; t++) { await wait(400); if (await page.evaluate(() => !S.atk || (oppM && oppM.cd))) break; }
  }
  await wait(1500);
  return page.evaluate(() => !!(PZ && (PZ.done || (oppM && oppM.cd))));
}
await page.evaluate(() => startPuzzle("2026-10-18")); await wait(1200);
const st = await page.evaluate(() => ({z: PZ.z, don: S.donActive, my: S.myTurn, turn: S.turn, olf: oppM.lf, och: oppM.ch.length, oh: oppM.h, tools: boardTools()}));
console.log("board", JSON.stringify({don: st.don, need: st.z.sol.need, life: st.z.life, blk: st.z.blk, mine: st.z.mine, hand: st.z.hand}));
check(st.my && st.don === st.z.don && st.olf === st.z.life && st.och === st.z.blk.length && st.oh === 0 && st.turn > 1, "the puzzle board is set: your turn, your DON!!, the computer's Life and Blockers and no hand");
check(!st.tools && await page.evaluate(() => !hintOk()), "the free board tools and coach hints are off");
await page.screenshot({ path: OUT + "/board.png" });
// giving up: ending the turn doesn't hand it to the computer
await page.evaluate(() => doAction("endturn")); await wait(500);
const f = await page.evaluate(() => ({h: $("#modal h2") && $("#modal h2").textContent, my: S.myTurn}));
check(f.h === "Not this time" && f.my, "ending the turn without winning says so and the computer doesn't play");
await page.click('#modal [data-do="pzretry"]'); await wait(1200);
check(await page.evaluate(() => S.donActive === PZ.z.don && !S.leader.r), "Try again sets the board up again");
const won = await solve();
await wait(1500);
const w = await page.evaluate(() => ({h: $("#modal h2") && $("#modal h2").textContent, k: JSON.parse(localStorage.getItem("bounty:pz") || "{}"), ach: !!STATS.ach.pz1}));
console.log("result", won, JSON.stringify(w));
check(won && w.h === "Solved!" && w.k.d === "2026-10-18" && w.k.s === 1 && w.ach, "the right line wins it, counts the day and earns Sharp eye");
await page.screenshot({ path: OUT + "/solved.png" });
// a streak counts days in a row
await page.evaluate(() => { localStorage.setItem("bounty:pz", JSON.stringify({d: "2026-10-18", s: 6, n: 6})); closeModal(); }); 
await page.evaluate(() => startPuzzle("2026-10-19")); await wait(1200);
check(await solve(), "the next day's puzzle can be won too");
await wait(1500);
const k2 = await page.evaluate(() => ({k: JSON.parse(localStorage.getItem("bounty:pz") || "{}"), ach: !!STATS.ach.pz7}));
check(k2.k.s === 7 && k2.ach, "seven days in a row earns Puzzle week");
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
