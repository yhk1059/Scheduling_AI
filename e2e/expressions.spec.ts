// docs/BROWSER_TEST_SCENARIOS.md S16~S18. 식 규칙(ADR-019): 저장된 매장 열기, 조건부·짝 규칙과 예시 판정, 값 수정,
// 말로 적는 필요 인원, 사람이 모자란 필요 인원. 페이지 하나를 공유하며 순서대로 돈다.
// LLM은 mock하지 않는다(ADR-013). LLM 해석은 흔들릴 수 있어 카드 문장은 핵심 낱말만 본다.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import shopOct from "./fixtures/shop-oct.json";

import type { PeriodRange } from "../lib/period";
import type { Shop } from "../lib/store";
import type { ConstraintSpec, ScheduleRequest } from "../lib/types.gen";
import {
  addRoster,
  applyAllPending,
  clearAccount,
  expectHardRulesHold,
  expectNoDevTerms,
  expectNoProblems,
  expectSaved,
  interpret,
  loginAsTestUser,
  openFlow,
  pendingCards,
  periodByStart,
  readGrid,
  readState,
  ROSTER,
  scheduleTitle,
  seedShop,
  solveVia,
  submitFullDay,
} from "./test-helpers";

const NOV: PeriodRange = { start_date: "2026-11-02", length: 28 };
const NOV_NAME = "11/2~11/29 근무표";
const WEEK: PeriodRange = { start_date: "2026-11-02", length: 7 };
const WEEKEND_DAYS = [6, 7]; // 11/7, 11/8
const RULE_INPUT = "매장 조건 입력";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let problems: string[] = [];
let lastSolve: ScheduleRequest | undefined;

const sectionWith = (heading: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

async function solve(action: () => Promise<void>) {
  const { status, request } = await solveVia(page, action);
  lastSolve = request;
  return status;
}

/** 규칙 입력 → ok 응답의 규칙과 예시. */
async function makeRules(text: string) {
  const body = await interpret(page, RULE_INPUT, "규칙 만들기", text);
  expect(body.status, `"${text}" 해석 상태`).toBe("ok");
  return body.status === "ok" ? body : null;
}

const namesWithTag = (shop: Shop, tag: string) => shop.employees.filter((n) => n.tags.includes(tag)).map((n) => n.name);

test.beforeAll(async ({ browser }) => {
  ({ context, page, problems } = await openFlow(browser));
});

test.afterAll(async () => {
  await context.close();
});

test.afterEach(async () => {
  await expectNoProblems(page, problems);
});

test("S16. 저장된 매장 열기 → 다시 만들기", async () => {
  await clearAccount();
  await seedShop(shopOct as never);
  await page.goto("/app");
  await loginAsTestUser(page);
  await expect(page.getByRole("heading", { name: "성수 카페", level: 1 })).toBeVisible();

  const { shop } = await readState(page);
  const savedRules = shopOct.state.shop.rules;
  expect(shop.rules.map((r) => r.id), "규칙 수와 id가 같다").toEqual(savedRules.map((r) => r.id));
  expect(shop.rules.every((r) => r.type === "rule"), "모두 식 규칙").toBe(true);
  const savedNov = shopOct.state.periods.find((p) => p.start_date === NOV.start_date)!;
  const nov = await periodByStart(page, NOV.start_date);
  expect(nov.requests.map((r) => r.id), "요청도 같은 id").toEqual(savedNov.requests.map((r) => r.id));
  expect(namesWithTag(shop, "리더")).toEqual(["이영희", "강서연", "윤지민"]);
  expect(namesWithTag(shop, "신입")).toEqual(["서예린", "신도윤"]);
  await expect(page.getByRole("main")).toContainText("직원 12명 · 매장 조건 7개 · 4주 단위");
  await expectNoDevTerms(page, "매장 홈");

  await sectionWith(NOV_NAME).getByRole("button", { name: "이어서 하기" }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(scheduleTitle(page)).toBeVisible();
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("ok");
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expectHardRulesHold(page, NOV, lastSolve);
});

test("S17. 조건부·짝 규칙 → 예시 판정 → 적용 → 값 수정 → 다시 만들기", async () => {
  await page.getByRole("button", { name: "매장 설정", exact: true }).click();
  await page.getByRole("tab", { name: "매장 조건" }).click();
  await expect(page.locator("article").first().getByText("기본", { exact: true })).toBeVisible();

  // 조건부: 신입이 마감이면 리더도 마감에
  const conditional = await makeRules("신입이 마감이면 리더도 마감에 1명");
  const condRules = (conditional?.constraints ?? []).filter((c) => c.type === "rule" && c.body.kind === "require" && c.body.when);
  expect(condRules.length, "조건(만약 ~면)이 있는 규칙").toBeGreaterThan(0);
  const condCard = pendingCards(page).first();
  for (const word of ["신입", "리더", "마감", "1명"]) await expect(condCard).toContainText(word);
  // 예시 판정: 서버가 샘플 근무표에서 찾은 위반 사례(≤3)
  const examples = conditional!.examples?.[condRules[0].id] ?? [];
  expect(examples.length, "예시 판정").toBeGreaterThan(0);
  expect(examples.length).toBeLessThanOrEqual(3);
  await expect(condCard.getByText("이런 근무면 이 규칙에 어긋나요")).toBeVisible();
  await expect(condCard.locator("table")).toHaveCount(examples.length);
  await expect(condCard.locator('[aria-label$=" 어긋남"]').first()).toBeVisible();
  await expectNoDevTerms(page, "매장 조건(조건부 대기 카드)");
  await applyAllPending(page);
  const appliedCond = page.locator("article").filter({ hasText: conditional!.constraints[0].source_text }).first();
  const showExamples = appliedCond.getByRole("button", { name: "예시 보기" });
  await expect(showExamples).toHaveAttribute("aria-expanded", "false");
  await showExamples.click();
  await expect(appliedCond.getByText("이런 근무면 이 규칙에 어긋나요")).toBeVisible();

  // 짝: 두 사람은 같은 날 마감 금지
  const pair = await makeRules("김철수와 박민수는 같은 날 마감 금지");
  expect(pair!.constraints.length).toBeGreaterThan(0);
  const pairCard = pendingCards(page).first();
  for (const word of ["김철수", "박민수", "마감"]) await expect(pairCard).toContainText(word);
  await applyAllPending(page);

  // 값 수정: 최대 연속 근무 5 → 6(밑줄 값만 고친다)
  const maxRun = page.locator("article").filter({ hasText: "연속 근무" }).filter({ hasText: "5일 넘게" });
  await expect(maxRun).toContainText("연속 근무 5일까지");
  await maxRun.getByRole("button", { name: "수정" }).click();
  await maxRun.getByRole("textbox").fill("6");
  await maxRun.getByRole("button", { name: "저장" }).click();
  await expect(maxRun).toContainText("연속 근무 6일까지");
  await expectNoDevTerms(page, "매장 조건(적용 뒤)");

  // 다시 만들기: 새 규칙과 바꾼 값이 요청에 들어가고 근무표가 지킨다
  await page.getByRole("button", { name: "근무표", exact: true }).click();
  await sectionWith(NOV_NAME).getByRole("button", { name: "근무표 확인하기" }).click();
  await expect(scheduleTitle(page)).toBeVisible();
  expect(await solve(() => page.getByRole("button", { name: "다시 만들기" }).first().click())).toBe("ok");
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  const sent = lastSolve!.constraints ?? [];
  const sentMax = sent.find((c) => c.id === "rule-max-run");
  expect(sentMax?.type === "rule" && sentMax.values?.max_len?.value, "최대 연속 근무 값").toBe(6);
  for (const c of [...conditional!.constraints, ...pair!.constraints]) expect(sent.some((x) => x.id === c.id), `요청에 ${c.source_text}`).toBe(true);
  await expectHardRulesHold(page, NOV, lastSolve);

  // 따로 확인: 짝은 같은 날 둘 다 마감이 없고, 신입이 마감인 날은 리더도 마감에 있다
  const grid = await readGrid(page, NOV);
  const { shop } = await readState(page);
  const novice = namesWithTag(shop, "신입");
  const leader = namesWithTag(shop, "리더");
  for (let d = 0; d < NOV.length; d++) {
    expect(grid["김철수"][d] === "C" && grid["박민수"][d] === "C", `${d + 1}번째 날 짝 마감`).toBe(false);
    if (novice.some((n) => grid[n][d] === "C")) expect(leader.some((n) => grid[n][d] === "C"), `${d + 1}번째 날 신입 마감이면 리더 마감`).toBe(true);
  }
  await expectNoDevTerms(page, "③ 근무표(조건부·짝)");
});

test("S18. 말로 필요 인원 → 근무표 → 사람이 모자란 필요 인원 → 근무표 없음과 값 변경 제안", async () => {
  // 서버 문서가 없으면 이 브라우저의 캐시를 올리므로(첫 저장 실패 복구) 캐시도 함께 비운다
  await expectSaved(page);
  await page.evaluate(() => localStorage.removeItem("shop-scheduler"));
  await clearAccount();
  await page.reload();
  await expect(page.getByRole("heading", { name: "매장 준비", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "매장 이름" }).fill("골목 식당");
  await addRoster(page, ROSTER.slice(0, 6));
  await page.getByRole("button", { name: "첫 근무표 시작하기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11/2~11/8 근무표");
  await submitFullDay(WEEK, 6);

  await page.getByRole("button", { name: "다음", exact: true }).click();
  const text = "평일 오픈 2명, 주말은 3명";
  await page.getByRole("button", { name: text }).click();
  await expect(page.getByRole("textbox", { name: RULE_INPUT })).toHaveValue(text);
  const body = await interpret(page, RULE_INPUT, "규칙 만들기", text);
  expect(body.status, `"${text}" 해석 상태`).toBe("ok");
  const coverageCards = pendingCards(page).filter({ has: page.getByRole("heading", { name: "필요 인원" }) });
  expect(await coverageCards.count(), "필요 인원 카드").toBeGreaterThan(0);
  await expect(coverageCards.first().getByText("기본", { exact: true })).toBeVisible();
  await expect(coverageCards.first()).toContainText("오픈");
  const openRow = page.getByRole("row").filter({ hasText: "오픈" }).first();
  await expect(openRow.locator("td").nth(2)).not.toContainText(/\d/);

  // 요약표에 들어간 카드는 목록에서 빠지므로 순서 비교 없이 적용한다
  if ((await pendingCards(page).count()) >= 2) await page.getByRole("button", { name: "모두 적용" }).click();
  else await pendingCards(page).first().getByRole("button", { name: "적용" }).click();
  await expect(pendingCards(page)).toHaveCount(0);
  await expect(openRow.locator("td").nth(2)).toContainText("2");
  await expect(openRow.locator("td").nth(3)).toContainText("3");
  const { shop } = await readState(page);
  expect((shop.rules as ConstraintSpec[]).filter((r) => r.type === "rule" && r.default).length, "필요 인원 기본 규칙").toBeGreaterThan(0);
  await expect(page.getByText("필요 인원 없이 만들면 인원을 맞추지 않아요")).toHaveCount(0);

  await page.getByRole("button", { name: "다음", exact: true }).click();
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("ok");
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expectHardRulesHold(page, WEEK, lastSolve);
  const grid = await readGrid(page, WEEK);
  for (let d = 1; d <= WEEK.length; d++) {
    const n = Object.values(grid).filter((row) => row[d - 1] === "A").length;
    expect(n, `${d}번째 날 오픈`).toBeGreaterThanOrEqual(WEEKEND_DAYS.includes(d) ? 3 : 2);
  }

  // 매장 설정에서 평일 오픈을 정확히 9명으로(명단은 6명). 폼은 합계로 막지 않는다
  await page.getByRole("button", { name: "매장 설정", exact: true }).click();
  await page.getByRole("textbox", { name: "평일 오픈 최소 인원" }).fill("9");
  await page.getByRole("textbox", { name: "평일 오픈 최대 인원" }).fill("9");
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  await expect(page.getByText(/쉴 사람이 없어요|인원은 숫자로|최소가 최대보다/)).toHaveCount(0);
  await expectNoDevTerms(page, "매장 설정(필요 인원 9명)");

  // 다시 만들기 → 근무표 없음: 설명 + 재풀이로 검증된 제안
  await page.getByRole("button", { name: "근무표", exact: true }).click();
  await sectionWith("11/2~11/8 근무표").getByRole("button", { name: "근무표 확인하기" }).click();
  expect(await solve(() => page.getByRole("button", { name: "다시 만들기" }).first().click())).toBe("infeasible");
  const panel = page.locator("section").filter({ hasText: "이 조건으로는 근무표를 만들 수 없어요" });
  await expect(panel.getByText("근무표 없음", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "함께 지킬 수 없는 규칙" })).toBeVisible();
  const explanation = panel.locator("p.whitespace-pre-line");
  await expect(explanation).not.toBeEmpty();
  test.info().annotations.push({ type: "충돌 설명", description: await explanation.innerText() });
  const proposals = panel.locator("article").filter({ hasText: "검증됨" });
  expect(await proposals.count(), "검증된 제안").toBeGreaterThan(0);
  test.info().annotations.push({ type: "제안", description: (await proposals.allInnerTexts()).join(" | ") });
  const valueChange = proposals.filter({ hasText: /9 → \d+/ });
  if ((await valueChange.count()) === 0) test.info().annotations.push({ type: "확인 필요", description: "값 바꾸기 제안 없음(끄기·가능하면만)" });
  const chosen = (await valueChange.count()) > 0 ? valueChange.first() : proposals.first();
  expect(await solve(() => chosen.getByRole("button", { name: "수락" }).click())).toBe("ok");
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expectHardRulesHold(page, WEEK, lastSolve);
});
