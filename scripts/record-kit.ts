// 데모 영상 녹화 스크립트들이 같이 쓰는 도구: 가짜 커서, 사람처럼 누르고 치기, 대기 구간 잘라 내기.
import { execFileSync } from "node:child_process";

import type { Locator, Page } from "@playwright/test";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`.env.local에 ${name}이 필요해요`);
  return v;
}

export const authStorageKey = (supabaseUrl: string) => `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
export const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** 가짜 커서(Playwright 녹화에는 마우스가 찍히지 않아 mousemove를 따라다니는 점을 그린다), 개발 표시 숨기기, 이메일 가리기. */
export const cursorScript = (fakeEmail: string) => `
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.style.cssText = "position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(21,94,117,.55);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;transition:transform .12s;transform:translate(-100px,-100px)";
    document.documentElement.appendChild(c);
    // Next.js 개발 표시(왼쪽 아래 N 버튼)는 영상에 찍히지 않게 숨긴다
    const hide = document.createElement("style");
    hide.textContent = "nextjs-portal{display:none!important}";
    document.head.appendChild(hide);
    // 상단 바의 테스트 계정 이메일은 가짜 주소로 바꿔 찍는다(React가 다시 그려도 observer가 다시 바꾼다)
    const FAKE = ${JSON.stringify(fakeEmail)};
    const mask = () => {
      const menu = document.querySelector('button[aria-label="계정 메뉴"]');
      if (!menu) return;
      for (const n of menu.childNodes) if (n.nodeType === 3 && n.nodeValue.includes("@") && n.nodeValue !== FAKE) n.nodeValue = FAKE;
    };
    new MutationObserver(mask).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    let x = -100, y = -100, down = false;
    const draw = () => { c.style.transform = "translate(" + x + "px," + y + "px) scale(" + (down ? .7 : 1) + ")"; };
    addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; draw(); }, true);
    addEventListener("mousedown", () => { down = true; draw(); }, true);
    addEventListener("mouseup", () => { down = false; draw(); }, true);
  });
`;

/** 요소까지 커서를 천천히 옮긴 뒤 누른다. */
export async function click(page: Page, target: Locator) {
  await target.waitFor();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("누를 요소가 안 보여요");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
  await pause(page, 250);
  await target.click();
}

/** 입력칸에 사람이 치듯 글자를 넣는다. */
export async function type(page: Page, box: Locator, text: string) {
  await click(page, box);
  await box.pressSequentially(text, { delay: 70 });
  await pause(page, 500);
}

/** 직원 화면: 한 날의 칸을 드래그로 칠한다. */
export async function paint(page: Page, day: string, from: string, to: string) {
  const cell = (time: string) => page.getByRole("button", { name: `${day} ${time}`, exact: true });
  const a = await cell(from).boundingBox();
  const b = await cell(to).boundingBox();
  if (!a || !b) throw new Error("칠할 칸이 안 보여요");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 20 });
  await pause(page, 200);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 30 });
  await page.mouse.up();
  await pause(page, 800);
}

export type Segment = [number, number];
const MIN_SEGMENT = 0.1;

/** 자를 구간(초)을 뺀 나머지, 남길 구간. 겹치는 구간은 합치고 영상 길이 밖은 버린다. */
export function keepSegments(cuts: Segment[], duration: number): Segment[] {
  const sorted = cuts.map(([a, b]): Segment => [Math.max(0, a), Math.min(duration, b)]).sort((x, y) => x[0] - y[0]);
  const keep: Segment[] = [];
  let at = 0;
  for (const [a, b] of sorted) {
    if (a > at) keep.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < duration) keep.push([at, duration]);
  return keep.filter(([a, b]) => b - a >= MIN_SEGMENT);
}

/** 남길 구간을 잘라 이어 붙이는 ffmpeg filter_complex. 출력 이름은 [out]. */
export function trimFilter(keep: Segment[]): string {
  const parts = keep.map(([a, b], i) => `[0:v]trim=start=${a}${Number.isFinite(b) ? `:end=${b}` : ""},setpts=PTS-STARTPTS[v${i}]`);
  return `${parts.join(";")};${keep.map((_, i) => `[v${i}]`).join("")}concat=n=${keep.length}:v=1:a=0[out]`;
}

/** webm 녹화를 mp4로 바꾼다. cuts가 있으면 그 구간을 잘라 낸다. */
export function encode(webm: string, out: string, cuts: Segment[] = []) {
  const x264 = ["-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"];
  if (cuts.length === 0) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, ...x264, out]);
    return;
  }
  // Playwright webm에는 길이가 없을 때가 있다(N/A). 그러면 마지막 구간을 끝까지 남긴다
  const probed = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", webm]).toString());
  const duration = Number.isFinite(probed) ? probed : Infinity;
  const filter = trimFilter(keepSegments(cuts, duration));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-filter_complex", filter, "-map", "[out]", ...x264, out]);
}
