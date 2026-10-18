import { _electron as electron } from "playwright-core";
import fs from "fs";
// Achievements: earned from wins, ranked bounty, the computer's levels, tournaments, the tutorial, decks, the collection
// and shared replays; shown in Profile and counted in the lobby presence.
const OUT = process.argv[2] || "shots-ach";
fs.mkdirSync(OUT, { recursive: true });
const prof = "/tmp/bounty-prof-ach"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof } });
const page = await app.firstWindow(); const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]/.test(m.text())) errs.push(m.text()); });
await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
await page.waitForLoadState("load"); await page.waitForTimeout(3500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const wait = ms => page.waitForTimeout(ms);
const toasts = () => page.evaluate(() => [...document.querySelectorAll(".toast")].map(t => t.textContent));
check(await page.evaluate(() => achN() === 0 && !Object.keys(STATS.ach).length), "a new player has no achievements");
// wins, kept in the stats
await page.evaluate(() => { STATS.w = 1; statsSave(); }); await wait(300);
const t1 = (await page.evaluate(() => [...document.querySelectorAll("#toasts *, .toast")].map(t => t.textContent).join(" | ")));
console.log("toast", t1);
check(await page.evaluate(() => !!STATS.ach.win1 && !STATS.ach.win10), "the first online win earns First win");
check(/Achievement earned: First win/.test(t1), "and says so");
// several at once: one toast naming them
await page.evaluate(() => { STATS.w = 12; RANK.b = 640000; statsSave(); }); await wait(300);
const a2 = await page.evaluate(() => Object.keys(STATS.ach).sort().join(","));
check(a2 === "nova,warl,win1,win10", "10 wins and a ฿640,000 bounty earn Ten wins, Supernova and Warlord");
// the computer: Master earns Hard and Expert too
await page.evaluate(() => achBot(4)); await wait(200);
check(await page.evaluate(() => !!(STATS.ach.bot2 && STATS.ach.bot3 && STATS.ach.bot4)), "beating Master earns all three computer achievements");
await page.evaluate(() => { STATS.ach = {}; STATS.w = 0; RANK.b = 0; statsSave(); STATS.ach = {}; achBot(1); }); await wait(200);
check(await page.evaluate(() => !STATS.ach.bot2), "beating Normal earns none");
// tutorial, decks, collection and sharing
await page.evaluate(() => { tutMark(); COLL = {"OP01-013": 300, "OP01-016": 200}; collSave(); achGive("tour"); achGive("share"); }); await wait(300);
check(await page.evaluate(() => ["tut", "coll500", "tour", "share"].every(k => STATS.ach[k])), "the tutorial, 500 owned cards, a tournament and a shared code each earn one");
// stored with the stats and kept when they're read back
const kept = await page.evaluate(() => { const o = statsFrom(JSON.parse(localStorage.getItem("bounty:stats"))); return Object.keys(o.ach).length; });
check(kept === await page.evaluate(() => achN()), "achievements are saved with the stats");
check(await page.evaluate(() => Object.keys(statsFrom({ach: {win1: 5, bogus: 7, win10: "x"}}).ach).join(",")) === "win1", "unknown or broken entries are dropped when read");
// Profile
await page.evaluate(() => openProfile()); await wait(500);
const pf = await page.evaluate(() => ({n: document.querySelectorAll("#pf-ach .ach").length, got: document.querySelectorAll("#pf-ach .ach.got").length, head: $("#pf-ach h3").textContent}));
console.log("profile", JSON.stringify(pf));
check(pf.n === 17 && pf.got === (await page.evaluate(() => achN())) && /of 17/.test(pf.head), "Profile lists every achievement, earned ones lit up");
await page.screenshot({ path: OUT + "/profile.png" });
// the lobby presence carries the count, and a peer's count is capped
check(await page.evaluate(() => acOf(99) === 17 && acOf("x") === 0 && /🏅3/.test(achBadge(3)) && achBadge(0) === ""), "a count read from someone else is kept in range");
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
await app.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
