import { _electron as electron } from "playwright-core";
import fs from "fs";
import { startFakeFire } from "./fakefire.mjs";
// Ranked bounty: each result moves it by how surprising it was (Elo on the bounty scale), and seasons (calendar
// quarters) halve it and start the record again, keeping the old season in the profile.
const OUT = process.argv[2] || "shots-season";
fs.mkdirSync(OUT, { recursive: true });
const fire = await startFakeFire(9101);
const prof = "/tmp/bounty-prof-season"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: "?fbtest=http://127.0.0.1:9101" } });
const page = await app.firstWindow(); const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[34]/.test(m.text())) errs.push(m.text()); });
await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
await page.waitForLoadState("load"); await page.waitForTimeout(1500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const steps = await page.evaluate(() => ({even: rankStep(0, 0, true), up: rankStep(0, 300000, true), down: rankStep(300000, 0, true), far: rankStep(0, 3e6, true), tiny: rankStep(3e6, 0, true),
  lossEven: rankStep(500000, 500000, false), rookie: rankLossStep(0, 0), warlord: rankLossStep(600000, 600000), yonko: rankLossStep(900000, 900000), lossFar: rankStep(0, 3e6, false)}));
console.log("steps", JSON.stringify(steps));
check(steps.even === 27500 && steps.up === 46700 && steps.down === 8300, "a win is worth more against a higher bounty and less against a lower one");
check(steps.far === 50000 && steps.tiny === 5000, "a win is worth ฿5,000 to ฿50,000");
check(steps.lossEven === 27500 && steps.rookie === 6900 && steps.warlord === 20600 && steps.yonko === 27500 && steps.lossFar === 0, "a loss mirrors the win, softened at the low ranks");
const sz = await page.evaluate(() => ({k: seasonKey(Date.UTC(2026, 9, 15)), k2: seasonKey(Date.UTC(2027, 0, 1)), n1: seasonNo("2026q4"), n2: seasonNo("2027q1"), n5: seasonNo("2027q4"), name: seasonName("2027q1"), end: new Date(seasonEnd("2026q4")).toISOString()}));
console.log("seasons", JSON.stringify(sz));
check(sz.k === "2026q4" && sz.k2 === "2027q1" && sz.n1 === 1 && sz.n2 === 2 && sz.n5 === 5 && sz.name === "Season 2 (January to March 2027)" && sz.end === "2027-01-01T00:00:00.000Z", "seasons are calendar quarters, counted from October 2026");
const roll = await page.evaluate(() => {
  const a = {b: 81200, w: 3, l: 1}, ca = rankSeason(a);
  const b = {b: 812000, w: 9, l: 4, s: "2026q2", ps: {"2026q1": 100}}, cb = rankSeason(b);
  const c = {b: 81200, w: 3, l: 1, s: seasonKey()}, cc = rankSeason(c);
  return {ca, a, cb, b, cc, c, cur: seasonKey()};
});
console.log("rollover", JSON.stringify(roll));
check(roll.ca && roll.a.s === roll.cur && roll.a.b === 81200 && roll.a.w === 3, "a bounty from before seasons carries into the first one");
check(roll.cb && roll.b.b === 300000 && roll.b.w === 0 && roll.b.l === 0 && roll.b.ps["2026q2"] === 812000 && roll.b.ps["2026q1"] === 100 && roll.b.s === roll.cur, "a new season halves the bounty (to ฿300,000 at most), starts the record again and keeps the old one");
check(!roll.cc && roll.c.b === 81200, "nothing changes within a season");
// a stored bounty from last season is rolled over when the game opens, and the profile shows it
await page.evaluate(() => localStorage.setItem("bounty:rank", JSON.stringify({b: 452300, w: 12, l: 5, nick: "Ryan", s: "2026q3"})));
await page.reload(); await page.waitForTimeout(1500);
const r = await page.evaluate(() => RANK);
console.log("after reload", JSON.stringify(r));
check(r.b === 226100 && r.w === 0 && r.l === 0 && r.ps["2026q3"] === 452300, "opening the game in a new season rolls the bounty over");
await page.evaluate(() => openProfile()); await page.waitForTimeout(400);
const ps = await page.evaluate(() => [...document.querySelectorAll(".pfseasons div")].map(d => d.innerText.replace(/\s+/g, " ")));
console.log("profile", JSON.stringify(ps));
check(ps.length === 1 && /Supernova/.test(ps[0]) && /Season 0 \(July to September 2026\)/.test(ps[0]) && /452,300/.test(ps[0]), "the profile keeps past seasons");
// a ranked result with the opponent's bounty
const res = await page.evaluate(() => {
  RANK.b = 100000; S.ranked = true; S.oppB = 400000; rankResult(true); const w = RANK.b;
  S.rankDone = false; S.oppB = 0; rankResult(false); const l = RANK.b;
  return {w, l, rec: RANK.w + "-" + RANK.l};
});
console.log("results", JSON.stringify(res));
check(res.w === 100000 + 46700 && res.l === 146700 - 9600 && res.rec === "1-1", "a ranked result uses both bounties");
// the leaderboard shows this season
const cur = await page.evaluate(() => seasonKey());
fire.put("ranks/a", {b: 50000, w: 2, l: 0, nick: "Now", s: cur});
fire.put("ranks/b", {b: 900000, w: 30, l: 2, nick: "Old", s: "2026q2"});
fire.put("ranks/c", {b: 70000, w: 3, l: 1, nick: "Before"});
const board = await page.evaluate(async () => ((await rankBoard()) || []).map(x => x.nick));
console.log("board", JSON.stringify(board));
check(board.join() === "Before,Now", "the leaderboard shows this season (and, in season 1, bounties from before seasons)");
await page.evaluate(() => { closeModal(); openRanked(); }); await page.waitForTimeout(800);
const head = await page.evaluate(() => ({s: document.querySelector(".rkseason").innerText.replace(/\s+/g, " "), h: [...document.querySelectorAll(".rkh")].map(e => e.textContent)}));
console.log("ranked page", JSON.stringify(head));
check(/^Season 1 \(October to December 2026\) Ends in \d+ days?\./.test(head.s) && head.h.includes("Leaderboard, Season 1"), "the Ranked page names the season and when it ends");
await page.screenshot({ path: OUT + "/ranked.png" });
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
await app.close(); fire.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
