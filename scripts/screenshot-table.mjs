import { chromium } from "playwright";
import path from "node:path";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3000/shipments/new", { waitUntil: "networkidle" });

// 1ST SG TOTAL 버튼 클릭 (샘플 로드)
const btn = page.locator("button", { hasText: /1ST SG TOTAL/i }).first();
if (await btn.count()) {
  await btn.click();
  await page.waitForTimeout(800);
}

// 화물 테이블 행 높이 측정
const measure = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("table tbody tr"));
  const sample = rows.slice(0, 5).map((r) => {
    const rect = r.getBoundingClientRect();
    return { h: Math.round(rect.height), cells: r.querySelectorAll("td").length };
  });
  const head = document.querySelector("table thead tr");
  const headH = head ? Math.round(head.getBoundingClientRect().height) : 0;
  return { rowCount: rows.length, sample, headH };
});
console.log("측정:", JSON.stringify(measure, null, 2));

const out = path.resolve("scripts/_screenshot-cargo-table.png");
await page.screenshot({ path: out, fullPage: false });
console.log("저장:", out);

await browser.close();
