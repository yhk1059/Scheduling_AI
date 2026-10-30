// docs/BROWSER_TEST_SCENARIOS.md S16~S18. 식 규칙(ADR-019)으로 바뀐 것: v5 저장본 열기, 조건부·짝 규칙과 예시 판정, 값 수정,
// 말로 적는 병동 소개, 사람이 모자란 필요 인원. 페이지 하나를 공유하며 순서대로 돈다. 게스트 모드만 다룬다(ADR-014).
// LLM은 mock하지 않는다(ADR-013). LLM 해석은 흔들릴 수 있어 카드 문장은 핵심 낱말만 본다.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import wardOct from "./fixtures/ward-oct.json";

import type { PeriodRange } from "../lib/period";
import type { Ward } from "../lib/store";
import type { ConstraintSpec, ScheduleRequest } from "../lib/types.gen";
import {
  applyAllPending,
  expectHardRulesHold,
  expectNoDevTerms,
  interpret,
  pendingCards,
  periodByStart,
  readGrid,
  readState,
  scheduleTitle,
  solveVia,
  T0,
} from "./test-helpers";

const NOV: PeriodRange = { start_date: "2026-11-01", length: 30 };
const NOV_WEEKEND_DAYS = [1, 7, 8, 14, 15, 21, 22, 28, 29];
const RULE_INPUT = "병동 규칙 입력";
// 사람이 모자란 병동(S18): D1의 앞 6명
const SMALL_ROSTER: [string, number][] = [
  ["이영희", 12],
  ["박민수", 9],
  ["김철수", 7],
  ["정유진", 5],
  ["최지훈", 3],
  ["강서연", 15],
];

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

const namesWithTag = (ward: Ward, tag: string) => ward.nurses.filter((n) => n.tags.includes(tag)).map((n) => n.name);

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

test("S16. 저장된 병동 열기 → 다시 만들기", async () => {
  await page.goto("/app");
  await page.evaluate((doc) => localStorage.setItem("nurse-scheduler", JSON.stringify(doc)), wardOct);
  await page.reload();
  await expect(page.getByRole("heading", { name: "외과 병동", level: 1 })).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("nurse-scheduler")!));
  const ward = stored.state.ward as Ward;
  const savedRules = wardOct.state.ward.rules;
  expect(ward.rules.map((r) => r.id), "규칙 수와 id가 같다").toEqual(savedRules.map((r) => r.id));
  const savedNov = wardOct.state.periods.find((p) => p.start_date === NOV.start_date)!;
  const nov = await periodByStart(page, NOV.start_date);
  expect(nov.requests.map((r) => r.id), "요청도 같은 id").toEqual(savedNov.requests.map((r) => r.id));
  await expect(page.getByRole("main")).toContainText("간호사 15명 · 병동 규칙 7개 · 한 달 단위");
  await expectNoDevTerms(page, "병동 홈");

  // 저장된 규칙으로 11월 근무표를 만들 수 있다
  await sectionWith("11월 근무표").getByRole("button", { name: "이어서 하기" }).click();
  await page.getByRole("button", { name: "다음" }).click();
  await expect(scheduleTitle(page)).toBeVisible();
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("ok");
  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  expect(lastSolve!.constraints!.filter((c) => c.type === "rule").length).toBeGreaterThanOrEqual(savedRules.length);
  await expectHardRulesHold(page, NOV, lastSolve);
});

test("S17. 조건부·짝 규칙 → 예시 판정 → 적용 → 값 수정 → 다시 만들기", async () => {
  await page.getByRole("button", { name: "병동 설정", exact: true }).click();
  await page.getByRole("tab", { name: "병동 규칙" }).click();
  // 기본 규칙 카드(필요 인원·나이트 전담)는 맨 위에 `기본` 배지로 있다
  await expect(page.locator("article").first().getByText("기본", { exact: true })).toBeVisible();

  // 조건부: 신규가 나이트면 책임도 나이트에
  const conditional = await makeRules("신규가 나이트면 책임도 나이트에 1명");
  const condRules = (conditional?.constraints ?? []).filter((c) => c.type === "rule" && c.body.kind === "require" && c.body.when);
  expect(condRules.length, "조건(만약 ~면)이 있는 규칙").toBeGreaterThan(0);
  const condCard = pendingCards(page).first();
  for (const word of ["신규", "책임", "나이트", "1명"]) await expect(condCard).toContainText(word);
  // 예시 판정: 서버가 샘플 근무표에서 찾은 위반 사례(≤3)를 띠로 보여 주고, 어긋난 칸을 표시한다
  const examples = conditional!.examples?.[condRules[0].id] ?? [];
  expect(examples.length, "예시 판정").toBeGreaterThan(0);
  expect(examples.length).toBeLessThanOrEqual(3);
  await expect(condCard.getByText("이런 근무면 이 규칙에 어긋나요")).toBeVisible();
  await expect(condCard.locator("table")).toHaveCount(examples.length);
  await expect(condCard.locator('[aria-label$=" 어긋남"]').first()).toBeVisible();
  await expectNoDevTerms(page, "병동 규칙(조건부 대기 카드)");
  await applyAllPending(page);
  // 적용된 카드의 예시는 [예시 보기]로 접힌다
  const appliedCond = page.locator("article").filter({ hasText: conditional!.constraints[0].source_text }).first();
  const showExamples = appliedCond.getByRole("button", { name: "예시 보기" });
  await expect(showExamples).toHaveAttribute("aria-expanded", "false");
  await showExamples.click();
  await expect(appliedCond.getByText("이런 근무면 이 규칙에 어긋나요")).toBeVisible();

  // 짝: 두 사람은 같은 날 나이트 금지
  const pair = await makeRules("김철수와 박민수는 같은 날 나이트 금지");
  expect(pair!.constraints.length).toBeGreaterThan(0);
  const pairCard = pendingCards(page).first();
  for (const word of ["김철수", "박민수", "나이트"]) await expect(pairCard).toContainText(word);
  await applyAllPending(page);

  // 값 수정: 최대 연속 나이트 3 → 4(밑줄 값만 고친다)
  const maxNights = page.locator("article").filter({ has: page.getByRole("heading", { name: "최대 연속 나이트" }) });
  await expect(maxNights).toContainText("나이트 연속 3일까지");
  await maxNights.getByRole("button", { name: "수정" }).click();
  await maxNights.getByRole("textbox").fill("4");
  await maxNights.getByRole("button", { name: "저장" }).click();
  await expect(maxNights).toContainText("나이트 연속 4일까지");
  await expectNoDevTerms(page, "병동 규칙(적용 뒤)");

  // 다시 만들기: 새 규칙과 바꾼 값이 요청에 들어가고 근무표가 지킨다
  await page.getByRole("button", { name: "근무표", exact: true }).click();
  await sectionWith("11월 근무표").getByRole("button", { name: "근무표 확인하기" }).click();
  await expect(scheduleTitle(page)).toBeVisible();
  expect(await solve(() => page.getByRole("button", { name: "다시 만들기" }).first().click())).toBe("ok");
  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  const sent = lastSolve!.constraints ?? [];
  const sentMax = sent.find((c) => c.id === "rule-max-nights");
  expect(sentMax?.type === "rule" && sentMax.values?.max_len?.value, "최대 연속 나이트 값").toBe(4);
  for (const c of [...conditional!.constraints, ...pair!.constraints])
    expect(sent.some((x) => x.id === c.id), `요청에 ${c.source_text}`).toBe(true);
  await expectHardRulesHold(page, NOV, lastSolve);

  // 따로 확인: 짝은 같은 날 둘 다 나이트가 없고, 신규가 나이트인 날은 책임도 나이트에 있다
  const grid = await readGrid(page, NOV);
  const { ward } = await readState(page);
  const novice = namesWithTag(ward, "신규");
  const charge = namesWithTag(ward, "책임");
  for (let d = 0; d < NOV.length; d++) {
    expect(grid["김철수"][d] === "N" && grid["박민수"][d] === "N", `${d + 1}일 짝 나이트`).toBe(false);
    if (novice.some((n) => grid[n][d] === "N"))
      expect(charge.some((n) => grid[n][d] === "N"), `${d + 1}일 신규 나이트면 책임 나이트`).toBe(true);
  }
  await expectNoDevTerms(page, "② 근무표(조건부·짝)");
});

test("S18. 말로 병동 소개 → 근무표 → 사람이 모자란 필요 인원 → 해 없음과 값 변경 제안", async () => {
  await page.goto("/app");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "내 병동으로 시작하기" }).click();
  await page.getByRole("textbox", { name: "병동 이름" }).fill("소아 병동");
  const newName = page.getByRole("textbox", { name: "새 간호사 이름" });
  for (const [name, years] of SMALL_ROSTER) {
    await newName.fill(name);
    await page.getByRole("textbox", { name: "새 간호사 연차" }).fill(String(years));
    await page.getByRole("textbox", { name: "새 간호사 연차" }).press("Enter");
    await expect(newName).toHaveValue("");
  }
  await page.getByRole("button", { name: "다음", exact: true }).click();

  // ② 병동 소개를 말로: 더블 근무 형태 카드 + 필요 인원 카드(기본)
  const text = "데이 평일 3명 이상, 주말 2명, 더블도 있어";
  await page.getByRole("button", { name: text }).click();
  await expect(page.getByRole("textbox", { name: "병동 소개 입력" })).toHaveValue(text);
  const body = await interpret(page, "병동 소개 입력", "규칙 만들기", text);
  expect(body.status, `"${text}" 해석 상태`).toBe("ok");
  if (body.status !== "ok") return;
  const doubles = (body.config_changes ?? []).filter((c) => c.action === "add" && [...(c.shift.parts ?? [])].sort().join() === "D,E");
  expect(doubles, "D와 E를 세는 더블 코드 추가").toHaveLength(1);
  test.info().annotations.push({ type: "더블 코드", description: doubles[0].shift.code });
  await expect(pendingCards(page).filter({ has: page.getByRole("heading", { name: "근무 형태" }) })).toHaveCount(1);
  const coverageCards = pendingCards(page).filter({ has: page.getByRole("heading", { name: "필요 인원" }) });
  expect(await coverageCards.count(), "필요 인원 카드").toBeGreaterThan(0);
  await expect(coverageCards.first().getByText("기본", { exact: true })).toBeVisible();
  await expect(coverageCards.first()).toContainText("데이");
  // 적용한 설정 카드는 카드가 아니라 근무 형태가 되어 목록에서 빠진다(순서 비교 없이 [모두 적용])
  await page.getByRole("button", { name: "모두 적용" }).click();
  await expect(pendingCards(page)).toHaveCount(0);
  const { ward } = await readState(page);
  expect(ward.config.shifts.some((s) => [...(s.parts ?? [])].sort().join() === "D,E"), "더블이 근무 형태에").toBe(true);
  const staffing = (ward.rules as ConstraintSpec[]).filter((r) => r.type === "rule" && r.default && r.id !== "night-only");
  expect(staffing.length, "필요 인원 기본 규칙").toBeGreaterThan(0);
  await expect(page.getByText("필요 인원 없이 만들면 인원을 맞추지 않아요")).toHaveCount(0);

  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "첫 근무표 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11월 근무표");
  await page.getByRole("button", { name: "다음" }).click();
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("ok");
  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expectHardRulesHold(page, NOV, lastSolve);
  // 평일 데이 3명 이상(더블은 데이로도 센다)
  const grid = await readGrid(page, NOV);
  const dCodes = new Set(lastSolve!.config!.shifts.filter((s) => s.code === "D" || (s.parts ?? []).includes("D")).map((s) => s.code));
  for (let d = 1; d <= NOV.length; d++) {
    if (NOV_WEEKEND_DAYS.includes(d)) continue;
    const n = Object.values(grid).filter((row) => dCodes.has(row[d - 1])).length;
    expect(n, `${d}일 평일 데이`).toBeGreaterThanOrEqual(3);
  }

  // 병동 설정에서 평일 데이를 정확히 9명으로(명단은 6명). 폼은 합계로 막지 않는다
  await page.getByRole("button", { name: "병동 설정", exact: true }).click();
  await page.getByRole("textbox", { name: "평일 데이 최소 인원" }).fill("9");
  await page.getByRole("textbox", { name: "평일 데이 최대 인원" }).fill("9");
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  await expect(page.getByText(/쉴 사람이 없어요|인원은 숫자로|최소가 최대보다/)).toHaveCount(0);
  await expectNoDevTerms(page, "병동 설정(필요 인원 9명)");

  // 다시 만들기 → 근무표 없음: 설명 + 재풀이로 검증된 제안(값 바꾸기·끄기·반드시 → 가능하면)
  await page.getByRole("button", { name: "근무표", exact: true }).click();
  await sectionWith("11월 근무표").getByRole("button", { name: "근무표 확인하기" }).click();
  expect(await solve(() => page.getByRole("button", { name: "다시 만들기" }).first().click())).toBe("infeasible");
  const panel = page.locator("section").filter({ hasText: "규칙을 모두 지키는 근무표가 없어요" });
  await expect(panel.getByText("근무표 없음", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "함께 지킬 수 없는 규칙" })).toBeVisible();
  const explanation = panel.locator("p.whitespace-pre-line");
  await expect(explanation).not.toBeEmpty();
  test.info().annotations.push({ type: "충돌 설명", description: await explanation.innerText() });
  const proposals = panel.locator("article").filter({ hasText: "검증됨" });
  expect(await proposals.count(), "검증된 제안").toBeGreaterThan(0);
  const texts = await proposals.allInnerTexts();
  test.info().annotations.push({ type: "제안", description: texts.join(" | ") });
  const valueChange = proposals.filter({ hasText: /\d+ → \d+/ });
  if ((await valueChange.count()) === 0)
    test.info().annotations.push({ type: "확인 필요", description: "값 바꾸기 제안 없음(끄기·가능하면만)" });
  const chosen = (await valueChange.count()) > 0 ? valueChange.first() : proposals.first();
  expect(await solve(() => chosen.getByRole("button", { name: "수락" }).click())).toBe("ok");
  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expectHardRulesHold(page, NOV, lastSolve);
});
