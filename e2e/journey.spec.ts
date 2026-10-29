// docs/BROWSER_TEST_SCENARIOS.md S5~S13(데모 저니 1~7). 처음 설정부터 내 병동 첫 근무표를 앞 시나리오의 상태를 이어받아 만드는 하나의 흐름이라
// 페이지 하나를 공유하며 순서대로 돈다. 게스트 모드만 다룬다(ADR-014). LLM은 mock하지 않는다(ADR-013).
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import type { PeriodRange } from "../lib/period";
import type { ConstraintSpec, ScheduleRequest } from "../lib/types.gen";
import {
  appliedCards,
  applyAllPending,
  type Code,
  deleteAllPending,
  expectCardChrome,
  expectHardRulesHold,
  expectNoDevTerms,
  type Grid,
  interpret,
  interpretOk,
  NURSE_COUNT,
  nurseId,
  pendingCards,
  periodByStart,
  primaryButtons,
  readGrid,
  readState,
  scheduleTitle,
  solveVia,
  T0,
} from "./test-helpers";

const NOV: PeriodRange = { start_date: "2026-11-01", length: 30 };
const NOV_RANGE = "2026.11.1 – 11.30";
// [이름, 연차, 나이트 전담] 15명 · 나이트 전담 2명 (BROWSER_TEST_SCENARIOS D1)
const ROSTER: [string, number, boolean][] = [
  ["이영희", 12, false],
  ["박민수", 9, false],
  ["김철수", 7, false],
  ["정유진", 5, false],
  ["최지훈", 3, false],
  ["강서연", 15, false],
  ["윤지민", 10, false],
  ["임하늘", 8, false],
  ["한소율", 6, false],
  ["오민준", 4, false],
  ["서예린", 2, false],
  ["신도윤", 1, false],
  ["조은비", 2, false],
  ["문가람", 11, true],
  ["배수아", 4, true],
];
const COVERAGE: [string, string, number, number][] = [
  ["평일", "데이", 3, 4],
  ["평일", "이브닝", 3, 3],
  ["평일", "나이트", 2, 2],
  ["주말·공휴일", "데이", 3, 3],
  ["주말·공휴일", "이브닝", 2, 2],
  ["주말·공휴일", "나이트", 2, 2],
];
const HOLIDAY = 18;
const NOV_WEEKEND_DAYS = [1, 7, 8, 14, 15, 18, 21, 22, 28, 29];
const RULE_INPUT = "병동 규칙 입력";
const REQUEST_INPUT = "요청 입력";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let problems: string[] = [];
let lastSolve: ScheduleRequest | undefined;
let ruleCount: number;
let fixedCell: { day: number; code: Code };
let finalGrid: Grid;

const setupStepper = () => page.getByRole("list", { name: "처음 설정 단계" });
const workStepper = () => page.getByRole("list", { name: "근무표 작성 단계" });

const sectionWith = (heading: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

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
  // 오류 알림([다시 시도]가 있는 alert). Next 개발 서버의 route announcer도 role=alert라 구분한다
  await expect(page.getByRole("alert").filter({ hasText: "다시 시도" })).toHaveCount(0);
  expect(problems, "콘솔 오류·API 실패").toEqual([]);
});

test("S5. 처음 설정 ① 병동·명단 → ② 필요 인원", async () => {
  await page.goto("/app");
  await page.getByRole("button", { name: "내 병동으로 시작하기" }).click();
  await expect(page.getByRole("heading", { name: "처음 설정", level: 1 })).toBeVisible();
  await expect(setupStepper().locator('[aria-current="step"]')).toContainText("병동·명단");
  await expect(page.getByRole("button", { name: "병동 설정", exact: true })).toHaveCount(0);

  await page.getByRole("textbox", { name: "병동 이름" }).fill("내과 병동");
  await expect(page.getByRole("banner")).toContainText("내과 병동 · 한 달 단위");
  const unit = page.getByRole("combobox", { name: "근무표 주기" });
  await unit.selectOption({ label: "2주" });
  await expect(page.getByRole("banner")).toContainText("내과 병동 · 2주 단위");
  // 근무표가 아직 없으니 "다음에 만드는 근무표부터" 안내는 없다
  await expect(page.getByText("다음에 만드는 근무표부터 적용돼요.")).toHaveCount(0);
  await unit.selectOption({ label: "한 달(1일~말일)" });
  await expect(page.getByRole("banner")).toContainText("내과 병동 · 한 달 단위");

  const next = page.getByRole("button", { name: "다음", exact: true });
  await expect(next).toBeDisabled();
  await expect(page.getByText("명단에 간호사를 1명 이상 넣으면 다음으로 넘어갈 수 있어요")).toBeVisible();
  await expect(page.getByText("바꾼 내용은 바로 저장돼요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "이전" })).toHaveCount(0);

  // 맨 아래 입력 줄에 한 명씩 적고 Enter
  const newName = page.getByRole("textbox", { name: "새 간호사 이름" });
  const newYears = page.getByRole("textbox", { name: "새 간호사 연차" });
  const newNight = page.getByRole("checkbox", { name: "새 간호사 나이트 전담" });
  for (const [name, years, night] of ROSTER) {
    await newName.fill(name);
    await newYears.fill(String(years));
    if (night) await newNight.check();
    await newYears.press("Enter");
    await expect(newName).toHaveValue("");
    await expect(newName).toBeFocused();
  }
  await expect(page.getByRole("textbox", { name: "15행 이름", exact: true })).toHaveValue("배수아");

  // 잘못된 줄은 더하지 않고 그 칸에 오류를 보인다
  await newName.fill("이영희");
  await newYears.fill("abc");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(newName).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("같은 이름이 이미 있어요")).toBeVisible();
  await expect(newYears).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("연차는 숫자여야 해요")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "16행 이름", exact: true })).toHaveCount(0);
  await newName.fill("");
  await newYears.fill("");

  await expect(page.getByRole("textbox", { name: "1행 이름", exact: true })).toHaveValue("이영희");
  await expect(page.getByRole("textbox", { name: "15행 이름", exact: true })).toHaveValue("배수아");
  await expect(page.getByRole("checkbox", { name: "14행 나이트 전담" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "15행 나이트 전담" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "13행 나이트 전담" })).not.toBeChecked();

  // 근무표에서 빼기 → 제외 → 다시 넣기
  const idsBefore = (await readState(page)).ward.nurses.map((n) => n.id);
  const baeRow = page.getByRole("row").filter({ has: page.getByRole("textbox", { name: "15행 이름", exact: true }) });
  await baeRow.getByRole("button", { name: "근무표에서 빼기" }).click();
  await expect(page.getByRole("textbox", { name: "15행 이름", exact: true })).toHaveCount(0);
  await expect(page.getByText("근무표에서 빼도 지난 근무표와 통계에는 남아요.")).toBeVisible();
  await page.getByRole("button", { name: "제외된 간호사 1명 보기" }).click();
  const excludedRow = page.getByRole("row").filter({ hasText: "배수아" });
  await expect(excludedRow.getByText("제외", { exact: true })).toBeVisible();
  await excludedRow.getByRole("button", { name: "다시 넣기" }).click();
  await expect(page.getByRole("textbox", { name: "15행 이름", exact: true })).toHaveValue("배수아");

  await expect(next).toBeEnabled();
  await expectNoDevTerms(page, "처음 설정 ①");
  await next.click();

  // ② 필요 인원
  await expect(setupStepper().locator('[aria-current="step"]')).toContainText("필요 인원");
  await expect(page.getByRole("heading", { name: "필요 인원", exact: true })).toBeFocused();
  await expect(next).toBeDisabled();
  await expect(page.getByText("필요 인원을 모두 입력하면 다음으로 넘어갈 수 있어요")).toBeVisible();
  for (const [kind, shift, min, max] of COVERAGE) {
    await page.getByRole("textbox", { name: `${kind} ${shift} 최소` }).fill(String(min));
    await page.getByRole("textbox", { name: `${kind} ${shift} 최대` }).fill(String(max));
  }
  const weekdayDayMin = page.getByRole("textbox", { name: "평일 데이 최소" });
  await weekdayDayMin.fill("5");
  await expect(page.getByText("최소 인원이 최대 인원보다 많아요.")).toBeVisible();
  await weekdayDayMin.fill("3");
  await expect(page.getByText("최소 인원이 최대 인원보다 많아요.")).toHaveCount(0);

  const { ward } = await readState(page);
  expect(ward.name).toBe("내과 병동");
  expect(ward.unit).toBe("month");
  expect(ward.nurses.map((n) => n.id), "간호사 id 유지").toEqual(idsBefore);
  expect(ward.nurses.filter((n) => n.active)).toHaveLength(NURSE_COUNT);
  expect(ward.nurses.filter((n) => n.night_only).map((n) => n.name)).toEqual(["문가람", "배수아"]);
  expect(ward.rules.filter((c) => c.type === "daily_coverage")).toHaveLength(6);
  await expect(next).toBeEnabled();
  await expectNoDevTerms(page, "처음 설정 ②");
  // [이전]으로 ①에 돌아가도 입력은 그대로다
  await page.getByRole("button", { name: "이전" }).click();
  await expect(page.getByRole("textbox", { name: "1행 이름", exact: true })).toHaveValue("이영희");
  await next.click();
  await next.click();
});

test("S6. 처음 설정 ③ 병동 규칙 → 첫 근무표 만들기", async () => {
  await expect(setupStepper().locator('[aria-current="step"]')).toContainText("병동 규칙");
  const createFirst = page.getByRole("button", { name: "첫 근무표 만들기" });
  await expect(createFirst).toBeEnabled();
  await expect(page.getByText("규칙 없이 만들면 필요 인원만 지켜요")).toBeVisible();
  const examples = page.getByRole("button", { name: "나이트는 3일 넘게 연속으로 하지 않게" });
  await examples.click();
  await expect(page.getByRole("textbox", { name: RULE_INPUT })).toHaveValue("나이트는 3일 넘게 연속으로 하지 않게");

  // S6-a. 규칙 3개(데모 저니 2)
  const r1 = await interpretOk(page, RULE_INPUT, "규칙 만들기", "나이트 다음 날은 무조건 쉬게");
  expect(r1.length).toBeGreaterThan(0);
  for (const c of r1) {
    expect(["off_after_night_block", "forbidden_sequence"]).toContain(c.type);
    if (c.type === "forbidden_sequence") {
      expect(c.params.first).toBe("N");
      expect(["D", "E"]).toContain(c.params.second);
    }
  }
  const r2 = await interpretOk(page, RULE_INPUT, "규칙 만들기", "나이트는 3일 넘게 연속으로 하지 않게");
  expect(r2.map((c) => c.type)).toEqual(["max_consecutive_nights"]);
  expect(r2[0].params).toEqual({ days: 3 });
  const r3 = await interpretOk(page, RULE_INPUT, "규칙 만들기", "근무조마다 3년차 이상 한 명은 꼭 있어야 해");
  expect(r3.length).toBeGreaterThan(0);
  for (const c of r3) {
    expect(c.type).toBe("skill_mix");
    if (c.type === "skill_mix") expect({ min_years: c.params.min_years, min_count: c.params.min_count }).toEqual({ min_years: 3, min_count: 1 });
  }
  const shifts = r3.flatMap((c) => (c.type === "skill_mix" ? [c.params.shift] : []));
  expect([...shifts].sort(), "연차별 배치가 D/E/N을 모두 덮는다").toEqual(["D", "E", "N"]);

  const total = r1.length + r2.length + r3.length;
  await expect(pendingCards(page)).toHaveCount(total);
  for (const card of await pendingCards(page).all()) await expectCardChrome(card, "반드시");
  await expect(pendingCards(page).filter({ hasText: "최대 연속 나이트" })).toContainText("나이트 연속 3일까지");
  await expect(pendingCards(page).filter({ hasText: "연차별 배치" }).first()).toContainText("3년차 이상 1명 이상");
  await expect(page.getByText(`적용하지 않은 규칙 ${total}개는 빠져요`)).toBeVisible();
  await expect(createFirst).toBeEnabled();
  await expectNoDevTerms(page, "처음 설정 ③(적용 대기)");

  const r2Card = page.locator("article").filter({ hasText: "최대 연속 나이트" });
  const toggle = r2Card.getByRole("group", { name: "반드시/가능하면" });
  await toggle.getByRole("button", { name: "가능하면" }).click();
  await expect(toggle.getByRole("button", { name: "가능하면" })).toHaveAttribute("aria-pressed", "true");
  await toggle.getByRole("button", { name: "반드시" }).click();
  await expect(toggle.getByRole("button", { name: "반드시" })).toHaveAttribute("aria-pressed", "true");

  await applyAllPending(page);
  await expect(appliedCards(page)).toHaveCount(total);
  await expect(page.getByText(/적용하지 않은 규칙/)).toHaveCount(0);
  await expect(page.getByText("규칙 없이 만들면 필요 인원만 지켜요")).toHaveCount(0);

  // S6-b. 적용된 카드 수정
  for (const days of ["4", "3"]) {
    await r2Card.getByRole("button", { name: "수정" }).click();
    await r2Card.getByLabel("일수").fill(days);
    await r2Card.getByRole("button", { name: "저장" }).click();
    await expect(r2Card).toContainText(`나이트 연속 ${days}일까지`);
  }

  // S6-c. 되묻기와 미지원. LLM 판단이 달라도 실패로 보지 않고 기록한 뒤 생긴 카드를 지운다.
  const cases = [
    { text: "주말은 적당히", expected: "clarify" },
    { text: "사이 안 좋은 간호사끼리는 같은 날 근무 안 넣게", expected: "unsupported" },
  ] as const;
  for (const { text, expected } of cases) {
    const body = await interpret(page, RULE_INPUT, "규칙 만들기", text);
    if (body.status === "clarify") {
      await expect(page.getByText("내용을 보완해서 다시 입력해 주세요.")).toBeVisible();
    } else if (body.status === "unsupported") {
      await expect(page.getByText(/^아직 지원하지 않는 규칙이에요:/)).toBeVisible();
    }
    if (body.status !== expected) {
      test.info().annotations.push({ type: "확인 필요", description: `"${text}" 기대 ${expected}, 실제 ${body.status}` });
    }
    await deleteAllPending(page);
  }
  await expect(page.locator("article")).toHaveCount(total);
  ruleCount = total;

  // S6-d. [첫 근무표 만들기] → 근무표 작성 ① 요청. 처음 설정은 다시 보이지 않는다
  await createFirst.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11월 근무표");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11월 근무표");
  await expect(page.getByRole("button", { name: "병동 설정", exact: true })).toBeVisible();
});

test("S7. 첫 근무표 ① 요청: 준비 요약", async () => {
  const titleRow = page.getByRole("heading", { level: 1 }).locator("..");
  await expect(titleRow).toContainText(NOV_RANGE);
  await expect(titleRow.getByText("작성 중", { exact: true })).toBeVisible();
  const stepper = workStepper();
  await expect(stepper.locator('[aria-current="step"]')).toContainText("요청");
  await expect(stepper.getByRole("button", { name: /근무표/ })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "요청", exact: true })).toBeVisible();

  // 첫 근무표: 요약 한 줄은 접혀 있고 [바꾸기]로 펼친다
  await expect(page.getByRole("main")).toContainText(`${NOV_RANGE} · 공휴일 없음 · 간호사 ${NURSE_COUNT}명 · 지난 근무 없음`);
  const prepare = page.getByRole("button", { name: "바꾸기" });
  await expect(prepare).toHaveAttribute("aria-expanded", "false");
  await prepare.click();
  await expect(page.getByRole("button", { name: "접기" }).first()).toHaveAttribute("aria-expanded", "true");
  await expect(sectionWith("날짜")).toContainText(`${NOV_RANGE} · 30일`);
  await expect(page.getByText("2026년 11월")).toBeVisible();
  await expect(page.getByRole("button", { name: /^\d+월 \d+일 공휴일 (지정|해제)$/ })).toHaveCount(30);
  await page.getByRole("button", { name: `11월 ${HOLIDAY}일 공휴일 지정` }).click();
  await expect(page.getByRole("button", { name: `11월 ${HOLIDAY}일 공휴일 해제` })).toHaveAttribute("aria-pressed", "true");

  await expect(sectionWith("명단 확인")).toContainText(`간호사 ${NURSE_COUNT}명`);
  await expect(page.getByText("지난 근무표와 명단이 같아요")).toHaveCount(0);
  const carryToggle = page.getByRole("button", { name: "지난 근무 입력하기 (선택)" });
  await expect(carryToggle).toHaveAttribute("aria-expanded", "false");
  await carryToggle.click();
  await expect(page.getByRole("heading", { name: "지난 근무 마지막 며칠 (선택)" })).toBeVisible();
  await expect(page.getByText(/지금 반영된 간호사:\s*0명/)).toBeVisible();
  await expectNoDevTerms(page, "① 요청(준비 펼침, 첫 근무표)");
  await expect(page.getByRole("main")).toContainText(`${NOV_RANGE} · 공휴일 1일 · 간호사 ${NURSE_COUNT}명`);

  const p = await periodByStart(page, NOV.start_date);
  expect({ start_date: p.start_date, length: p.length }).toEqual(NOV);
  expect(p.holidays).toEqual([HOLIDAY]);
  await page.getByRole("button", { name: "접기" }).first().click();
  await expect(page.getByRole("heading", { name: "명단 확인" })).toHaveCount(0);
});

test("S8. ① 요청: 요청 카드", async () => {
  const lee = await nurseId(page, "이영희");
  const park = await nurseId(page, "박민수");

  const q1 = await interpretOk(page, REQUEST_INPUT, "요청 만들기", "이영희 11월 15~17일 휴가");
  expect(q1.map((c) => c.type)).toEqual(["leave"]);
  expect(q1[0].params).toEqual({ nurse_id: lee, days: [15, 16, 17] });
  const leaveCard = pendingCards(page).filter({ hasText: "이영희 · 11/15~11/17 · 휴무" });
  await expect(leaveCard.getByRole("heading", { name: "휴가" })).toBeVisible();
  await expectCardChrome(leaveCard, "반드시");
  const leaveToggle = leaveCard.getByRole("group", { name: "반드시/가능하면" });
  await expect(leaveToggle).toHaveAttribute("title", "휴가와 고정 근무는 항상 반드시 지켜요");
  await expect(leaveToggle.getByRole("button", { name: "반드시" })).toBeDisabled();
  await expect(leaveToggle.getByRole("button", { name: "가능하면" })).toBeDisabled();

  const q2 = await interpretOk(page, REQUEST_INPUT, "요청 만들기", "박민수는 주말에 쉬고 싶대요");
  expect(q2.map((c) => c.type)).toEqual(["shift_preference"]);
  const pref = q2[0];
  if (pref.type === "shift_preference") {
    expect({ nurse_id: pref.params.nurse_id, shift: pref.params.shift, prefer: pref.params.prefer }).toEqual({
      nurse_id: park,
      shift: "O",
      prefer: true,
    });
    const weekendOnly =
      pref.params.weekends_only === true || (pref.params.days ?? []).every((d) => NOV_WEEKEND_DAYS.includes(d));
    expect(weekendOnly, "주말·공휴일만 대상").toBe(true);
  }
  const prefCard = pendingCards(page).filter({ hasText: "희망·기피 근무" });
  await expect(prefCard).toContainText("박민수 ·");
  await expect(prefCard).toContainText("휴무 희망");
  await expectCardChrome(prefCard, "가능하면");
  await expectNoDevTerms(page, "② 요청(적용 대기)");

  await applyAllPending(page);

  const q3 = await interpret(page, REQUEST_INPUT, "요청 만들기", "홍길동 20일 휴가");
  if (q3.status === "ok" && q3.constraints.length > 0) {
    const orphan = pendingCards(page).filter({ hasText: "(명단에 없는 간호사)" });
    await expect(orphan.first().getByText("명단에 없는 간호사를 가리켜요.")).toBeVisible();
  } else {
    test.info().annotations.push({ type: "확인 필요", description: `"홍길동 20일 휴가" → ${q3.status}` });
  }
  await deleteAllPending(page);

  await expect(page.getByRole("heading", { name: "이 근무표에 적용되는 병동 규칙" })).toBeVisible();
  await page.getByRole("button", { name: "병동 규칙 보기" }).click();
  await expect(page.getByRole("button", { name: "이번 근무표에서만 끄기" }).first()).toBeVisible();
  await page.getByRole("button", { name: "접기" }).click();

  await page.getByRole("button", { name: "다음" }).click();
  await expect(scheduleTitle(page)).toBeVisible();
  await expect(workStepper().getByRole("button", { name: "요청", exact: true })).toBeEnabled();
});

test("S9. ② 근무표 만들기", async () => {
  await expect(page.getByText("적용한 규칙과 요청으로 근무표를 만들어요.")).toBeVisible();
  await expect(primaryButtons(page)).toHaveText("근무표 만들기");
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("ok");

  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expect(page.getByText("희망 반영", { exact: true })).toBeVisible();
  await expect(page.getByText("못 지킨 규칙", { exact: true })).toBeVisible();
  await expect(page.getByText("칸을 눌러 근무를 고정하면 나머지를 최소한으로 바꿔 다시 만들어요.")).toBeVisible();
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("확정");
  await expect(page.getByRole("button", { name: "다시 만들기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "CSV 받기" })).toBeVisible();

  const stats = sectionWith("개인별 통계");
  await expect(stats.locator("tbody tr")).toHaveCount(NURSE_COUNT);
  for (const h of ["D", "E", "N", "O", "주말·공휴일 근무", "최대 연속 근무", "희망 반영률", "평균보다 많은 근무일"]) {
    await expect(stats.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
  }
  // 첫 근무표: 최근 4주 기록이 없어 열과 근거 한 줄을 그리지 않는다
  expect(lastSolve!.history_load ?? []).toEqual([]);
  await expect(page.getByText(/최근 4주/)).toHaveCount(0);

  await expectHardRulesHold(page, NOV, lastSolve);
  expect((await readGrid(page, NOV))["이영희"].slice(14, 17)).toEqual(["O", "O", "O"]);
  await expectNoDevTerms(page, "② 근무표(첫 근무표)");
});

test("S10. 근무표 없음 → 설명과 검증된 제안", async () => {
  await page.getByRole("button", { name: "이전" }).click();
  await expect(page.getByRole("heading", { name: "요청", exact: true })).toBeVisible();
  for (const text of ["이영희, 박민수, 김철수, 정유진 20일 휴가", "최지훈, 강서연, 윤지민, 임하늘 20일 휴가"]) {
    const cards = await interpretOk(page, REQUEST_INPUT, "요청 만들기", text);
    expect(cards.every((c) => c.type === "leave"), `${text} → 휴가 카드`).toBe(true);
    await applyAllPending(page);
  }
  const requests = (await periodByStart(page, NOV.start_date)).requests;
  const offOn20 = new Set(requests.flatMap((c) => (c.type === "leave" && c.params.days.includes(20) ? [c.params.nurse_id] : [])));
  expect(offOn20.size, "11/20 휴가 인원").toBe(8);
  const lee = await nurseId(page, "이영희");
  const leeLeave15 = (list: ConstraintSpec[]) =>
    list.find((c) => c.type === "leave" && c.params.nurse_id === lee && c.params.days.includes(15));
  expect(leeLeave15(requests)?.params, "S8의 이영희 15~17일 휴가가 남아 있음").toEqual({ nurse_id: lee, days: [15, 16, 17] });

  await page.getByRole("button", { name: "다음" }).click();
  const stale = page.getByRole("status").filter({ hasText: "입력이 바뀌었어요. 다시 만들어 주세요" });
  await expect(stale).toBeVisible();

  expect(await solve(() => stale.getByRole("button", { name: "다시 만들기" }).click())).toBe("infeasible");
  const panel = page.locator("section").filter({ hasText: "규칙을 모두 지키는 근무표가 없어요" });
  await expect(panel.getByText("근무표 없음", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "함께 지킬 수 없는 규칙" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "이번 근무표에서만 끄기" }).first()).toBeVisible();
  const explanation = panel.locator("p.whitespace-pre-line");
  await expect(explanation).not.toBeEmpty();
  test.info().annotations.push({ type: "충돌 설명", description: await explanation.innerText() });

  const proposals = panel.locator("article").filter({ hasText: "검증됨" });
  if ((await proposals.count()) > 0) {
    const first = proposals.first();
    await expect(first).toContainText(/이렇게 바꾸면 근무표를 만들 수 있어요 · 희망 반영 \d+\/\d+/);
    test.info().annotations.push({ type: "S10 분기", description: `10-a 제안 수락: ${await first.innerText()}` });
    expect(await solve(() => first.getByRole("button", { name: "수락" }).click())).toBe("ok");
  } else {
    test.info().annotations.push({ type: "S10 분기", description: "10-b 이번 근무표에서만 끄기" });
    for (let tries = 0; ; tries++) {
      expect(tries, "이번 근무표에서만 끄기 반복").toBeLessThan(8);
      const rows = panel.locator("li").filter({ has: page.getByRole("button", { name: "이번 근무표에서만 끄기" }) });
      const leaveRow = rows.filter({ hasText: "11/20" });
      const row = (await leaveRow.count()) > 0 ? leaveRow.first() : rows.first();
      if ((await solve(() => row.getByRole("button", { name: "이번 근무표에서만 끄기" }).click())) === "ok") break;
    }
  }

  await expect(page.getByText("규칙을 모두 지키는 근무표가 없어요")).toHaveCount(0);
  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expectHardRulesHold(page, NOV, lastSolve);
  expect(leeLeave15(lastSolve!.constraints ?? [])?.enabled, "이영희 15~17일 휴가가 켜져 있음").not.toBe(false);
  expect((await readGrid(page, NOV))["이영희"].slice(14, 17)).toEqual(["O", "O", "O"]);
});

test("S11. 칸 고정 후 다시 만들기", async () => {
  const grid = await readGrid(page, NOV);
  const row = grid["김철수"];
  // 11/10부터, 근무가 있고 전날이 N이 아닌 날을 O로 고정한다(나이트 규칙과 부딪히지 않게)
  const day = Array.from({ length: NOV.length - 9 }, (_, i) => i + 10).find((d) => row[d - 1] !== "O" && row[d - 2] !== "N");
  expect(day, "고정할 날").toBeDefined();
  fixedCell = { day: day!, code: "O" };
  const before = row[day! - 1];

  await page.getByRole("button", { name: `김철수 11월 ${day}일 ${before}` }).click();
  await expect(page.getByText(`김철수 11/${day}`)).toBeVisible();
  for (const code of ["D", "E", "N", "O"]) await expect(page.getByRole("button", { name: `${code}로 고정` })).toBeVisible();

  expect(await solve(() => page.getByRole("button", { name: "O로 고정" }).click())).toBe("ok");
  const cell = page.getByRole("button", { name: `김철수 11월 ${day}일 O` });
  await expect(cell.locator("svg")).toHaveCount(1);
  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expectHardRulesHold(page, NOV, lastSolve);

  const afterFix = await readGrid(page, NOV);
  const other = afterFix["한소율"][4];
  await page.getByRole("button", { name: `한소율 11월 5일 ${other}` }).click();
  await expect(page.getByRole("button", { name: "D로 고정" })).toBeVisible();
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByRole("button", { name: "D로 고정" })).toHaveCount(0);
  expect(await readGrid(page, NOV)).toEqual(afterFix);
});

test("S12. 확정(게스트) → 확정 근무표", async () => {
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "확정했어요. 이 브라우저에만 저장돼 있어요" })).toBeVisible();
  await expect(page.getByRole("button", { name: "확정", exact: true })).toHaveCount(0);
  await expect(workStepper()).toHaveCount(0);
  await expect(page.getByRole("button", { name: "이전" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "CSV 받기" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).locator("..").getByText("확정", { exact: true })).toBeVisible();
  await expect(page.getByText(/마지막 확정/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "변경 입력" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "변경 입력" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 확정" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "변경 취소" })).toHaveCount(0);
  const cell = page.getByRole("button", { name: `김철수 11월 ${fixedCell.day}일 ${fixedCell.code}` });
  await expect(cell.locator("svg")).toHaveCount(1);
  finalGrid = await readGrid(page, NOV);
  expect((await periodByStart(page, NOV.start_date)).versions).toHaveLength(1);
  await expectNoDevTerms(page, "확정 근무표");

  await page.getByRole("button", { name: "← 근무표 목록" }).click();
  await expect(page.getByText("운영 중", { exact: true })).toHaveCount(0); // 11월은 아직 시작 전
  await expect(page.getByRole("main")).toContainText(`간호사 15명 · 병동 규칙 ${ruleCount}개 · 한 달 단위`);
  const task = sectionWith("11월 근무표");
  await expect(task).toContainText("확정했어요 · 10/28 09:00");
  await expect(task.getByRole("button", { name: "열기" })).toBeVisible();
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("12월 근무표 만들기");
  await expect(page.getByText("확정한 근무표가 여기에 쌓여요.")).toBeVisible();
  await expectNoDevTerms(page, "병동 홈(11월 확정 후)");
});

test("S13. 저장과 다시 들어오기", async () => {
  // 확정한 근무표는 확정 근무표 화면으로 열린다
  await sectionWith("11월 근무표").getByRole("button", { name: "열기" }).click();
  await expect(page.getByRole("heading", { name: "변경 입력" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  // 시작 화면 없이 마지막 화면으로 바로 들어간다
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11월 근무표");
  await expect(page.getByRole("heading", { name: "변경 입력" })).toBeVisible();
  await expect(scheduleTitle(page)).toBeVisible();
  expect(await readGrid(page, NOV)).toEqual(finalGrid);
  const p = await periodByStart(page, NOV.start_date);
  expect(p.holidays).toEqual([HOLIDAY]);
  const lee = await nurseId(page, "이영희");
  expect(p.requests.some((c) => c.type === "leave" && c.params.nurse_id === lee && c.params.days.join() === "15,16,17")).toBe(true);

  // 병동 설정은 고칠 때만 쓴다([첫 근무표 만들기] 없음)
  await page.getByRole("button", { name: "병동 설정", exact: true }).click();
  await expect(page.getByRole("button", { name: "첫 근무표 만들기" })).toHaveCount(0);
  await page.getByRole("tab", { name: "병동 규칙" }).click();
  await expect(appliedCards(page)).toHaveCount(ruleCount);
});
