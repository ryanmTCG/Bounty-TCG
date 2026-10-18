import { _electron as electron } from "playwright-core";
const app = await electron.launch({ executablePath: "node_modules/electron/dist/electron", args: ["--no-sandbox", "dist/kit/app"], env: { ...process.env, BOUNTY_PROFILE: "/tmp/bounty-prof-dbg" } });
const page = await app.firstWindow(); await page.waitForLoadState("load"); await page.waitForTimeout(3500);
console.log(await page.evaluate(() => { const p = pzPool(); return [BFX.size, CARDDB.size, p.van.length, p.blk.length, p.life.length, JSON.stringify(CARDDB.get("EB01-005")), BFX.has("EB01-005"), fxAb("EB01-005").length]; }));
await app.close();
