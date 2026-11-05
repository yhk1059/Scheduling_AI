// OG 이미지(public/og.png, 1200×630)를 만든다. 랜딩 히어로와 같은 문구·색을 쓴다: npm run og
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const QUOTE =
  "M10.5 7.5c-2.6.6-4 2.5-4 5v4H11v-4.5H9c0-1 .5-1.7 1.5-2V7.5zM17.5 7.5c-2.6.6-4 2.5-4 5v4H18v-4.5h-2c0-1 .5-1.7 1.5-2V7.5z";
const mark = (size) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><rect width="24" height="24" rx="6" fill="#155E75"/><path fill="#fff" d="${QUOTE}"/></svg>`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; background: #F6F6F3; color: #1B1B18; font-family: "IBM Plex Sans KR", sans-serif; padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
  h1 { font-size: 72px; line-height: 1.15; font-weight: 700; letter-spacing: -0.03em; }
  p { margin-top: 24px; font-size: 26px; line-height: 1.5; color: #3D3D38; }
  .bar { display: flex; align-items: center; gap: 16px; height: 72px; padding: 0 10px 0 22px; background: #fff; border: 1.5px solid #8A8A80; border-radius: 12px; font-size: 24px; }
  .bar span { flex: 1; }
  .bar b { display: inline-flex; align-items: center; height: 52px; padding: 0 22px; border-radius: 8px; background: #155E75; color: #fff; font-size: 21px; font-weight: 500; }
</style></head><body>
  <div class="brand">${mark(34)}스케줄링 AI</div>
  <div><h1>매장 조건은 말로,<br>근무표는 버튼 하나로</h1>
  <p>직원은 링크로 가능 시간을 칠하고, 매니저는 매장 조건을 말로 적어요.<br>막히면 이유와 해결책을 알려 드려요.</p></div>
  <div class="bar">${mark(26)}<span>마감 다음 날 오픈은 안 되게</span><b>규칙 만들기</b></div>
</body></html>`;

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/og.png");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
