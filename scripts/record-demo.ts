// 랜딩 데모 영상 녹화. e2e 테스트 계정의 매장을 "한강 카페"(현실 시나리오)로 채우고, 실제 앱을 Playwright로 돌리며 녹화한다.
// 실행: npm run dev를 띄운 채 npm run record:demo → public/demo.mp4 (ffmpeg 필요). 화면이 바뀌면 다시 돌려 영상을 새로 만든다.
// 저니: 매장 홈 → ① 직원 링크 → 직원 화면(가능 시간 칠하기·제출) → ② 규칙 한 줄 → 카드 → ③ 예외 → 근무표 만들기 → 확정.
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BrowserContext, chromium, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { dateOfDay, localDate, type PeriodRange } from "../lib/period";
import { buildScenario, type SeedDoc } from "../lib/seed-scenarios";

const APP_URL = "http://localhost:3000";
const SIZE = { width: 1440, height: 900 };
const OUT = "public/demo.mp4";
/** 영상에서 매니저가 말로 적는 규칙. 시드에서 이 규칙만 빼 두고 영상 안에서 만든다(랜딩 히어로와 같은 문장). */
export const TYPED_RULE = { id: "rule-no-close-open", text: "마감 다음 날 오픈은 안 되게", card: "마감 다음 날 오픈 금지" };
const EMPLOYEE = "박민수";

/** 현실 시나리오를 영상용으로 고친다: 매장 이름, 영상에서 만들 규칙 빼기. */
export function demoSeed(doc: SeedDoc): SeedDoc {
  const { shop } = doc.state;
  return { ...doc, state: { ...doc.state, shop: { ...shop, name: "한강 카페", rules: shop.rules.filter((r) => r.id !== TYPED_RULE.id) } } };
}

const monthDay = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

/** ③에서 말로 적는 예외: 근무표 둘째·셋째 날 휴가. 김철수는 매일 가능해 리더 배치 규칙과 부딪히지 않는다. */
export function leaveText(period: PeriodRange): string {
  const from = dateOfDay(period, 2);
  const to = dateOfDay(period, 3);
  return `김철수 ${Number(from.slice(5, 7))}월 ${Number(from.slice(8, 10))}~${Number(to.slice(8, 10))}일 휴가`;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`.env.local에 ${name}이 필요해요`);
  return v;
}

const authStorageKey = (supabaseUrl: string) => `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** 가짜 커서(Playwright 녹화에는 마우스가 찍히지 않아 mousemove를 따라다니는 점을 그린다), 개발 표시 숨기기, 이메일 가리기. */
const CURSOR_SCRIPT = `
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.style.cssText = "position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(21,94,117,.55);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;transition:transform .12s;transform:translate(-100px,-100px)";
    document.documentElement.appendChild(c);
    // Next.js 개발 표시(왼쪽 아래 N 버튼)는 영상에 찍히지 않게 숨긴다
    const hide = document.createElement("style");
    hide.textContent = "nextjs-portal{display:none!important}";
    document.head.appendChild(hide);
    // 상단 바의 테스트 계정 이메일은 가짜 주소로 바꿔 찍는다(React가 다시 그려도 observer가 다시 바꾼다)
    const FAKE = "manager@hangang.cafe";
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
async function click(page: Page, target: Locator) {
  await target.waitFor();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("누를 요소가 안 보여요");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
  await pause(page, 250);
  await target.click();
}

/** 입력칸에 사람이 치듯 글자를 넣는다. */
async function type(page: Page, name: string, text: string) {
  const box = page.getByRole("textbox", { name });
  await click(page, box);
  await box.pressSequentially(text, { delay: 70 });
  await pause(page, 500);
}

/** 직원 화면: 한 날의 칸을 드래그로 칠한다. */
async function paint(page: Page, day: string, from: string, to: string) {
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

async function main() {
  process.loadEnvFile(".env.local");
  if (!(await fetch(`${APP_URL}/app`).catch(() => null))?.ok) throw new Error(`먼저 npm run dev를 띄워 주세요 (${APP_URL})`);

  // 시드: 테스트 계정의 매장을 지우고 현실 시나리오를 넣는다(scripts/seed.ts와 같은 방식)
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const db = createClient(url, env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.signInWithPassword({ email: env("E2E_TEST_EMAIL"), password: env("E2E_TEST_PASSWORD") });
  if (authError) throw new Error(`테스트 계정 로그인 실패: ${authError.message}`);
  const built = buildScenario("realistic", localDate(new Date()));
  const doc = demoSeed(built.doc);
  const { shop, periods } = doc.state;
  const period = periods[0];

  const { error: deleteError } = await db.from("shops").delete().eq("owner_id", auth.user.id);
  if (deleteError) throw new Error(deleteError.message);
  const { data: row, error: shopError } = await db.from("shops").insert({ owner_id: auth.user.id, data: doc }).select("id").single();
  if (shopError) throw new Error(shopError.message);
  const submittedAt = new Date().toISOString();
  const { error: linkError } = await db.from("availability_links").insert(
    shop.employees.map((e) => ({
      shop_id: row.id,
      period_start: period.start_date,
      period_length: period.length,
      employee_id: e.id,
      employee_name: e.name,
      shop_name: shop.name,
      slots: built.slots[e.id] ?? {},
      submitted_at: built.slots[e.id] ? submittedAt : null,
    })),
  );
  if (linkError) throw new Error(linkError.message);
  console.log(`${shop.name}: ${period.start_date}부터 ${period.length}일, 규칙 ${shop.rules.length}개`);

  const videoDir = join(tmpdir(), `demo-video-${Date.now()}`);
  mkdirSync(videoDir, { recursive: true });
  const browser = await chromium.launch();
  const context: BrowserContext = await browser.newContext({
    viewport: SIZE,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    recordVideo: { dir: videoDir, size: SIZE },
  });
  await context.addInitScript(
    ([key, session]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, session);
    },
    [authStorageKey(url), JSON.stringify(auth.session)],
  );
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  const started = Date.now();
  const mark = (label: string) => console.log(`${((Date.now() - started) / 1000).toFixed(1)}s  ${label}`);

  try {
    // 매장 홈 → ① 가능 시간(직원 링크)
    await page.goto(`${APP_URL}/app`);
    await page.getByRole("heading", { name: shop.name }).waitFor();
    await pause(page, 1800);
    mark("매장 홈");
    await click(page, page.getByRole("button", { name: "이어서 하기" }));
    await page.getByRole("button", { name: "링크 복사" }).waitFor();
    await pause(page, 2200);
    mark("① 가능 시간");

    // 직원 화면: 링크로 열어 이름을 고르고 가능 시간을 칠한 뒤 제출
    const { data: share, error: shareError } = await db.from("availability_shares").select("token").eq("shop_id", row.id).single();
    if (shareError) throw new Error(shareError.message);
    await page.goto(`${APP_URL}/a/${share.token}`);
    await page.getByRole("heading", { name: "내 이름을 골라 주세요" }).waitFor();
    await pause(page, 1500);
    await click(page, page.getByRole("button", { name: EMPLOYEE }));
    const resume = page.getByRole("button", { name: "이어서 고치기" });
    if (await resume.isVisible().catch(() => false)) await click(page, resume);
    await page.getByText(`${EMPLOYEE}님의 가능 시간`).waitFor();
    await pause(page, 1500);
    mark("직원 화면");
    // 박민수는 평일 저녁만 칠해 두었다. 첫날 아침을 더 칠한다
    await paint(page, monthDay(dateOfDay(period, 1)), "09:00~09:30", "12:30~13:00");
    await pause(page, 600);
    await click(page, page.getByRole("button", { name: "제출" }));
    await page.getByText("제출했어요").waitFor();
    await pause(page, 1800);
    mark("제출");

    // 매니저로 돌아와 ① → ② 매장 조건: 규칙 한 줄 → 카드 → 적용
    // 다시 열면 매장 홈일 수 있다(홈에도 링크 카드가 있다). 그러면 [이어서 하기]로 ①에 들어간다
    await page.goto(`${APP_URL}/app`);
    const next = page.getByRole("button", { name: "다음", exact: true });
    const resumeWork = page.getByRole("button", { name: "이어서 하기" });
    await next.or(resumeWork).first().waitFor();
    if (await resumeWork.isVisible().catch(() => false)) {
      await pause(page, 1200);
      await click(page, resumeWork);
      await next.waitFor();
    }
    await pause(page, 1200);
    await click(page, next);
    await page.getByRole("heading", { name: "매장 조건", exact: true }).first().waitFor();
    await pause(page, 1200);
    mark("② 매장 조건");
    await type(page, "매장 조건 입력", TYPED_RULE.text);
    await click(page, page.getByRole("button", { name: "규칙 만들기", exact: true }));
    const ruleCard = page.locator("article").filter({ hasText: TYPED_RULE.card }).first();
    await ruleCard.waitFor({ timeout: 90_000 });
    await pause(page, 2200);
    mark("규칙 카드");
    await click(page, ruleCard.getByRole("button", { name: "적용" }));
    await pause(page, 1200);
    await click(page, page.getByRole("button", { name: "다음", exact: true }));

    // ③ 근무표: 예외 한 줄 → 근무표 만들기 → 확정
    await page.getByRole("textbox", { name: "예외 입력" }).waitFor();
    await pause(page, 1000);
    mark("③ 근무표");
    await type(page, "예외 입력", leaveText(period));
    await click(page, page.getByRole("button", { name: "요청 만들기", exact: true }));
    const leaveCard = page.locator("article").filter({ hasText: "휴가" }).first();
    await leaveCard.waitFor({ timeout: 90_000 });
    await pause(page, 1600);
    await click(page, leaveCard.getByRole("button", { name: "적용" }));
    await pause(page, 800);
    await click(page, page.getByRole("button", { name: "근무표 만들기" }));
    const ok = page.getByText("규칙을 모두 지켰어요");
    const none = page.getByText(/근무표가 없어요|근무표를 만들지 못했어요/);
    await ok.or(none).first().waitFor({ timeout: 120_000 });
    if (await none.isVisible().catch(() => false)) throw new Error("근무표가 안 나왔어요. 시나리오를 확인해 주세요");
    await pause(page, 3500);
    mark("근무표");
    await page.mouse.wheel(0, 360);
    await pause(page, 2000);
    await click(page, page.getByRole("button", { name: "확정", exact: true }));
    await page.getByRole("heading", { name: "변경 입력" }).waitFor();
    await pause(page, 3000);
    mark("확정");
  } finally {
    await context.close();
    await browser.close();
  }

  const webm = await page.video()?.path();
  if (!webm) throw new Error("녹화 파일이 없어요");
  mkdirSync("public", { recursive: true });
  const tmpOut = join(videoDir, "demo.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", tmpOut]);
  renameSync(tmpOut, OUT);
  console.log(`${OUT} 저장 (${((Date.now() - started) / 1000).toFixed(0)}초)`);
}

if (!process.env.VITEST) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
