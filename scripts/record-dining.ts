// 랜딩 데모 영상(docs/DEMO_SCENARIO.md, 한강 다이닝) 녹화. 테스트 계정의 매장을 지우고 빈 매장부터 실제 앱을 Playwright로 돌리며 녹화한다.
// 실행: npm run dev를 띄운 채 npm run record:dining → public/demo.mp4 (ffmpeg 필요). 화면이 바뀌면 다시 돌려 영상을 새로 만든다.
// 직원 17명 입력, 가능 시간 19명 제출, 미리 넣는 매장 조건 8문장, LLM 대기는 녹화 뒤 잘라 낸다.
import { mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { dateOfDay, localDate, type PeriodRange } from "../lib/period";
import { type Shop, toScheduleRequest, type WorkPeriod } from "../lib/store";
import type { ConstraintSpec } from "../lib/types.gen";
import { authStorageKey, click, cursorScript, encode, env, paint, pause, type Segment, type } from "./record-kit";

const APP_URL = "http://localhost:3000";
const SIZE = { width: 1440, height: 900 };
const OUT = "public/demo.mp4";
const SHOP_NAME = "한강 다이닝";

type Hours = [string, string] | null;
const F: Hours = ["09:00", "21:00"];
const AM: Hours = ["09:00", "16:00"];
const PM: Hours = ["16:00", "21:00"];
const E20: Hours = ["09:00", "20:00"];
const N: Hours = null;
/** 평일 같고 토·일만 다른 주 */
const wk = (weekday: Hours, sat: Hours, sun: Hours): Hours[] => [weekday, weekday, weekday, weekday, weekday, sat, sun];
const all = (h: Hours): Hours[] => Array<Hours>(7).fill(h);

/** 시나리오의 직원 20명. 화면에서 천천히 입력하는 3명을 맨 앞에 둔다. week는 월~일 가능 시간. */
export const ROSTER: { name: string; tags: string[]; week: Hours[] }[] = [
  { name: "김도현", tags: ["홀", "리더"], week: all(F) },
  { name: "서민호", tags: ["주방", "리더"], week: [F, N, F, F, F, N, N] },
  { name: "오지훈", tags: ["홀", "신입"], week: wk(PM, F, N) },
  { name: "이수진", tags: ["홀", "리더"], week: wk(F, N, N) },
  { name: "박준영", tags: ["홀", "리더"], week: [N, N, F, F, F, F, F] },
  { name: "최민지", tags: ["홀"], week: all(F) },
  { name: "정하늘", tags: ["홀"], week: wk(AM, N, N) },
  { name: "강태호", tags: ["홀"], week: [N, F, F, F, F, F, F] },
  { name: "윤서아", tags: ["홀"], week: wk(PM, F, F) },
  { name: "임재원", tags: ["홀"], week: [F, N, F, N, F, F, F] },
  { name: "한유나", tags: ["홀"], week: [N, N, N, F, F, F, F] },
  { name: "신예은", tags: ["홀", "신입"], week: [N, E20, N, E20, N, E20, E20] },
  { name: "배지수", tags: ["주방", "리더"], week: [N, N, F, F, F, F, F] },
  { name: "조현우", tags: ["주방", "리더"], week: all(AM) },
  { name: "송다은", tags: ["주방"], week: all(F) },
  { name: "류승현", tags: ["주방"], week: [F, F, F, F, F, F, N] },
  { name: "문가영", tags: ["주방"], week: wk(PM, F, F) },
  { name: "권태윤", tags: ["주방"], week: [N, F, F, F, F, F, F] },
  { name: "홍채원", tags: ["주방", "신입"], week: [F, N, F, N, F, N, F] },
  { name: "양시우", tags: ["주방", "신입"], week: wk(PM, F, F) },
];
export const TYPED_STAFF = ["김도현", "서민호", "오지훈"];
/** 직원 화면에서 가능 시간을 직접 칠하는 사람. 화요일을 비운다. */
export const SCREEN_EMPLOYEE = "서민호";

/** ②에서 직접 입력하는 문장. 나머지는 미리 번역해 적용해 둔다. */
export const LIVE_SENTENCES = ["홀은 평일에 오픈 2명, 미들 1명, 마감 3명", "홀 마감과 주방 마감에는 리더가 꼭 1명씩 있어야 해"];
export const PRESET_SENTENCES = [
  "홀은 주말에 오픈 2명, 미들 2명, 마감 4명",
  "주방은 평일에 오픈 2명, 미들 1명, 마감 2명",
  "주방은 주말에 오픈 2명, 미들 1명, 마감 3명",
  "마감 다음 날 오픈은 안 되게",
  "일주일에 이틀은 꼭 쉬게",
  "마감에는 파트별로 신입이 1명까지만",
  "마감은 파트 안에서 돌아가면서 고르게",
  "근무 일수도 고르게",
];

/** 근무조 시간 바꾸기(장면 3): 기본 근무조의 끝 시각과 실근무 시간 */
const SHIFT_EDITS = [
  { code: "A", end: "14:00", hours: "5" },
  { code: "M", end: "16:00", hours: "4" },
  { code: "C", end: "21:00", hours: "4" },
];

/** 월~일 가능 시간 → 날짜별 슬롯. 불가인 날은 뺀다. */
export function slotsFor(week: Hours[], period: PeriodRange): Record<string, [string, string][]> {
  return Object.fromEntries(week.flatMap((h, i) => (h ? [[dateOfDay(period, i + 1), [h]]] : [])));
}

const monthDay = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

interface ShopDoc {
  version: number;
  state: { shop: Shop; periods: WorkPeriod[] } & Record<string, unknown>;
}

/** 입력칸을 비우고 사람이 치듯 새 값을 넣는다. */
async function retype(page: Page, label: string, text: string) {
  const box = page.getByRole("textbox", { name: label });
  await click(page, box);
  await box.press("ControlOrMeta+a");
  await box.pressSequentially(text, { delay: 90 });
  await pause(page, 400);
}

async function main() {
  process.loadEnvFile(".env.local");
  if (!(await fetch(`${APP_URL}/app`).catch(() => null))?.ok) throw new Error(`먼저 npm run dev를 띄워 주세요 (${APP_URL})`);

  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const db = createClient(url, anonKey, options);
  const { data: auth, error: authError } = await db.auth.signInWithPassword({ email: env("E2E_TEST_EMAIL"), password: env("E2E_TEST_PASSWORD") });
  if (authError) throw new Error(`테스트 계정 로그인 실패: ${authError.message}`);
  // 직원 제출은 로그인 없는 직원과 같은 경로(토큰 확인 DB 함수)로 한다
  const anon = createClient(url, anonKey, options);

  // 빈 매장에서 시작한다
  const { error: deleteError } = await db.from("shops").delete().eq("owner_id", auth.user.id);
  if (deleteError) throw new Error(deleteError.message);

  const videoDir = join(tmpdir(), `dining-video-${Date.now()}`);
  mkdirSync(videoDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: SIZE, locale: "ko-KR", timezoneId: "Asia/Seoul", recordVideo: { dir: videoDir, size: SIZE } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_URL });
  await context.addInitScript(cursorScript("manager@hangang.dining"));
  const page = await context.newPage();
  const started = Date.now();
  const now = () => (Date.now() - started) / 1000;
  const mark = (label: string) => console.log(`${now().toFixed(1)}s  ${label}`);
  /** 영상에서 잘라 낼 구간을 기록하며 fn을 돌린다. */
  const cuts: Segment[] = [];
  const cut = async <T>(fn: () => Promise<T>): Promise<T> => {
    const from = now();
    try {
      return await fn();
    } finally {
      cuts.push([from, now()]);
    }
  };
  const next = page.getByRole("button", { name: "다음", exact: true });
  const copyLink = page.getByRole("button", { name: "링크 복사" });
  /** /app을 다시 열면 서버에 마지막으로 저장된 화면(매장 홈, 매장 설정)일 수 있다. 그러면 [근무표] → [이어서 하기]로 ① 가능 시간에 들어간다. */
  const openPeriod = async () => {
    await page.goto(`${APP_URL}/app`);
    const resume = page.getByRole("button", { name: "이어서 하기" });
    const settings = page.getByRole("heading", { name: "매장 설정", exact: true });
    await copyLink.or(resume).or(settings).first().waitFor();
    if (await settings.isVisible().catch(() => false)) await page.getByRole("button", { name: "근무표", exact: true }).click();
    if (!(await copyLink.isVisible().catch(() => false))) await resume.click();
    await copyLink.waitFor();
  };

  try {
    // 1. 랜딩 → 로그인
    await page.goto(APP_URL);
    await pause(page, 2500);
    mark("1 랜딩");
    await click(page, page.getByText("내 매장으로 시작하기").first());
    await page.getByRole("heading", { name: "로그인" }).waitFor();
    await pause(page, 1800);

    // 2. 매장 준비: Google 로그인은 자동화할 수 없어 테스트 계정 세션을 넣고 이어 찍는다
    await cut(async () => {
      await page.evaluate(([key, session]) => localStorage.setItem(key, session), [authStorageKey(url), JSON.stringify(auth.session)]);
      await page.goto(`${APP_URL}/app`);
      await page.getByRole("heading", { name: "매장 준비" }).waitFor();
      await pause(page, 500);
    });
    mark("2 매장 준비");
    await pause(page, 1200);
    await type(page, page.getByRole("textbox", { name: "매장 이름" }), SHOP_NAME);
    const nameBox = page.getByRole("textbox", { name: "새 직원 이름" });
    // 직급 칸은 자동 완성 목록(datalist)이 붙어 textbox가 아니라 combobox다
    const tagBox = page.getByRole("combobox", { name: "새 직원 직급" });
    for (const { name, tags } of ROSTER.filter((r) => TYPED_STAFF.includes(r.name))) {
      await type(page, nameBox, name);
      await click(page, tagBox);
      for (const t of tags) {
        await tagBox.pressSequentially(t, { delay: 90 });
        await tagBox.press("Enter");
        await pause(page, 300);
      }
      await tagBox.press("Enter");
      await pause(page, 700);
    }
    await cut(async () => {
      for (const { name, tags } of ROSTER.filter((r) => !TYPED_STAFF.includes(r.name))) {
        await nameBox.fill(name);
        await tagBox.fill(`${tags.join(",")},`);
        await tagBox.press("Enter");
      }
      await pause(page, 300);
    });
    await pause(page, 1500);
    await click(page, page.getByRole("button", { name: "첫 근무표 시작하기" }));
    await copyLink.waitFor();

    // 3. 근무 형태: 매장 설정에서 근무조 시간을 맞춘다
    await pause(page, 1000);
    mark("3 근무 형태");
    await click(page, page.getByRole("button", { name: "매장 설정" }));
    await page.getByRole("textbox", { name: "A 끝 시각" }).waitFor();
    await pause(page, 1200);
    for (const s of SHIFT_EDITS) {
      await retype(page, `${s.code} 끝 시각`, s.end);
      await retype(page, `${s.code} 실근무 시간`, s.hours);
    }
    await pause(page, 1500);
    await click(page, page.getByRole("button", { name: "근무표", exact: true }));
    await click(page, page.getByRole("button", { name: "이어서 하기" }));
    await copyLink.waitFor();

    // 4. ① 가능 시간: 링크 복사, 0명 제출
    await pause(page, 1200);
    mark("4 ① 가능 시간");
    await click(page, copyLink);
    await pause(page, 2200);

    // 5. 직원 화면: 서민호가 화요일을 비우고 제출
    const { data: share, error: shareError } = await db.from("availability_shares").select("token, period_start").single();
    if (shareError) throw new Error(shareError.message);
    const period: PeriodRange = { start_date: share.period_start as string, length: 7 };
    await cut(async () => {
      await page.goto(`${APP_URL}/a/${share.token}`);
      await page.getByRole("heading", { name: "내 이름을 골라 주세요" }).waitFor();
      await pause(page, 300);
    });
    mark("5 직원 화면");
    await pause(page, 1500);
    await click(page, page.getByRole("button", { name: SCREEN_EMPLOYEE }));
    await page.getByRole("heading", { name: `${SHOP_NAME} · ${SCREEN_EMPLOYEE}님` }).waitFor();
    await pause(page, 1500);
    const minho = ROSTER.find((r) => r.name === SCREEN_EMPLOYEE)!;
    for (const [i, h] of minho.week.entries()) {
      if (h) await paint(page, monthDay(dateOfDay(period, i + 1)), "09:00~09:30", "20:30~21:00");
    }
    await pause(page, 800);
    await click(page, page.getByRole("button", { name: "제출" }));
    await page.getByText("제출했어요").waitFor();
    await pause(page, 1800);

    // 나머지 19명 제출
    await cut(async () => {
      const { data: roster, error } = await anon.rpc("get_availability_roster", { p_token: share.token });
      if (error) throw new Error(error.message);
      const tokens = new Map((roster as { employee_name: string; link_token: string }[]).map((r) => [r.employee_name, r.link_token]));
      for (const r of ROSTER.filter((x) => x.name !== SCREEN_EMPLOYEE)) {
        const { error: submitError } = await anon.rpc("submit_availability", { p_token: tokens.get(r.name), p_slots: slotsFor(r.week, period) });
        if (submitError) throw new Error(`${r.name} 제출 실패: ${submitError.message}`);
      }
      await openPeriod();
      await pause(page, 300);
    });

    // 6. ① 가능 시간: 새로고침 → 20명 중 20명
    mark("6 ① 제출 현황");
    await pause(page, 1200);
    await click(page, page.getByRole("button", { name: "새로고침" }));
    await page.locator("p").filter({ hasText: /20\s*명 중\s*20\s*명 제출/ }).waitFor();
    await pause(page, 2000);
    await page.mouse.wheel(0, 500);
    await pause(page, 2500);

    // 매장 조건 8문장을 앱과 같은 요청으로 번역해 적용해 둔다
    await cut(async () => {
      await page.getByText(/^저장됨/).waitFor();
      const { data: row, error } = await db.from("shops").select("data").single();
      if (error) throw new Error(error.message);
      const doc = row.data as ShopDoc;
      const { shop, periods } = doc.state;
      const { employees, period: range, holidays } = toScheduleRequest(shop, periods[0], periods, localDate(new Date()));
      const context = { config: shop.config, employees, period: range, holidays, today: localDate(new Date()) };
      const results = await Promise.all(
        PRESET_SENTENCES.map(async (text) => {
          const res = await fetch(`${APP_URL}/api/py/translate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, scope: "shop", context, input_version: 0 }),
          });
          const body = (await res.json()) as { status: string; constraints?: ConstraintSpec[] };
          if (!res.ok || body.status !== "ok") throw new Error(`"${text}" 번역 실패: ${JSON.stringify(body).slice(0, 300)}`);
          return body.constraints!;
        }),
      );
      const rules = [...shop.rules, ...results.flat()];
      const { error: updateError } = await db.from("shops").update({ data: { ...doc, state: { ...doc.state, shop: { ...shop, rules } } } }).eq("owner_id", auth.user.id);
      if (updateError) throw new Error(updateError.message);
      await openPeriod();
      await pause(page, 300);
    });

    // 7. ② 매장 조건: 두 문장만 직접 입력 → 카드 → 모두 적용
    await click(page, next);
    const ruleBox = page.getByRole("textbox", { name: "매장 조건 입력" });
    await ruleBox.waitFor();
    mark("7 ② 매장 조건");
    await pause(page, 2000);
    for (const text of LIVE_SENTENCES) {
      await type(page, ruleBox, text);
      const translated = page.waitForResponse((r) => r.url().includes("/api/py/translate"), { timeout: 90_000 });
      await click(page, page.getByRole("button", { name: "규칙 만들기", exact: true }));
      await cut(async () => {
        await translated;
        await pause(page, 600);
      });
      await pause(page, 2500);
    }
    const applyAll = page.getByRole("button", { name: "모두 적용" });
    if (await applyAll.isVisible().catch(() => false)) await click(page, applyAll);
    else for (const b of await page.locator("article").getByRole("button", { name: "적용", exact: true }).all()) await click(page, b);
    await pause(page, 1500);
    await page.getByRole("columnheader", { name: "근무조" }).scrollIntoViewIfNeeded();
    await pause(page, 3000);

    // 8. ③ 근무표 없음
    await click(page, next);
    const make = page.getByRole("button", { name: "근무표 만들기" });
    await make.waitFor();
    mark("8 ③ 근무표 없음");
    await pause(page, 1000);
    await click(page, make);
    const panel = page.locator("section").filter({ hasText: "이 조건으로는 근무표를 만들 수 없어요" }).first();
    await panel.waitFor({ timeout: 60_000 });
    await pause(page, 2500);
    const proposal = panel.locator("article").filter({ hasText: "반드시 → 가능하면" }).first();
    await cut(async () => {
      await page.getByText("원인을 분석하는 중…").waitFor({ state: "detached", timeout: 120_000 });
      // 제안 카드가 없으면 이 실행은 버린다(docs/DEMO_SCENARIO.md 녹화 조건)
      await proposal.waitFor({ timeout: 120_000 });
      await pause(page, 300);
    });
    await panel.scrollIntoViewIfNeeded();
    await pause(page, 2500);
    await click(page, panel.getByText("왜 만들 수 없나요?"));
    await pause(page, 4500);

    // 9. ③ 대안
    mark("9 ③ 대안");
    await proposal.scrollIntoViewIfNeeded();
    await page.mouse.move(SIZE.width / 2, SIZE.height / 2, { steps: 20 });
    await pause(page, 3500);

    // 10. ③ 근무표: 반드시 → 가능하면 수락
    await click(page, proposal.getByRole("button", { name: "수락" }));
    await page.getByText("반드시 규칙을 모두 지켰어요").waitFor({ timeout: 60_000 });
    mark("10 ③ 근무표");
    await pause(page, 1000);
    await page.getByText("반드시 규칙을 모두 지켰어요").scrollIntoViewIfNeeded();
    await pause(page, 3000);
    await page.locator('ul[aria-label="근무조"]').scrollIntoViewIfNeeded();
    await pause(page, 4000);

    // 11. 확정
    await click(page, page.getByRole("button", { name: "확정", exact: true }));
    await page.getByRole("heading", { name: "변경 입력" }).waitFor();
    mark("11 확정");
    await pause(page, 3000);
  } finally {
    await context.close();
    await browser.close();
  }

  const webm = await page.video()?.path();
  if (!webm) throw new Error("녹화 파일이 없어요");
  mkdirSync("public", { recursive: true });
  const tmpOut = join(videoDir, "dining.mp4");
  encode(webm, tmpOut, cuts);
  renameSync(tmpOut, OUT);
  const cutSeconds = cuts.reduce((sum, [a, b]) => sum + (b - a), 0);
  console.log(`${OUT} 저장: 녹화 ${now().toFixed(0)}초 중 ${cutSeconds.toFixed(0)}초를 잘라 냄 (원본 ${webm})`);
}

if (!process.env.VITEST) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
