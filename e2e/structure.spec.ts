// docs/BROWSER_TEST_SCENARIOS.md S14, S15. 매장이 정하는 근무 형태(피크 추가, 더블), 태그 배치 규칙, 근무표 시작일을
// 매장 준비부터 다음 근무표까지 하나의 흐름으로 돈다. LLM은 mock하지 않는다(ADR-013).
// LLM 해석은 흔들릴 수 있어 카드 문장은 핵심 낱말만 본다.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { ruleShape } from "../lib/rules";
import type { PeriodRange } from "../lib/period";
import type { ScheduleRequest } from "../lib/types.gen";
import {
  addRoster,
  applyAllPending,
  clearAccount,
  EMPLOYEE_COUNT,
  expectHardRulesHold,
  expectNoDevTerms,
  expectNoProblems,
  interpret,
  interpretOk,
  loginAsTestUser,
  openFlow,
  pendingCards,
  primaryButtons,
  readGrid,
  readState,
  ROSTER,
  savedDoc,
  scheduleTitle,
  shownLinks,
  solveVia,
  submitFullDay,
} from "./test-helpers";

// [요일 종류, 근무 이름, 인원] (D5)
const COVERAGE: [string, string, number][] = [
  ["평일", "오픈", 2],
  ["평일", "미들", 1],
  ["평일", "마감", 2],
  ["평일", "피크", 1],
  ["주말·공휴일", "오픈", 2],
  ["주말·공휴일", "미들", 2],
  ["주말·공휴일", "마감", 3],
  ["주말·공휴일", "피크", 1],
];
const FIRST: PeriodRange = { start_date: "2026-11-15", length: 30 };
const RULE_INPUT = "매장 조건 입력";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let problems: string[] = [];
let lastSolve: ScheduleRequest | undefined;
let firstLinks: string[];

const stepper = () => page.getByRole("list", { name: "근무표 작성 단계" });

async function solve(action: () => Promise<void>) {
  const { status, request } = await solveVia(page, action);
  lastSolve = request;
  return status;
}

test.beforeAll(async ({ browser }) => {
  ({ context, page, problems } = await openFlow(browser));
});

test.afterAll(async () => {
  await context.close();
});

test.afterEach(async () => {
  await expectNoProblems(page, problems);
});

test("S14. 시작일 15일과 근무 형태(피크 추가, 더블), 태그 배치 규칙", async () => {
  await clearAccount();
  await page.goto("/app");
  await loginAsTestUser(page);
  await page.getByRole("textbox", { name: "매장 이름" }).fill("연남 카페");
  await page.getByRole("combobox", { name: "근무표 주기" }).selectOption({ label: "한 달(1일~말일)" });
  await addRoster(page, ROSTER);
  await expect(page.getByRole("button", { name: "6행 태그 리더 빼기" })).toBeVisible();
  const { shop: afterRoster } = await readState(page);
  expect(afterRoster.employees.filter((n) => n.tags.includes("리더")).map((n) => n.name)).toEqual(["이영희", "강서연", "윤지민"]);
  expect(afterRoster.employees.filter((n) => n.tags.includes("신입")).map((n) => n.name)).toEqual(["서예린", "신도윤"]);

  await page.getByRole("button", { name: "첫 근무표 시작하기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11월 근무표");

  // ① 시작일: 달력 월 단위는 1~28일만, 시작일이 바뀌면 링크를 새로 만든다
  await page.getByRole("button", { name: "바꾸기" }).click();
  const start = page.getByLabel("시작일");
  await expect(start).toHaveValue("2026-11-01");
  await expect(page.getByRole("button", { name: "링크 복사" })).toHaveCount(EMPLOYEE_COUNT);
  const before = await shownLinks(page);
  await start.fill("2026-11-29");
  await expect(page.getByText("한 달 근무표는 1~28일에만 시작할 수 있어요. 다른 날을 골라 주세요.")).toBeVisible();
  await start.fill(FIRST.start_date);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11/15~12/14 근무표");
  await expect(page.getByRole("main")).toContainText("2026.12.14 · 30일");
  await expect.poll(async () => (await shownLinks(page)).filter((l) => before.includes(l)).length, { message: "링크가 모두 새것" }).toBe(0);
  await expect(page.getByRole("button", { name: "링크 복사" })).toHaveCount(EMPLOYEE_COUNT);
  firstLinks = await shownLinks(page);
  await expectNoDevTerms(page, "① 가능 시간(시작일 15일)");
  await submitFullDay(FIRST, EMPLOYEE_COUNT);
  await page.getByRole("button", { name: "접기" }).first().click();
  await page.getByRole("button", { name: "다음", exact: true }).click();

  // ② 근무 형태: 요약표 [바꾸기] → 근무 코드 표에 피크(P) 추가 → 필요 인원 폼에 피크 행이 생긴다
  await expect(stepper().locator('[aria-current="step"]')).toContainText("매장 조건");
  const summaryRow = (name: string) => page.getByRole("row").filter({ hasText: name }).first();
  await expect(summaryRow("오픈")).toContainText("09:00~15:00");
  await expect(summaryRow("미들")).toContainText("12:00~18:00");
  await expect(summaryRow("마감")).toContainText("17:00~23:00");
  await page.getByRole("button", { name: "숫자로 입력하기" }).click();
  await expect(page.getByRole("textbox", { name: "평일 피크 최소 인원" })).toHaveCount(0);
  const change = page.getByRole("button", { name: "바꾸기" });
  await expect(change).toHaveAttribute("aria-expanded", "false");
  await change.click();
  await expect(page.getByRole("button", { name: "접기" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("textbox", { name: "A 끝 시각" })).toHaveValue("15:00");
  await expect(page.getByRole("textbox", { name: "A 실근무 시간" })).toHaveValue("6");
  await page.getByRole("textbox", { name: "새 근무 코드" }).fill("P");
  await page.getByRole("textbox", { name: "새 근무 이름" }).fill("피크");
  await page.getByRole("textbox", { name: "새 근무 시작 시각" }).fill("11:00");
  await page.getByRole("textbox", { name: "새 근무 끝 시각" }).fill("14:00");
  await page.getByRole("textbox", { name: "새 근무 실근무 시간" }).fill("3");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "P 이름" })).toHaveValue("피크");
  await expect(page.getByRole("textbox", { name: "P 끝 시각" })).toHaveValue("14:00");
  await expect(page.getByRole("textbox", { name: "P 실근무 시간" })).toHaveValue("3");
  for (const [kind, shift, count] of COVERAGE) {
    await page.getByRole("textbox", { name: `${kind} ${shift} 최소 인원` }).fill(String(count));
    await page.getByRole("textbox", { name: `${kind} ${shift} 최대 인원` }).fill(String(count));
  }
  await expectNoDevTerms(page, "② 근무 형태 펼침");

  // 말로 더블 허용 → 설정 카드(근무 형태) + 딸린 규칙 카드. 딸린 카드를 적용하면 설정 카드도 함께 적용된다
  const doubleText = "오픈+마감 더블 허용, 한 사람당 한 달 2번까지";
  const body = await interpret(page, RULE_INPUT, "규칙 만들기", doubleText);
  expect(body.status, `"${doubleText}" 해석 상태`).toBe("ok");
  if (body.status !== "ok") return;
  const doubles = (body.config_changes ?? []).filter((c) => c.action === "add" && [...(c.shift.parts ?? [])].sort().join() === "A,C");
  expect(doubles, "A와 C를 세는 더블 코드 추가").toHaveLength(1);
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
  const childCard = pendingCards(page).filter({ hasText: `근무 코드 ${dCode} 추가가 함께 적용돼요` });
  await expect(childCard).toHaveCount(1);
  await childCard.getByRole("button", { name: "적용", exact: true }).click();
  await expect(pendingCards(page)).toHaveCount(0);
  const { shop: afterDouble } = await readState(page);
  const added = afterDouble.config.shifts.find((s) => s.code === dCode);
  expect([...(added?.parts ?? [])].sort(), "더블이 오픈·마감으로 센다").toEqual(["A", "C"]);
  expect(afterDouble.rules.some((r) => r.id === limits[0].id), "규칙이 함께 적용됨").toBe(true);

  // 태그 배치 규칙
  const tagText = "리더는 매일 오픈에 1명 이상 있어야 해";
  const tagCards = await interpretOk(page, RULE_INPUT, "규칙 만들기", tagText);
  expect(tagCards.length).toBeGreaterThan(0);
  for (const c of tagCards) {
    const s = ruleShape(c);
    expect(s?.kind).toBe("count");
    if (s?.kind === "count") {
      expect(s.people.tags, "리더 태그 대상").toEqual(["리더"]);
      expect(s.min?.n).toBe(1);
      expect(s.shifts.in).toContain("A");
    }
  }
  await expect(pendingCards(page).first()).toContainText("리더");
  await expect(pendingCards(page).first()).toContainText("1명");
  await applyAllPending(page);
  await expectNoDevTerms(page, "② 적용 뒤");
});

test("S15. 피크·더블 근무표 → 다음 근무표 시작일 미루기", async () => {
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(scheduleTitle(page)).toBeVisible();
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("ok");
  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  expect(lastSolve!.period).toEqual(FIRST);
  const peak = lastSolve!.config!.shifts.find((s) => s.code === "P");
  expect({ end: peak?.end, hours: peak?.hours }).toEqual({ end: "14:00", hours: 3 });
  await expectHardRulesHold(page, FIRST, lastSolve);
  const grid = await readGrid(page, FIRST);
  for (let d = 0; d < FIRST.length; d++) {
    expect(Object.values(grid).filter((row) => row[d] === "P").length, `${d + 1}번째 날 피크`).toBe(1);
  }
  const stats = page.locator("section").filter({ has: page.getByRole("heading", { name: "개인별 통계", exact: true }) });
  for (const h of ["P", "근무 시간"]) await expect(stats.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
  // 편집 바의 고정 선택지에도 피크가 있다
  await page.getByRole("button", { name: /^이영희 11월 20일 [A-Z0-9]{1,3}$/ }).click();
  await expect(page.getByRole("button", { name: "P로 고정" })).toBeVisible();
  await page.getByRole("button", { name: "취소" }).click();
  await expectNoDevTerms(page, "③ 근무표(피크·더블)");

  // 확정 → 홈: 다음 근무표는 이어지는 날(12/15)부터
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "확정", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "← 근무표 목록" }).click();
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("12/15~1/14 근무표 만들기");
  await primaryButtons(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("12/15~1/14 근무표");
  await expect(stepper().locator('[aria-current="step"]')).toContainText("가능 시간");
  await expect(page.getByRole("main")).toContainText("지난 근무표에서 이어져요");
  await expect(page.getByRole("button", { name: "링크 복사" })).toHaveCount(EMPLOYEE_COUNT);
  expect((await shownLinks(page)).filter((l) => firstLinks.includes(l)), "링크는 근무표마다 새로 만든다").toEqual([]);

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
  await expect.poll(async () => (await savedDoc())?.state.periods.map((p) => p.start_date), { message: "저장된 시작일" }).toEqual([
    FIRST.start_date,
    "2026-12-20",
  ]);
  await expectNoDevTerms(page, "① 가능 시간(시작일 미룸)");
});
