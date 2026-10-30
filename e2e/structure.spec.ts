// docs/BROWSER_TEST_SCENARIOS.md S14, S15. 매장이 정하는 근무 형태(M 추가, 더블), 태그 배치 규칙, 근무표 시작일을
// 처음 설정부터 다음 근무표까지 하나의 흐름으로 돈다. 게스트 모드만 다룬다(ADR-014). LLM은 mock하지 않는다(ADR-013).
// LLM 해석은 흔들릴 수 있어 카드 문장은 핵심 낱말만 본다.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { ruleShape } from "../lib/rules";
import type { PeriodRange } from "../lib/period";
import type { ScheduleRequest } from "../lib/types.gen";
import {
  applyAllPending,
  expectHardRulesHold,
  expectNoDevTerms,
  interpret,
  interpretOk,
  pendingCards,
  primaryButtons,
  readGrid,
  readState,
  scheduleTitle,
  solveVia,
  T0,
} from "./test-helpers";

// [이름, 연차, 태그] 12명 · 책임 3명 (BROWSER_TEST_SCENARIOS D5)
const ROSTER: [string, number, string | null][] = [
  ["이영희", 12, "책임"],
  ["박민수", 9, null],
  ["김철수", 7, null],
  ["정유진", 5, "책임"],
  ["최지훈", 3, null],
  ["강서연", 15, "책임"],
  ["윤지민", 10, null],
  ["임하늘", 8, null],
  ["한소율", 6, null],
  ["오민준", 4, null],
  ["서예린", 2, null],
  ["신도윤", 1, null],
];
// [요일 종류, 근무 이름, 인원]
const COVERAGE: [string, string, number][] = [
  ["평일", "데이", 3],
  ["평일", "이브닝", 2],
  ["평일", "나이트", 2],
  ["평일", "미드", 1],
  ["주말·공휴일", "데이", 2],
  ["주말·공휴일", "이브닝", 2],
  ["주말·공휴일", "나이트", 2],
  ["주말·공휴일", "미드", 1],
];
const FIRST: PeriodRange = { start_date: "2026-11-15", length: 30 };
const RULE_INPUT = "병동 규칙 입력";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let problems: string[] = [];
let lastSolve: ScheduleRequest | undefined;

const setupStepper = () => page.getByRole("list", { name: "처음 설정 단계" });

async function solve(action: () => Promise<void>) {
  const { status, request } = await solveVia(page, action);
  lastSolve = request;
  return status;
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul", viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  await page.clock.setFixedTime(T0);
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && !r.ok()) problems.push(`api ${r.status()} ${r.url()}`);
  });
});

test.afterAll(async () => {
  await context.close();
});

test.beforeEach(() => {
  problems = [];
});

test.afterEach(async () => {
  await expect(page.getByRole("alert").filter({ hasText: "다시 시도" })).toHaveCount(0);
  expect(problems, "콘솔 오류·API 실패").toEqual([]);
});

test("S14. 근무 형태(미드 추가, 더블)와 태그 배치 규칙", async () => {
  await page.goto("/app");
  await page.getByRole("button", { name: "내 병동으로 시작하기" }).click();
  await page.getByRole("textbox", { name: "병동 이름" }).fill("외래 병동");

  // ① 명단: 태그 칸에 "책임"을 적고 Enter(입력 줄에 적다 만 태그도 함께 들어간다)
  const newName = page.getByRole("textbox", { name: "새 간호사 이름" });
  const newYears = page.getByRole("textbox", { name: "새 간호사 연차" });
  const newTag = page.getByRole("combobox", { name: "새 간호사 태그" });
  for (const [name, years, tag] of ROSTER) {
    await newName.fill(name);
    await newYears.fill(String(years));
    if (tag) await newTag.fill(tag);
    await newYears.press("Enter");
    await expect(newName).toHaveValue("");
  }
  await expect(page.getByRole("button", { name: "6행 태그 책임 빼기" })).toBeVisible();
  const { shop: afterRoster } = await readState(page);
  expect(afterRoster.employees.filter((n) => n.tags.includes("책임")).map((n) => n.name)).toEqual(["이영희", "정유진", "강서연"]);
  await page.getByRole("button", { name: "다음", exact: true }).click();

  // ② 근무 형태 요약 [바꾸기] → 근무 코드 표에 미드(M) 추가 → 필요 인원 폼에 미드 행이 생긴다
  await expect(setupStepper().locator('[aria-current="step"]')).toContainText("병동 소개");
  await expect(page.getByRole("main")).toContainText("데이·이브닝·나이트 3교대, 각 8시간");
  await page.getByRole("button", { name: "숫자로 입력하기" }).click();
  const change = page.getByRole("button", { name: "바꾸기" });
  await expect(change).toHaveAttribute("aria-expanded", "false");
  await change.click();
  await expect(page.getByRole("button", { name: "접기" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("textbox", { name: "평일 미드 최소 인원" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "새 근무 코드" }).fill("M");
  await page.getByRole("textbox", { name: "새 근무 이름" }).fill("미드");
  await page.getByLabel("새 근무 시작 시각").fill("11:00");
  await page.getByRole("textbox", { name: "새 근무 시간" }).fill("8");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "M 이름" })).toHaveValue("미드");
  await expect(page.getByRole("main")).toContainText("미드");
  for (const [kind, shift, count] of COVERAGE) {
    await page.getByRole("textbox", { name: `${kind} ${shift} 최소 인원` }).fill(String(count));
    await page.getByRole("textbox", { name: `${kind} ${shift} 최대 인원` }).fill(String(count));
  }
  await expectNoDevTerms(page, "처음 설정 ②(근무 형태 펼침)");
  await page.getByRole("button", { name: "다음", exact: true }).click();

  // ③ 말로 더블 허용 → 설정 카드(근무 형태) + 딸린 규칙 카드. 딸린 카드를 적용하면 설정 카드도 함께 적용된다
  await expect(setupStepper().locator('[aria-current="step"]')).toContainText("병동 규칙");
  const doubleText = "D+E 더블 허용, 한 사람당 한 달 2번까지";
  const body = await interpret(page, RULE_INPUT, "규칙 만들기", doubleText);
  expect(body.status, `"${doubleText}" 해석 상태`).toBe("ok");
  if (body.status !== "ok") return;
  const doubles = (body.config_changes ?? []).filter((c) => c.action === "add" && [...(c.shift.parts ?? [])].sort().join() === "D,E");
  expect(doubles, "D와 E를 세는 더블 코드 추가").toHaveLength(1);
  const dCode = doubles[0].shift.code;
  const limits = body.constraints.filter((c) => {
    const s = ruleShape(c);
    return s?.kind === "count" && s.per === "person" && s.shifts.in?.includes(dCode) && s.max?.n === 2;
  });
  expect(limits, `${dCode} 사람마다 2번까지`).toHaveLength(1);
  test.info().annotations.push({ type: "더블 코드", description: dCode });

  const configCard = pendingCards(page).filter({ has: page.getByRole("heading", { name: "근무 형태" }) });
  await expect(configCard).toHaveCount(1);
  await expect(configCard).toContainText("근무 코드 추가");
  await expect(configCard).toContainText(dCode);
  const together = page.getByText(`근무 코드 ${dCode} 추가가 함께 적용돼요`);
  await expect(together).toHaveCount(1);
  const childCard = pendingCards(page).filter({ hasText: `근무 코드 ${dCode} 추가가 함께 적용돼요` });
  await expect(childCard).toContainText("2");
  await childCard.getByRole("button", { name: "적용", exact: true }).click();
  await expect(pendingCards(page)).toHaveCount(0);
  const { shop: afterDouble } = await readState(page);
  const added = afterDouble.config.shifts.find((s) => s.code === dCode);
  expect([...(added?.parts ?? [])].sort(), "더블이 데이·이브닝으로 센다").toEqual(["D", "E"]);
  expect(
    afterDouble.rules.some((r) => {
      const s = ruleShape(r);
      return r.id === limits[0].id || (s?.kind === "count" && s.shifts.in?.includes(dCode));
    }),
  ).toBe(true);

  // 태그 배치 규칙: 책임 태그가 매일 데이에 1명 이상
  const tagText = "책임 간호사는 매일 데이에 1명 이상 있어야 해";
  const tagCards = await interpretOk(page, RULE_INPUT, "규칙 만들기", tagText);
  expect(tagCards.length).toBeGreaterThan(0);
  for (const c of tagCards) {
    const s = ruleShape(c);
    expect(s?.kind).toBe("count");
    if (s?.kind === "count") {
      expect(s.people.tags, "책임 태그 대상").toEqual(["책임"]);
      expect(s.min?.n).toBe(1);
      expect(s.shifts.in).toContain("D");
    }
  }
  await expect(pendingCards(page).first()).toContainText("책임");
  await expect(pendingCards(page).first()).toContainText("1명");
  await applyAllPending(page);
  await expectNoDevTerms(page, "처음 설정 ③(근무 형태·태그 규칙 적용 뒤)");

  const createFirst = page.getByRole("button", { name: "첫 근무표 만들기" });
  await expect(createFirst).toBeEnabled();
  await createFirst.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11월 근무표");
});

test("S15. 첫 근무표 시작일 15일 → 미드·더블 근무표 → 다음 근무표 시작일 미루기", async () => {
  // ① 준비 요약 [바꾸기] → 시작일. 달력 월 단위는 1~28일만, 그 밖은 오류
  await page.getByRole("button", { name: "바꾸기" }).click();
  const start = page.getByLabel("시작일");
  await expect(start).toHaveValue("2026-11-01");
  await start.fill("2026-11-29");
  await expect(page.getByText("한 달 근무표는 1~28일에만 시작할 수 있어요. 다른 날을 골라 주세요.")).toBeVisible();
  await start.fill(FIRST.start_date);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11/15~12/14 근무표");
  await expect(page.getByRole("main")).toContainText("2026.12.14 · 30일");
  await page.getByRole("button", { name: "접기" }).first().click();
  await expectNoDevTerms(page, "① 요청(시작일 15일)");

  // ② 근무표: 미드 칸이 날마다 1명, 더블은 사람마다 2번까지, 책임 태그가 날마다 데이 1명 이상
  await page.getByRole("button", { name: "다음" }).click();
  await expect(scheduleTitle(page)).toBeVisible();
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("ok");
  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  expect(lastSolve!.period).toEqual(FIRST);
  const codes = lastSolve!.config!.shifts.map((s) => s.code);
  expect(codes).toContain("M");
  await expectHardRulesHold(page, FIRST, lastSolve);
  const grid = await readGrid(page, FIRST);
  for (let d = 0; d < FIRST.length; d++) {
    expect(Object.values(grid).filter((row) => row[d] === "M").length, `${d + 1}번째 날 미드`).toBe(1);
  }
  const stats = page.locator("section").filter({ has: page.getByRole("heading", { name: "개인별 통계", exact: true }) });
  for (const h of ["M", "근무 시간"]) await expect(stats.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
  // 편집 바의 고정 선택지에도 미드가 있다
  const someCell = page.getByRole("button", { name: new RegExp(`^이영희 11월 20일 [A-Z0-9]{1,3}$`) });
  await someCell.click();
  await expect(page.getByRole("button", { name: "M로 고정" })).toBeVisible();
  await page.getByRole("button", { name: "취소" }).click();
  await expectNoDevTerms(page, "② 근무표(미드·더블)");

  // 확정 → 홈: 다음 근무표는 이어지는 날(12/15)부터
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "확정했어요. 이 브라우저에만 저장돼 있어요" })).toBeVisible();
  await page.getByRole("button", { name: "← 근무표 목록" }).click();
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("12/15~1/14 근무표 만들기");
  await primaryButtons(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("12/15~1/14 근무표");
  await expect(page.getByRole("main")).toContainText("지난 근무표에서 이어져요");

  // [시작일 미루기]: 이어지는 날보다 앞은 오류, 뒤로 미루면 지난 근무가 끊겨 직접 입력한다
  await page.getByRole("button", { name: "바꾸기" }).click();
  await page.getByRole("button", { name: "시작일 미루기" }).click();
  const later = page.getByLabel("시작일");
  await expect(later).toHaveValue("2026-12-15");
  await later.fill("2026-12-10");
  await expect(page.getByText("지난 근무표 다음 날(12/15) 이후로 골라 주세요.")).toBeVisible();
  await later.fill("2026-12-20");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("12/20~1/19 근무표");
  await expect(page.getByText("지난 근무표와 이어지지 않아서 지난 근무를 직접 입력해요")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("지난 근무 없음");
  const { periods } = await readState(page);
  expect(periods.map((p) => p.start_date)).toEqual([FIRST.start_date, "2026-12-20"]);
  await expectNoDevTerms(page, "① 요청(시작일 미룸)");
});
