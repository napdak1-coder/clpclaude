import { chromium } from "playwright";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "tmp-screenshots");
mkdirSync(outDir, { recursive: true });

const url = process.argv[2] || "http://localhost:3001/debug/rows-mockup";
const outFile = resolve(outDir, `mockup-${Date.now()}.png`);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1800, height: 2400 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);
// Crop to just the SVG container area
const elem = await page.$("svg");
if (elem) {
  await elem.screenshot({ path: outFile });
} else {
  await page.screenshot({ path: outFile, fullPage: true });
}
console.log("SAVED:", outFile);
await browser.close();
