import { _electron as electron } from "playwright-core";
import fs from "fs";
// Weekly challenges: three a week, the same for everyone, counted from finished games, a badge for each.
const OUT = process.argv[2] || "shots-weekly";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-weekly"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof } });
const page = await app.firstWindow(); const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]|raw\.githubusercontent|Failed to fetch|ERR_/.test(m.text())) errs.push(m.text()); });
await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
await page.waitForLoadState("load"); await page.waitForTimeout(3500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const wait = ms => page.waitForTimeout(ms);

check(await page.evaluate(() => wkKey(Date.UTC(2026, 9, 18, 12)) === "2026w42" && wkKey(Date.UTC(2026, 9, 19, 1)) === "2026w43" && wkKey(Date.UTC(2027, 0, 1)) === "2026w53" && wkKey(Date.UTC(2026, 0, 1)) === "2026w01"), "weeks are ISO weeks in UTC");
const picks = await page.evaluate(() => { const out = []; for (let i = 1; i <= 52; i++) { const k = "2026w" + String(i).padStart(2, "0"), p = wkPick(k).map(c => c[0]); out.push({k, p, same: wkPick(k).map(c => c[0]).join() === p.join()}); } return out; });
check(picks.every(x => x.same && new Set(x.p).size === 3 && x.p.filter(id => /^c[a-z]{3,}$/.test(id)).length <= 1), "every week has 3 different challenges, at most one color, and the same pick each time");
check(new Set(picks.flatMap(x => x.p)).size >= 12, "the weeks use most of the pool");

// a week with a color challenge, "play 5" and the puzzle: find one and use it
const wk = picks.find(x => x.p.includes("play5") && x.p.some(id => /^c[a-z]{3,}$/.test(id))) || picks[0];
console.log("week", JSON.stringify(wk));
await page.evaluate(k => { window.__k = k; wkKey = () => k; }, wk.k);
const red = "OP01-001";   // Zoro: Red
const res = await page.evaluate(() => {
  const w = wkCur(), ids = wkPick(w.k).map(c => c[0]);
  for (let i = 0; i < 4; i++) wkGame({won: false, mode: "bot", lv: 1, ld: "OP01-001", deck: "4xOP01-013"});
  const p4 = Object.assign({}, STATS.wk.p);
  wkGame({won: false, mode: "friends", ld: "OP01-001", deck: "4xOP01-013"});
  return {ids, p4, p5: Object.assign({}, STATS.wk.p), wb: STATS.wb.slice(), toast: $("#toast").textContent};
});
console.log("progress", JSON.stringify(res));
if (wk.p.includes("play5")) check(res.p4.play5 === 4 && res.wb.includes(wk.k + ":play5") && /Weekly challenge done: Play 5 matches/.test(res.toast), "play 5 counts every finished game and gives a badge on the fifth, with a toast");
const again = await page.evaluate(() => { wkGame({won: true, mode: "bot", lv: 1, ld: "OP01-001", deck: ""}); return STATS.wb.filter(b => b.endsWith(":play5")).length; });
check(again <= 1, "a finished challenge isn't counted twice");

// the color challenge only counts wins with that color's Leader
const col = wk.p.find(id => /^c[a-z]{3,}$/.test(id));
if (col) {
  const r2 = await page.evaluate(c => {
    const colOf = {cred: "OP01-001", cgreen: "OP01-031", cblue: "OP01-060", cpurple: "OP01-061", cblack: "OP01-091", cyellow: "OP02-001"};
    const other = c === "cred" ? "OP01-060" : "OP01-001";
    wkGame({won: true, mode: "bot", lv: 0, ld: other, deck: ""});
    const a = STATS.wk.p[c] || 0;
    wkGame({won: false, mode: "bot", lv: 0, ld: colOf[c], deck: ""});
    const b = STATS.wk.p[c] || 0;
    wkGame({won: true, mode: "bot", lv: 0, ld: colOf[c], deck: ""});
    wkGame({won: true, mode: "online", lv: 0, ld: colOf[c], deck: ""});
    return {a, b, c: STATS.wk.p[c], done: wkDone(STATS.wk.k, c), cols: colorsOf(colOf[c])};
  }, col);
  console.log("color", col, JSON.stringify(r2));
  check(r2.a === 0 && r2.b === 0 && r2.c === 2 && r2.done, "the color challenge counts only wins with a Leader of that color");
}
// the challenges that need a certain game
check(await page.evaluate(() => {
  const all = Object.fromEntries(WK_POOL.map(c => [c[0], c[3]]));
  const g = (o) => Object.assign({won: true, mode: "bot", lv: 0, ld: "OP01-001", cols: ["red"], ctr: 20}, o);
  return all.rk2(g({mode: "ranked"})) && !all.rk2(g({mode: "online"})) && all.hard2(g({lv: 2})) && !all.hard2(g({lv: 1})) && all.exp1(g({lv: 4}))
    && all.fr1(g({mode: "friends"})) && !all.fr1(g({mode: "online"})) && all.win3(g({mode: "online"})) && !all.win3(g({mode: "bot"}))
    && all.lowc(g({ctr: 8})) && !all.lowc(g({ctr: 12})) && !all.lowc(g({ctr: null}));
}), "each challenge counts the right games");
check(await page.evaluate(() => {
  const L = (lds) => { STATS.wk = {k: window.__k, p: {}, l: {}}; STATS.wb = STATS.wb.filter(b => b !== window.__k + ":lds3"); const c = WK_POOL.find(x => x[0] === "lds3"); for (const ld of lds) wkBump(c, 1, ld); return STATS.wk.p.lds3; };
  return L(["OP01-001", "OP01-001", "OP01-060"]) === 2 && L(["OP01-001", "OP01-060", "OP01-061"]) === 3 && STATS.wb.includes(window.__k + ":lds3");
}), "3 different Leaders counts each Leader once");
await page.evaluate(() => { STATS.wk = {k: window.__k, p: {}, l: {}}; });

// counted from a real game against the computer: conceding ends it once
await page.evaluate(() => { localStorage.setItem("nakama:setup", JSON.stringify({nick: "Ryan", leader: "OP01-001", deck: ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"].map(c => "4x" + c).join("\n"), life: 5})); });
await page.evaluate(() => openSetup({bot: true})); await wait(400);
await page.click('[data-do="vsbot"]'); await wait(800);
const g0 = await page.evaluate(() => { let n = 0; const real = wkGame; wkGame = g => { n++; window.__g = g; return real(g); }; S.conceded = true; render(); render(); return n; });
const gg = await page.evaluate(() => window.__g);
console.log("bot game", JSON.stringify(gg));
check(gg && gg.mode === "bot" && gg.won === false && gg.ld === "OP01-001" && /OP01-013/.test(gg.deck), "conceding to the computer reports the game once, with your Leader and deck");
check(await page.evaluate(() => { const n0 = window.__g; window.__g = null; render(); return window.__g === null; }), "and only once");
await page.evaluate(() => leaveRoom ? leaveRoom() : null).catch(() => {});

// the puzzle challenge counts a solve of today's puzzle
await page.evaluate(() => { STATS.wk = {k: window.__k, p: {}, l: {}}; wkPick = () => [WK_POOL.find(c => c[0] === "pz3"), WK_POOL.find(c => c[0] === "win3"), WK_POOL.find(c => c[0] === "rk2")]; wkEvent("pz"); });
check(await page.evaluate(() => STATS.wk.p.pz3 === 1), "a solved puzzle counts toward the puzzle challenge");

// Profile shows the week's three, with progress, the time left and the badge count
await page.evaluate(() => { closeModal(); openProfile(); }); await wait(400);
const pf = await page.evaluate(() => ({n: document.querySelectorAll(".wkc").length, txt: [...document.querySelectorAll(".wkc")].map(e => e.innerText.replace(/\s+/g, " ")), hint: (document.querySelector(".wkbox + .hint") || {}).textContent}));
console.log("profile", JSON.stringify(pf));
check(pf.n === 3 && pf.txt.some(t => /Solve the daily lethal puzzle on 3 days 1 of 3/.test(t)) && /New challenges in .* badge/.test(pf.hint), "Profile shows this week's challenges, progress, time left and badges");
await page.evaluate(() => document.querySelector(".wkbox").scrollIntoView());
await page.screenshot({ path: OUT + "/profile.png" });
// stats keep them, and a bad saved value is cleaned
check(await page.evaluate(() => { const o = statsFrom({wk: {k: "2026w42", p: {play5: 3, nope: 9, win3: "x"}, l: {lds3: ["OP01-001", "<b>"]}}, wb: ["2026w42:play5", "bad", "2026w42:play5"]}); return o.wk.p.play5 === 3 && !("nope" in o.wk.p) && o.wk.p.win3 === 0 && o.wk.l.lds3.length === 1 && o.wb.length === 1; }), "saved challenges are cleaned when loaded");
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
