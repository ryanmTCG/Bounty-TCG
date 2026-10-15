import { _electron as electron } from "playwright-core";
import fs from "fs";
import { startFakeFire } from "./fakefire.mjs";
// Report a problem: a report carries what the player wrote, this game so far (replay, table state, log) and recent
// errors. Signed in it's sent to reports/, which only admins read (Profile > Bug reports); anyone can save it as a file,
// which opens like a replay.
const OUT = process.argv[2] || "shots-report";
fs.mkdirSync(OUT, { recursive: true });
const fire = await startFakeFire(9101);
const prof = "/tmp/bounty-prof-report"; fs.rmSync(prof, { recursive: true, force: true });
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: prof, BOUNTY_QUERY: "?fbtest=http://127.0.0.1:9101" } });
const page = await app.firstWindow(); const errs = [];
page.on("pageerror", e => { if (!/test boom/.test(String(e))) errs.push(String(e)); });
page.on("console", m => { if (m.type() === "error" && !/peerjs\.com|ERR_CONNECTION|40[034]|test boom/.test(m.text())) errs.push(m.text()); });
await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
await page.waitForLoadState("load"); await page.waitForTimeout(1500);
let fail = 0;
const check = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) fail++; };
const wait = ms => page.waitForTimeout(ms);
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(400); } return false; };
const deck = ["OP01-013","OP01-016","OP01-024","OP01-014","OP01-015","OP01-017","OP01-018","OP01-019","OP01-020","OP01-021","OP01-022","OP01-025","OP01-026"].map(c => "4x" + c).join("\n");
await page.evaluate(() => window.bountyAccount.signUp("ryan@example.com", "secret1"));
await page.reload(); await wait(1500);
// a few turns against the computer, then something goes wrong
await page.evaluate(d => startPractice(true, {nick: "Ryan", leader: "OP01-001", deck: d, life: 5, first: true, sleeve: 0}), deck); await wait(800);
await page.evaluate(() => { PR.roll = [6, 1]; practiceFirst(0); }); await wait(2500);
await page.click('[data-do="keep"]'); await wait(1500);
for (let i = 0; i < 3; i++) { await page.evaluate(() => { if (S.myTurn && !S.atk) endTurn(); }); await until(() => page.evaluate(() => S.myTurn), 20000); await page.evaluate(() => { while (fxCur) { fxQueue.length = 0; fxFinish(false); } if (modal) closeModal(); }); }
await page.evaluate(() => setTimeout(() => { throw new Error("test boom"); }, 0)); await wait(300);
check(await page.evaluate(() => ERRS.some(e => /test boom/.test(e[1])) && REC && REC.fr.length >= 6), "the game is recorded and the error is noted");
// Home > Report a problem
await page.evaluate(() => openHome()); await wait(300);
await page.click('.homebtns [data-do="report"]'); await wait(300);
const f0 = await page.evaluate(() => ({m: modal && modal.type, game: !!$("#rep-game") && $("#rep-game").checked, send: !!document.querySelector('[data-do="repsend"]'), hint: document.querySelector("#modal").innerText}));
check(f0.m === "report" && f0.game && f0.send && /never includes an online opponent's hand/.test(f0.hint), "Report a problem offers to include this game and to send it");
await page.click('[data-do="repsend"]'); await wait(300);
check(/Say what went wrong first/.test(await page.textContent("#toast")), "an empty report isn't sent");
await page.screenshot({ path: OUT + "/report.png" });
await page.fill("#rep-msg", 'The computer <img src=x onerror="window.__x=1"> skipped its attack');
await page.click('[data-do="repsend"]');
check(await until(() => [...fire.docs.keys()].some(k => k.startsWith("reports/"))), "Send report puts it in reports");
const rk = [...fire.docs.keys()].find(k => k.startsWith("reports/")), rd = fire.plain(fire.docs.get(rk));
const inner = await page.evaluate(async z => { const o = JSON.parse(z[0] === "z" ? await rpInflate(z.slice(1), 1e8) : z.slice(1)); return {sides: o.st.sides.length, mode: o.st.mode, errs: o.st.errs.map(e => e[1]).join("|"), log: o.st.log.length, frames: !!(o.e && o.e.z), hd: o.e ? /"hd"/.test(await rpUnpack(o.e.z)) : false}; }, rd.z);
console.log("report", JSON.stringify({id: rk, by: rd.by, ver: rd.ver, msg: rd.msg, where: rd.where, len: rd.z.length}), JSON.stringify(inner));
check(rd.by === "uid1" && rd.ver === "1.5.1" && rd.where === "computer" && /skipped its attack/.test(rd.msg), "the report names the player, version and kind of game");
check(inner.sides === 2 && /test boom/.test(inner.errs) && inner.log > 3 && inner.frames && inner.hd, "it carries both sides, the log, the error and the replay");
check(/sent with this game/.test(await page.textContent("#toast")) && await page.evaluate(() => !modal || modal.type !== "report"), "the player is thanked and back at the table");
// saved as a file instead: the file opens like a replay
const file = await page.evaluate(async () => JSON.stringify(Object.assign({bounty: "report"}, await reportBuild("Saved instead", true))));
const imp = await page.evaluate(async t => { const r = await rpImport(t); return {r, me: r.id && rpList().find(x => x.id === r.id).me}; }, file);
check(!!imp.r.id && imp.me === "Ryan", "a saved report file opens as a replay");
// only admins read reports
await page.evaluate(() => openProfile()); await wait(800);
check(await page.evaluate(() => !document.querySelector('[data-do="reports"]')), "players don't see Bug reports");
fire.admins.add("uid1");
await page.evaluate(() => { sessionStorage.clear(); closeModal(); openProfile(); }); await wait(800);
await page.click('[data-do="reports"]');
await page.waitForSelector(".repr", { timeout: 8000 }).catch(() => {});
const rl = await page.evaluate(() => [...document.querySelectorAll(".repr")].map(r => r.innerText.replace(/\s+/g, " ")));
console.log("reports", JSON.stringify(rl));
check(rl.length === 1 && /skipped its attack/.test(rl[0]) && /computer · version 1\.5\.1/.test(rl[0]), "an admin sees the report under Profile > Bug reports");
check(await page.evaluate(() => !window.__x && !document.querySelector(".repr img")), "a report's text can't run anything");
await page.click('[data-do="repdet:0"]'); await wait(800);
const det = await page.evaluate(() => $("#rep-det-0").textContent);
check(/test boom/.test(det) && /computer · phase play/.test(det) && /Last moves/.test(det), "Details shows the errors and last moves");
await page.screenshot({ path: OUT + "/reports.png" });
await page.click('[data-do="repwatch:0"]');
check(await until(() => page.evaluate(() => !!RPV && RPV.from === "reports" && RPV.A.length >= 6)), "Watch the game plays it back");
await page.click('[data-do="rp:exit"]'); await wait(800);
check(await page.evaluate(() => modal && modal.type === "reports"), "and goes back to the reports");
// signed out: no Send, save a file instead
await page.evaluate(() => window.bountyAccount.signOut()); await page.reload(); await wait(1500);
await page.evaluate(() => openReport()); await wait(300);
const so = await page.evaluate(() => ({send: !!document.querySelector('[data-do="repsend"]'), save: !!document.querySelector('[data-do="repsave"]'), t: document.querySelector("#modal").innerText}));
check(!so.send && so.save && /Sending needs an account/.test(so.t), "signed out, the report can only be saved as a file");
console.log("errors", JSON.stringify(errs));
check(!errs.length, "no page errors");
await app.close(); fire.close();
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
