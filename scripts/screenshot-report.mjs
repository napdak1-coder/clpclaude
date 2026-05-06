import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 2400 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/debug/2st-sg-report", { waitUntil: "networkidle" });
await p.screenshot({ path: "scripts/_2st-sg-report.png", fullPage: true });
console.log("ok");
await b.close();
