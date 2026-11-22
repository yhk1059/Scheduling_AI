// 랜딩 데모 영상(docs/DEMO_SCENARIO.md, 한강 다이닝) 녹화. 테스트 계정의 매장을 지우고 빈 매장부터 실제 앱을 Playwright로 돌리며 녹화한다.
// 실행: npm run dev를 띄운 채 npm run record:dining → public/demo.mp4 (ffmpeg 필요). 화면이 바뀌면 다시 돌려 영상을 새로 만든다.
// 직원 17명 입력, 가능 시간 19명 제출, 미리 넣는 매장 조건 3문장은 녹화 뒤 잘라 낸다.
// LLM은 부르지 않는다: 매장 조건은 체험(/demo)과 같은 5문장이고, /translate·/explain은 체험 문서(lib/samples/demo-shop.json)에 저장한 응답으로 돌려준다.
import { mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { demoCards, demoExplanation } from "../lib/demo";
import { DEMO_DOC } from "../lib/demo-doc";
import { dateOfDay, type PeriodRange } from "../lib/period";
import type { Shop, WorkPeriod } from "../lib/store";
import type { ExplainRequest, TranslateOk } from "../lib/types.gen";
import { DEMO_LIVE_SENTENCES, DEMO_PRESET_SENTENCES, ROSTER, SCREEN_EMPLOYEE, SHIFT_EDITS, SHOP_NAME, slotsFor, TYPED_STAFF } from "./dining-data";
import { authStorageKey, click, cursorScript, encode, env, paint, pause, type Segment, type } from "./record-kit";

export { ROSTER, SCREEN_EMPLOYEE, slotsFor, TYPED_STAFF };
/** 영상에서 직접 입력하는 문장과 미리 적용해 두는 문장(체험과 같다). */
export const LIVE_SENTENCES = DEMO_LIVE_SENTENCES;
export const PRESET_SENTENCES = DEMO_PRESET_SENTENCES;
/** 미리 적용해 두는 규칙: 체험 문서의 적용된 규칙(기본 규칙 포함, 같은 id는 이 내용으로 바꾼다). */
export const PRESET_RULES = DEMO_DOC.shop.rules;

/** 체험 문서에 저장한 번역. 직접 입력 문장이 아니면 null. */
export function storedTranslation(text: string, inputVersion: number): TranslateOk | null {
  const constraints = demoCards(DEMO_DOC, text);
  if (!constraints) return null;
  const examples = Object.fromEntries(Object.entries(DEMO_DOC.shop.examples ?? {}).filter(([id]) => constraints.some((c) => c.id === id)));
  return { status: "ok", input_version: inputVersion, constraints, examples };
}

const APP_URL = "http://localhost:3000";
const SIZE = { width: 1440, height: 900 };
const OUT = "public/demo.mp4";

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
  // LLM 대신 저장된 응답. 실제 응답처럼 잠깐 기다린다(그 구간은 잘라 낸다). 저장된 응답이 맞지 않으면 요청을 끊고 녹화 끝에 그 이유로 실패한다
  let mockFailure: string | null = null;
  await context.route("**/api/py/translate", async (route) => {
    const body = route.request().postDataJSON() as { text: string; input_version?: number };
    const res = storedTranslation(body.text, body.input_version ?? 0);
    if (!res) {
      mockFailure = `"${body.text}"의 저장된 번역이 없어요`;
      return route.abort();
    }
    await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({ json: res });
  });
  await context.route("**/api/py/explain", async (route) => {
    const { request } = route.request().postDataJSON() as ExplainRequest;
    const res = demoExplanation(DEMO_DOC, request, request.input_version);
    if (!res) {
      mockFailure = "저장된 설명과 지금 규칙이 달라요. npm run gen:demo-shop으로 체험 문서를 다시 만들어 주세요";
      return route.abort();
    }
    await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({ json: res });
  });
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
  const next = page.getByRole("button", { name: /^다음:/ });
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
    const tagBox = page.getByRole("combobox", { name: "새 직원 파트·직급" });
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

    // 매장 조건 3문장은 저장된 규칙으로 적용해 둔다(같은 id의 기본 규칙은 저장된 내용으로 바꾼다)
    await cut(async () => {
      await page.getByText(/^저장됨/).waitFor();
      const { data: row, error } = await db.from("shops").select("data").single();
      if (error) throw new Error(error.message);
      const doc = row.data as ShopDoc;
      const { shop } = doc.state;
      const presetIds = new Set(PRESET_RULES.map((r) => r.id));
      const rules = [...shop.rules.filter((r) => !presetIds.has(r.id)), ...PRESET_RULES];
      const examples = { ...shop.examples, ...Object.fromEntries(Object.entries(DEMO_DOC.shop.examples ?? {}).filter(([id]) => presetIds.has(id))) };
      const { error: updateError } = await db
        .from("shops")
        .update({ data: { ...doc, state: { ...doc.state, shop: { ...shop, rules, examples } } } })
        .eq("owner_id", auth.user.id);
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
    const allKept = page.getByText("반드시 규칙 모두 지킴", { exact: true }).first();
    await allKept.waitFor({ timeout: 60_000 });
    mark("10 ③ 근무표");
    await pause(page, 1000);
    await allKept.scrollIntoViewIfNeeded();
    await pause(page, 3000);
    await page.locator('ul[aria-label="근무조"]').scrollIntoViewIfNeeded();
    await pause(page, 4000);

    // 11. 확정
    await click(page, page.getByRole("button", { name: "확정", exact: true }));
    // 확인 대화상자의 [확정]
    const confirmDialog = page.getByRole("dialog", { name: "근무표를 확정할까요?" });
    await pause(page, 1500);
    await click(page, confirmDialog.getByRole("button", { name: "확정", exact: true }));
    await page.getByRole("heading", { name: "변경 입력" }).waitFor();
    mark("11 확정");
    await pause(page, 3000);
  } finally {
    await context.close();
    await browser.close();
    if (mockFailure) throw new Error(mockFailure);
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
