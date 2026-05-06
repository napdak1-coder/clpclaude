import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3000/shipments/new", { waitUntil: "networkidle" });
const btn = page.locator("button", { hasText: /1ST SG TOTAL/i }).first();
if (await btn.count()) {
  await btn.click();
  await page.waitForTimeout(800);
}

const m = await page.evaluate(() => {
  const headers = Array.from(document.querySelectorAll("table thead th")).map((th, i) => ({
    idx: i,
    label: (th.textContent || "").trim(),
    px: Math.round(th.getBoundingClientRect().width),
  }));
  const rows = Array.from(document.querySelectorAll("table tbody tr"));
  const cellsByCol = headers.map(() => []);
  for (const r of rows) {
    const tds = r.querySelectorAll("td");
    tds.forEach((td, i) => {
      const inputs = td.querySelectorAll("input, select, textarea");
      let val = "";
      if (inputs.length) val = Array.from(inputs).map(i => i.value).join(" ");
      else val = (td.textContent || "").trim();
      if (val) cellsByCol[i].push(val);
    });
  }
  return headers.map((h, i) => ({
    ...h,
    samples: cellsByCol[i].slice(0, 3),
    maxLen: Math.max(0, ...cellsByCol[i].map(v => v.length)),
    avgLen: cellsByCol[i].length ? Math.round(cellsByCol[i].reduce((s, v) => s + v.length, 0) / cellsByCol[i].length) : 0,
  }));
});

console.log(JSON.stringify(m, null, 2));
await browser.close();
