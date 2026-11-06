// docs/BROWSER_TEST_SCENARIOS.md S5~S13(데모 저니 1~7), S19. 매장 준비부터 직원 입력과 첫 근무표까지 앞 시나리오의 상태를 이어받는 하나의 흐름이라
// 페이지 하나를 공유하며 순서대로 돈다. LLM은 mock하지 않는다(ADR-013).
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { ruleShape } from "../lib/rules";
import { presetName } from "../lib/wording";
import type { PeriodRange } from "../lib/period";
import type { ConstraintSpec, ScheduleRequest } from "../lib/types.gen";
import {
  addRoster,
  appliedCards,
  applyAllPending,
  clearAccount,
  type Code,
  confirmedGrid,
  confirmSchedule,
  deleteAllPending,
  dragCells,
  EMPLOYEE_COUNT,
  employeeId,
  expectCardChrome,
  expectHardRulesHold,
  expectNoDevTerms,
  expectNoProblems,
  expectSaved,
  fullDaySlots,
  getAvailability,
  type Grid,
  interpret,
  interpretOk,
  leaveOf,
  leavesOf,
  getRoster,
  linkRows,
  loginAsTestUser,
  openFlow,
  pendingCards,
  periodByStart,
  primaryButtons,
  readCells,
  readGrid,
  readState,
  ROSTER,
  savedDoc,
  scheduleTitle,
  shownLinks,
  solveVia,
  submitAvailability,
  submitFullDay,
  openStats,
} from "./test-helpers";

const WEEK: PeriodRange = { start_date: "2026-11-02", length: 7 };
const WEEK_NAME = "11/2~11/8 근무표";
const WEEK_RANGE = "2026.11.2 – 11.8";
const HOLIDAY = 3; // 11/4
// [요일 종류, 근무 이름, 최소, 최대] (D2)
const COVERAGE: [string, string, number, number][] = [
  ["평일", "오픈", 1, 2],
  ["평일", "미들", 1, 2],
  ["평일", "마감", 3, 3],
  ["주말·공휴일", "오픈", 2, 2],
  ["주말·공휴일", "미들", 2, 2],
  ["주말·공휴일", "마감", 3, 3],
];
const SHIFT_CODE: Record<string, string> = { 오픈: "A", 미들: "M", 마감: "C" };
const RULE_INPUT = "매장 조건 입력";
const REQUEST_INPUT = "예외 입력";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let problems: string[] = [];
let lastSolve: ScheduleRequest | undefined;
let ruleCount: number;
let shareLink: string;
let fixedCell: { day: number; code: Code };
let finalGrid: Grid;

const workStepper = () => page.getByRole("list", { name: "근무표 작성 단계" });
const currentStep = () => workStepper().locator('[aria-current="step"]');
const sectionWith = (heading: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

async function solve(action: () => Promise<void>) {
  const { status, request } = await solveVia(page, action);
  lastSolve = request;
  return status;
}

test.beforeAll(async ({ browser }) => {
  ({ context, page, problems } = await openFlow(browser));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3000" });
});

test.afterAll(async () => {
  await context.close();
});

test.afterEach(async () => {
  await expectNoProblems(page, problems);
});

test("S5. 매장 준비 → 첫 근무표 시작", async () => {
  await clearAccount();
  await page.goto("/app");
  await loginAsTestUser(page);
  await expect(page.getByRole("heading", { name: "매장 준비", level: 1 })).toBeVisible();
  await expect(workStepper()).toHaveCount(0);
  await expect(page.getByRole("button", { name: "매장 설정", exact: true })).toHaveCount(0);

  await page.getByRole("textbox", { name: "매장 이름" }).fill("한강 카페");
  await expect(page.getByRole("banner")).toContainText("한강 카페 · 1주 단위");
  const unit = page.getByRole("combobox", { name: "근무표 주기" });
  await unit.selectOption({ label: "2주" });
  await expect(page.getByRole("banner")).toContainText("한강 카페 · 2주 단위");
  // 근무표가 아직 없으니 "다음에 만드는 근무표부터" 안내는 없다
  await expect(page.getByText("다음에 만드는 근무표부터 적용돼요.")).toHaveCount(0);
  await unit.selectOption({ label: "1주" });

  const start = page.getByRole("button", { name: "첫 근무표 시작하기" });
  await expect(start).toBeDisabled();
  await expect(page.getByText("명단에 직원을 1명 이상 넣으면 시작할 수 있어요")).toBeVisible();
  await expect(page.getByText("바꾼 내용은 바로 저장돼요.")).toBeVisible();
  await expect(page.getByText("이니셜을 써도 됩니다")).toBeVisible();
  await expect(page.getByText("직급에는 이름을 쓰지 마세요")).toBeVisible();

  await addRoster(page, ROSTER);

  // 잘못된 줄은 더하지 않고 그 칸에 오류를 보인다
  const newName = page.getByRole("textbox", { name: "새 직원 이름" });
  await newName.fill("이영희");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(newName).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("같은 이름이 이미 있어요")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "13행 이름", exact: true })).toHaveCount(0);
  await newName.fill("");

  await expect(page.getByRole("textbox", { name: "1행 이름", exact: true })).toHaveValue("이영희");
  await expect(page.getByRole("textbox", { name: "12행 이름", exact: true })).toHaveValue("신도윤");
  for (const label of ["1행 직급 리더 빼기", "6행 직급 리더 빼기", "7행 직급 리더 빼기", "11행 직급 신입 빼기", "12행 직급 신입 빼기"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /붙이기/ })).toHaveCount(0);

  // 근무표에서 빼기 → 제외 → 다시 넣기
  const idsBefore = (await readState(page)).shop.employees.map((n) => n.id);
  const lastRow = page.getByRole("row").filter({ has: page.getByRole("textbox", { name: "12행 이름", exact: true }) });
  await lastRow.getByRole("button", { name: "근무표에서 빼기" }).click();
  await expect(page.getByRole("textbox", { name: "12행 이름", exact: true })).toHaveCount(0);
  await expect(page.getByText("근무표에서 빼도 지난 근무표와 통계에는 남아요.")).toBeVisible();
  await page.getByRole("button", { name: "제외된 직원 1명 보기" }).click();
  const excludedRow = page.getByRole("row").filter({ hasText: "신도윤" });
  await expect(excludedRow.getByText("제외", { exact: true })).toBeVisible();
  await excludedRow.getByRole("button", { name: "다시 넣기" }).click();
  await expect(page.getByRole("textbox", { name: "12행 이름", exact: true })).toHaveValue("신도윤");

  const { shop } = await readState(page);
  expect(shop.name).toBe("한강 카페");
  expect(shop.unit).toBe("1w");
  expect(shop.employees.map((n) => n.id), "직원 id 유지").toEqual(idsBefore);
  expect(shop.employees.filter((n) => n.active)).toHaveLength(EMPLOYEE_COUNT);
  const tagged = (tag: string) => shop.employees.filter((n) => n.tags.includes(tag)).map((n) => n.name);
  expect(tagged("리더")).toEqual(["이영희", "강서연", "윤지민"]);
  expect(tagged("신입")).toEqual(["서예린", "신도윤"]);
  await expectNoDevTerms(page, "매장 준비");

  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(WEEK_NAME);
  await expect(page.getByRole("button", { name: "매장 설정", exact: true })).toBeVisible();
  await expectSaved(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(WEEK_NAME);
});

test("S6. ① 가능 시간: 준비 요약과 직원 링크", async () => {
  const titleRow = page.getByRole("heading", { level: 1 }).locator("..");
  await expect(titleRow).toContainText(WEEK_RANGE);
  await expect(titleRow.getByText("작성 중", { exact: true })).toBeVisible();
  await expect(workStepper().getByRole("listitem")).toHaveCount(3);
  await expect(currentStep()).toContainText("가능 시간");
  await expect(workStepper().getByRole("button", { name: /매장 조건/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "이전" })).toHaveCount(0);

  await expect(page.getByRole("main")).toContainText(`${WEEK_RANGE} · 공휴일 없음 · 직원 ${EMPLOYEE_COUNT}명 · 지난 근무 없음`);
  const prepare = page.getByRole("button", { name: "바꾸기" });
  await expect(prepare).toHaveAttribute("aria-expanded", "false");
  await prepare.click();
  await expect(page.getByRole("button", { name: "접기" }).first()).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("시작일")).toHaveValue(WEEK.start_date);
  await expect(page.getByRole("main")).toContainText("2026.11.8 · 7일");
  await expect(page.getByText("2026년 11월")).toBeVisible();
  await expect(page.getByRole("button", { name: /^\d+월 \d+일 공휴일 (지정|해제)$/ })).toHaveCount(7);
  await page.getByRole("button", { name: "11월 4일 공휴일 지정" }).click();
  await expect(page.getByRole("button", { name: "11월 4일 공휴일 해제" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("main")).toContainText(`${WEEK_RANGE} · 공휴일 1일 · 직원 ${EMPLOYEE_COUNT}명`);

  await expect(sectionWith("명단 확인")).toContainText(`직원 ${EMPLOYEE_COUNT}명`);
  await expect(page.getByText("지난 근무표와 명단이 같아요")).toHaveCount(0);
  const carryToggle = page.getByRole("button", { name: "지난 근무 입력하기 (선택)" });
  await expect(carryToggle).toHaveAttribute("aria-expanded", "false");
  await carryToggle.click();
  await expect(page.getByRole("heading", { name: "지난 근무 마지막 며칠 (선택)" })).toBeVisible();
  await expect(page.getByText(/지금 반영된 직원:\s*0명/)).toBeVisible();
  await expectNoDevTerms(page, "① 가능 시간(준비 펼침)");
  await page.getByRole("button", { name: "접기" }).first().click();
  await expect(page.getByRole("heading", { name: "명단 확인" })).toHaveCount(0);

  // 직원 링크
  await expect(page.getByText("단체 대화방에 이 링크 하나만 올려 주세요. 직원이 자기 이름을 골라 가능 시간을 입력해요")).toBeVisible();
  await expect(page.getByRole("button", { name: "링크 복사" })).toHaveCount(1);
  await expect(page.getByText(`${EMPLOYEE_COUNT}명 중 0명 제출`)).toBeVisible();
  await expect(page.getByText(/^미제출: /)).toContainText("박민수");
  await expect(page.getByRole("heading", { name: "직원별 가능 시간" })).toBeVisible();
  await expect(page.getByRole("region", { name: /가능 시간$/ })).toHaveCount(EMPLOYEE_COUNT);
  await expect(page.getByRole("region", { name: /가능 시간$/ }).getByText("미제출", { exact: true })).toHaveCount(EMPLOYEE_COUNT);
  await expect(page.getByRole("table", { name: "날짜별 가능 인원" }).getByRole("cell").filter({ hasNotText: /^0$/ })).toHaveCount(0);
  const links = await shownLinks(page);
  expect(links).toHaveLength(1);
  await page.getByRole("button", { name: "링크 복사" }).click();
  await expect(page.getByRole("button", { name: "복사했어요" })).toBeVisible();
  shareLink = await page.evaluate(() => navigator.clipboard.readText());
  expect(shareLink).toBe(links[0].trim());
  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeEnabled();

  const p = await periodByStart(page, WEEK.start_date);
  expect({ start_date: p.start_date, length: p.length }).toEqual(WEEK);
  expect(p.holidays).toEqual([HOLIDAY]);
  const rows = await linkRows(WEEK.start_date);
  expect(rows).toHaveLength(EMPLOYEE_COUNT);
  expect(new Set(rows.map((r) => r.token)).size, "토큰이 모두 다르다").toBe(EMPLOYEE_COUNT);
  await expectNoDevTerms(page, "① 가능 시간");

  // 명단에서 뺀 직원은 공용 링크의 명단에서도 사라지고, 다시 넣으면 돌아온다
  const rosterNames = async () => {
    const { data } = await getRoster(new URL(shareLink).pathname.split("/").at(-1)!);
    return (data as { employee_name: string }[]).map((r) => r.employee_name);
  };
  const openLinks = async () => {
    await page.getByRole("button", { name: "근무표", exact: true }).click();
    await page.getByRole("button", { name: "이어서 하기" }).click();
    await expect(page.getByRole("button", { name: "링크 복사" })).toHaveCount(1);
  };
  await page.getByRole("button", { name: "매장 설정", exact: true }).click();
  await page.getByRole("tab", { name: "명단" }).click();
  await page.getByRole("button", { name: "근무표에서 빼기" }).last().click();
  await openLinks();
  await expect.poll(rosterNames, { message: "빠진 직원 없음" }).not.toContain("신도윤");
  await page.getByRole("button", { name: "매장 설정", exact: true }).click();
  await page.getByRole("tab", { name: "명단" }).click();
  await page.getByRole("button", { name: "제외된 직원 1명 보기" }).click();
  await page.getByRole("row").filter({ hasText: "신도윤" }).getByRole("button", { name: "다시 넣기" }).click();
  await openLinks();
  await expect.poll(rosterNames, { message: "다시 넣은 직원 있음" }).toContain("신도윤");
});

test("S7. 직원 화면: 드래그 입력과 제출", async ({ browser }) => {
  const staff = await openFlow(browser, { width: 1280, height: 800 });
  const p = staff.page;
  const cell = (label: string) => p.getByRole("button", { name: label, exact: true });
  const pressed = p.locator('main button[aria-pressed="true"]');

  await p.goto(shareLink);
  await expect(p.getByRole("heading", { name: "내 이름을 골라 주세요" })).toBeVisible();
  await expect(p.getByRole("main").getByRole("button").filter({ hasNotText: "개인정보" })).toHaveCount(EMPLOYEE_COUNT);
  const { data: roster } = await getRoster(new URL(shareLink).pathname.split("/").at(-1)!);
  expect(JSON.stringify(roster), "명단 응답에 칸이 없다").not.toContain("slots");
  expect(JSON.stringify(roster), "명단 응답에 직원 id가 없다").not.toContain("employee_id");
  await expectNoDevTerms(p, "직원 화면(이름 고르기)");
  await p.getByRole("button", { name: "박민수", exact: true }).click();
  await expect(p.getByRole("heading", { name: "한강 카페 · 박민수님" })).toBeVisible();
  await expect(p.getByRole("banner").getByRole("button", { name: "계정 메뉴" })).toHaveCount(0);
  await expect(p.getByRole("button", { name: "매장 설정", exact: true })).toHaveCount(0);
  await expect(p.getByRole("button", { name: /^\d+월 \d+일 \d{2}:\d{2}~\d{2}:\d{2}$/ })).toHaveCount(7 * 36);
  await expect(pressed).toHaveCount(0);
  const size = await p.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(size.width, "가로 스크롤 없음").toBeLessThanOrEqual(1280);
  expect(size.height, "세로 스크롤 없음").toBeLessThanOrEqual(size.innerHeight);
  await expectNoDevTerms(p, "직원 화면");

  await dragCells(p, "11월 3일 12:00~12:30", "11월 3일 22:30~23:00");
  await expect(pressed).toHaveCount(22);
  await dragCells(p, "11월 5일 09:00~09:30", "11월 5일 11:30~12:00");
  await expect(pressed).toHaveCount(28);
  // 칠한 칸에서 시작하면 지운다
  await dragCells(p, "11월 5일 09:00~09:30", "11월 5일 11:30~12:00");
  await expect(pressed).toHaveCount(22);
  await dragCells(p, "11월 5일 12:00~12:30", "11월 5일 17:30~18:00");
  await expect(pressed).toHaveCount(34);
  // 열을 건너는 드래그는 직사각형으로 칠하고, 칠한 칸에서 시작하면 직사각형을 지운다(3열 × 6칸)
  await expect(p.getByText("여러 날을 가로질러 드래그하면 한 번에 칠해져요")).toBeVisible();
  await dragCells(p, "11월 3일 09:00~09:30", "11월 5일 11:30~12:00");
  await expect(pressed).toHaveCount(34 + 18);
  await expect(cell("11월 4일 09:00~09:30")).toHaveAttribute("aria-pressed", "true");
  await expect(cell("11월 4일 11:30~12:00")).toHaveAttribute("aria-pressed", "true");
  await dragCells(p, "11월 3일 09:00~09:30", "11월 5일 11:30~12:00");
  await expect(pressed).toHaveCount(34);
  // [모든 날에 복사]: 11/5의 12:00~18:00(12칸)이 칠한 칸이 없는 5일에 더해지고, 11/3은 이미 덮여 그대로다
  await p.getByRole("button", { name: "11월 5일 칠한 시간을 모든 날에 복사" }).click();
  await expect(pressed).toHaveCount(34 + 5 * 12);
  await expect(cell("11월 8일 12:00~12:30")).toHaveAttribute("aria-pressed", "true");
  // 되돌려 34칸(11/3 22칸, 11/5 12칸)으로 끝낸다. 뒤 시나리오가 이 가능 시간을 쓴다
  await dragCells(p, "11월 6일 12:00~12:30", "11월 8일 17:30~18:00");
  await expect(pressed).toHaveCount(34 + 2 * 12);
  for (const day of [2, 4]) await dragCells(p, `11월 ${day}일 12:00~12:30`, `11월 ${day}일 17:30~18:00`);
  await expect(pressed).toHaveCount(34);
  // 키보드 토글
  const keyCell = cell("11월 5일 18:00~18:30");
  await keyCell.focus();
  await p.keyboard.press("Space");
  await expect(keyCell).toHaveAttribute("aria-pressed", "true");
  await p.keyboard.press("Space");
  await expect(keyCell).toHaveAttribute("aria-pressed", "false");

  await p.getByRole("button", { name: "제출" }).click();
  await expect(p.getByText("제출했어요. 이 링크로 다시 고칠 수 있어요")).toBeVisible();
  await expectNoDevTerms(p, "직원 화면(제출 뒤)");

  // 다시 열어도 같다. 다른 직원 정보는 보이지 않는다
  const reopen = await openFlow(browser, { width: 1280, height: 800 });
  const parkToken = (await linkRows(WEEK.start_date)).find((r) => r.employee_name === "박민수")!.token;
  await reopen.page.goto(shareLink);
  // 제출한 이름은 다시 묻고, 취소하면 이름 고르기에 남는다
  await reopen.page.getByRole("button", { name: "박민수 제출함" }).click();
  await reopen.page.getByRole("button", { name: "취소" }).click();
  await expect(reopen.page.getByRole("button", { name: "이어서 고치기" })).toHaveCount(0);
  await reopen.page.getByRole("button", { name: "박민수 제출함" }).click();
  await reopen.page.getByRole("button", { name: "이어서 고치기" }).click();
  await expect(reopen.page.locator('main button[aria-pressed="true"]')).toHaveCount(34);
  await expect(reopen.page.getByRole("button", { name: "11월 3일 12:00~12:30" })).toHaveAttribute("aria-pressed", "true");
  await expect(reopen.page.getByRole("button", { name: "11월 5일 17:30~18:00" })).toHaveAttribute("aria-pressed", "true");
  await expect(reopen.page.getByRole("button", { name: "11월 5일 11:30~12:00" })).toHaveAttribute("aria-pressed", "false");
  const others = ROSTER.map(([n]) => n).filter((n) => n !== "박민수");
  const body = await reopen.page.locator("body").innerText();
  const { data: rpc } = await getAvailability(parkToken);
  for (const name of others) {
    expect(body.includes(name), `화면에 ${name} 없음`).toBe(false);
    expect(JSON.stringify(rpc).includes(name), `응답에 ${name} 없음`).toBe(false);
  }
  await expectNoProblems(reopen.page, reopen.problems);
  await reopen.context.close();

  // 틀린 토큰
  await p.goto(`/a/${crypto.randomUUID()}`);
  await expect(p.getByText("링크를 확인해 주세요")).toBeVisible();
  await expect(p.getByRole("button", { name: "제출" })).toHaveCount(0);
  await expect(p.getByRole("button", { name: /^\d+월 \d+일 \d{2}:/ })).toHaveCount(0);
  await expectNoDevTerms(p, "직원 화면(틀린 토큰)");
  await expectNoProblems(p, staff.problems);
  await staff.context.close();

  // 박민수 말고 11명은 제출 도우미로 전일을 넣는다
  await submitFullDay(WEEK, EMPLOYEE_COUNT, ["박민수"]);
  const rows = await linkRows(WEEK.start_date);
  expect(rows.every((r) => r.submitted_at), "12행 모두 제출").toBe(true);
  const park = rows.find((r) => r.employee_name === "박민수")!;
  expect(park.slots).toEqual({ "2026-11-03": [["12:00", "23:00"]], "2026-11-05": [["12:00", "18:00"]] });
  // 매니저 화면의 제출 현황은 [새로고침]에서 다시 읽는다
  await page.getByRole("button", { name: "새로고침" }).click();
  await expect(page.getByText(`${EMPLOYEE_COUNT}명 중 ${EMPLOYEE_COUNT}명 제출`)).toBeVisible();
  await expect(page.getByText("미제출:")).toHaveCount(0);

  // 매니저는 제출한 가능 시간을 한 화면에서 본다
  const counts = page.getByRole("table", { name: "날짜별 가능 인원" });
  const countCell = (shift: string, column: number) => counts.getByRole("row", { name: new RegExp(`^${shift} `) }).getByRole("cell").nth(column);
  await expect(countCell("마감", 1)).toHaveText(String(EMPLOYEE_COUNT)); // 11/3: 박민수도 덮는다
  await expect(countCell("미들", 3)).toHaveText(String(EMPLOYEE_COUNT)); // 11/5: 박민수도 덮는다
  await expect(countCell("마감", 3)).toHaveText(String(EMPLOYEE_COUNT - 1)); // 11/5: 일부만 겹치면 세지 않는다
  await expect(countCell("오픈", 3)).toHaveText(String(EMPLOYEE_COUNT - 1));
  const parkCard = page.getByRole("region", { name: "박민수 가능 시간" });
  await expect(parkCard.getByRole("img")).toHaveCount(2);
  await expect(parkCard.getByRole("img", { name: "11월 3일 12:00~23:00" })).toBeVisible();
  await expect(parkCard.getByRole("img", { name: "11월 5일 12:00~18:00" })).toBeVisible();
  await expect(parkCard.getByText("미제출", { exact: true })).toHaveCount(0);
  await expect(parkCard.getByRole("button")).toHaveCount(0);
  await expectNoDevTerms(page, "① 가능 시간(직원별 가능 시간)");
});

test("S8. ② 매장 조건", async () => {
  await page.getByRole("button", { name: "다음", exact: true }).click();

  // S8-a. 요약표와 필요 인원 폼
  await expect(currentStep()).toContainText("매장 조건");
  await expect(page.getByRole("heading", { name: "매장 조건", exact: true }).first()).toBeFocused();
  await expect(page.getByText("근무 형태, 필요 인원, 지켜야 할 규칙 모두 한 곳에서요.")).toBeVisible();
  const summaryRow = (name: string) => page.getByRole("row").filter({ hasText: name }).first();
  await expect(summaryRow("오픈")).toContainText("09:00~15:00");
  await expect(summaryRow("미들")).toContainText("12:00~18:00");
  await expect(summaryRow("마감")).toContainText("17:00~23:00");
  await expect(page.getByRole("button", { name: "바꾸기" })).toHaveAttribute("aria-expanded", "false");
  for (const ex of ["평일 오픈 2명, 주말은 3명", "12시부터 15시까지는 최소 3명", "마감 다음 날 오픈은 안 되게"]) {
    await expect(page.getByRole("button", { name: ex })).toBeVisible();
  }
  const next = page.getByRole("button", { name: "다음", exact: true });
  await expect(next).toBeEnabled();
  await expect(page.getByText("필요 인원 없이 만들면 인원을 맞추지 않아요")).toBeVisible();
  const numbers = page.getByRole("button", { name: "숫자로 입력하기" });
  await expect(numbers).toHaveAttribute("aria-expanded", "false");
  await numbers.click();
  await expect(numbers).toHaveAttribute("aria-expanded", "true");
  for (const [kind, shift, min, max] of COVERAGE) {
    await page.getByRole("textbox", { name: `${kind} ${shift} 최소 인원` }).fill(String(min));
    await page.getByRole("textbox", { name: `${kind} ${shift} 최대 인원` }).fill(String(max));
  }
  await expect(page.getByText("필요 인원 없이 만들면 인원을 맞추지 않아요")).toHaveCount(0);
  await expect(page.getByText(/명 근무 · \d+명 쉼/)).toHaveCount(0);
  // 요약표는 켜진 반드시 필요 인원 규칙을 합친 값이다. 말로 만든 날마다 규칙도 같은 표에 든다(S18)
  await expect(page.getByText("켜진 반드시 필요 인원 규칙을 합친 값이에요. 일부 날짜에만 적용되는 규칙은 카드에서 봐요")).toBeVisible();
  await expect(summaryRow("오픈").locator("td").nth(2)).toHaveText("1~2명");
  await expect(summaryRow("마감").locator("td").nth(3)).toHaveText("3명");
  const weekdayMin = page.getByRole("textbox", { name: "평일 오픈 최소 인원" });
  const weekdayMax = page.getByRole("textbox", { name: "평일 오픈 최대 인원" });
  await weekdayMin.fill("abc");
  await expect(weekdayMin).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("인원은 숫자로 적어 주세요.")).toBeVisible();
  await weekdayMin.fill("5");
  await expect(page.getByText("최소가 최대보다 커요.")).toBeVisible();
  // 근무조 합계로 막지 않는다
  await weekdayMin.fill("10");
  await weekdayMax.fill("10");
  await expect(page.getByText("쉴 사람이 없어요", { exact: false })).toHaveCount(0);
  await expect(page.getByText(/인원은 숫자로|최소가 최대보다/)).toHaveCount(0);
  await weekdayMin.fill("1");
  await weekdayMax.fill("2");
  await expect(page.getByText(/인원은 숫자로|최소가 최대보다/)).toHaveCount(0);

  await page.getByRole("button", { name: "이전" }).click();
  await expect(page.getByRole("button", { name: "링크 복사" })).toHaveCount(1);
  await next.click();
  await expect(currentStep()).toContainText("매장 조건");

  const coverage = (await readState(page)).shop.rules.filter((c) => c.id.startsWith("cov-"));
  expect(coverage).toHaveLength(6);
  expect(coverage.every((c) => c.type === "rule" && c.default === true), "필요 인원은 기본 규칙").toBe(true);
  const ranges = coverage.map((c) => {
    const s = ruleShape(c);
    return s?.kind === "count" ? `${s.days.kind}-${s.shifts.in?.join()}:${s.min?.n}~${s.max?.n}` : c.id;
  });
  expect(ranges.sort(), "칸마다 최소~최대").toEqual(
    COVERAGE.map(([kind, shift, min, max]) => `${kind === "평일" ? "weekday" : "weekend"}-${SHIFT_CODE[shift]}:${min}~${max}`).sort(),
  );

  // S8-b. 규칙 만들기와 적용. 요약표에 든 필요 인원은 카드로 다시 보이지 않고, 공정성 기본 규칙 2장(최대 연속 근무, 근무 수 고르게)만 있다
  await expect(page.locator("article")).toHaveCount(2);
  await expect(appliedCards(page)).toHaveCount(2);
  await page.getByRole("button", { name: "마감 다음 날 오픈은 안 되게" }).click();
  await expect(page.getByRole("textbox", { name: RULE_INPUT })).toHaveValue("마감 다음 날 오픈은 안 되게");

  const r1 = await interpretOk(page, RULE_INPUT, "규칙 만들기", "마감 다음 날 오픈은 안 되게");
  expect(r1.length).toBeGreaterThan(0);
  await expect(pendingCards(page).first()).toContainText("마감 다음 날 오픈 금지");
  const r2 = await interpretOk(page, RULE_INPUT, "규칙 만들기", "5일 넘게 연속으로 일하지 않게");
  expect(r2.length).toBeGreaterThan(0);
  // 기본 규칙 "연속 근무는 5일까지"(가능하면)와 같은 모양이면 적용할 때 그 카드를 대체한다. 근무를 코드 집합으로 세우면 따로 남는다
  const r2Card = page.locator("article").filter({ hasText: "5일 넘게" });
  await expect(r2Card).toContainText("적용 대기");
  const r2Replaces = (await r2Card.getByText("기존 규칙 대체").count()) > 0;
  test.info().annotations.push({ type: "R2 기본 규칙 대체", description: String(r2Replaces) });
  await expect(r2Card).toContainText("연속 근무 5일까지");
  const r3 = await interpretOk(page, RULE_INPUT, "규칙 만들기", "오픈에는 리더가 꼭 1명 있어야 해");
  expect(r3.length).toBeGreaterThan(0);
  const r3Card = pendingCards(page).filter({ hasText: "리더" }).first();
  await expect(r3Card).toContainText("오픈");
  await expect(r3Card).toContainText("1명 이상");
  const r4 = await interpretOk(page, RULE_INPUT, "규칙 만들기", "12시부터 15시까지는 최소 3명");
  // 시간대 필요 인원: 12~15시를 덮는 코드는 정확히 {A, M}이다(ADR-020)
  const peakCodes = r4.flatMap((c) => {
    const s = ruleShape(c);
    return s?.kind === "count" && s.per === "day" ? [{ codes: [...(s.shifts.in ?? [])].sort().join(), min: s.min?.n }] : [];
  });
  expect(peakCodes.length, `시간대 필요 인원 규칙: ${JSON.stringify(r4)}`).toBeGreaterThan(0);
  for (const p of peakCodes) expect(p).toEqual({ codes: "A,M", min: 3 });
  test.info().annotations.push({ type: "시간대 필요 인원 코드", description: JSON.stringify(peakCodes) });
  const r4Card = pendingCards(page).filter({ hasText: "3명 이상" }).first();
  await expect(r4Card).toContainText("오픈");
  await expect(r4Card).toContainText("미들");
  await expect(r4Card).not.toContainText("마감");

  const total = r1.length + r2.length + r3.length + r4.length;
  await expect(pendingCards(page)).toHaveCount(total);
  for (const card of await pendingCards(page).all()) await expectCardChrome(card, "반드시");
  await expect(page.getByText(`적용하지 않은 규칙 ${total}개는 빠져요`)).toBeVisible();
  await expectNoDevTerms(page, "② 매장 조건(적용 대기)");

  const toggle = r2Card.getByRole("group", { name: "반드시/가능하면" });
  await toggle.getByRole("button", { name: "가능하면" }).click();
  await expect(toggle.getByRole("button", { name: "가능하면" })).toHaveAttribute("aria-pressed", "true");
  await toggle.getByRole("button", { name: "반드시" }).click();
  await expect(toggle.getByRole("button", { name: "반드시" })).toHaveAttribute("aria-pressed", "true");

  await applyAllPending(page);
  // R2가 기본 규칙 최대 연속 근무를 대체하면 공정성 기본 규칙은 근무 수 고르게만 남는다
  const fairLeft = (await readState(page)).shop.rules.filter((r) => r.id.startsWith("fair-")).map((r) => r.id);
  expect(fairLeft, "남은 공정성 기본 규칙").toEqual(r2Replaces ? ["fair-balance"] : ["fair-max-run", "fair-balance"]);
  await expect(appliedCards(page)).toHaveCount(total + fairLeft.length);
  await expect(page.getByText(/적용하지 않은 규칙/)).toHaveCount(0);

  // S8-c. 적용된 카드 수정: 조정 가능한 값(밑줄)만 고친다. 값 이름은 LLM이 붙여 입력칸은 카드 안의 하나로 찾는다
  await expect(r2Card.locator(".decoration-dotted")).toHaveText("5");
  for (const days of ["6", "5"]) {
    await r2Card.getByRole("button", { name: "수정" }).click();
    await expect(r2Card.getByText("바꾸려면 말로 다시 적어 주세요")).toBeVisible();
    await r2Card.getByRole("textbox").fill(days);
    await r2Card.getByRole("button", { name: "저장" }).click();
    await expect(r2Card).toContainText(`연속 근무 ${days}일까지`);
  }

  // S8-d. 되묻기와 미지원. LLM 판단이 달라도 실패로 보지 않고 기록한 뒤 생긴 카드를 지운다
  for (const text of ["주말은 적당히", "사이 안 좋은 직원끼리는 같은 날 근무 안 넣게"]) {
    const body = await interpret(page, RULE_INPUT, "규칙 만들기", text);
    if (body.status === "clarify") await expect(page.getByText("내용을 보완해서 다시 입력해 주세요.")).toBeVisible();
    else if (body.status === "unsupported") await expect(page.getByText(/^아직 지원하지 않는 규칙이에요:/)).toBeVisible();
    if (body.status !== "clarify") test.info().annotations.push({ type: "확인 필요", description: `"${text}" 기대 clarify, 실제 ${body.status}` });
    await deleteAllPending(page);
  }
  ruleCount = total + fairLeft.length;
  await expect(page.locator("article")).toHaveCount(ruleCount);
});

test("S9. ② 예외 입력과 ③ 근무표 만들기", async () => {
  // S9-a. 이번 근무표 예외 입력: ② 아래에 접혀 있다가 펼친다
  await expect(page.getByRole("textbox", { name: REQUEST_INPUT })).toHaveCount(0);
  await page.getByRole("button", { name: "+ 이번 근무표에만 적용할 예외 추가" }).click();
  await expect(page.getByRole("textbox", { name: REQUEST_INPUT })).toBeVisible();

  const lee = await employeeId(page, "이영희");
  const kim = await employeeId(page, "김철수");
  const q1 = await interpretOk(page, REQUEST_INPUT, "요청 만들기", "이영희 11월 3~5일 휴가");
  expect(q1.map(leaveOf)).toEqual([{ employee_id: lee, days: [2, 3, 4] }]);
  expect(q1[0].hardness ?? "hard").toBe("hard");
  const leaveCard = pendingCards(page).filter({ hasText: "이영희 · 11/3~11/5 · 휴무" });
  await expect(leaveCard.getByRole("heading", { name: "휴가" })).toBeVisible();
  await expectCardChrome(leaveCard, null);

  const q2 = await interpretOk(page, REQUEST_INPUT, "요청 만들기", "김철수는 주말에 쉬고 싶대요");
  expect(q2.map((c) => ruleShape(c)?.kind)).toEqual(["count"]);
  const p = ruleShape(q2[0]);
  if (p?.kind === "count") {
    expect({ ids: p.people.ids, hardness: q2[0].hardness }).toEqual({ ids: [kim], hardness: "soft" });
    // 같은 뜻의 두 모양: 휴무를 대상 날짜 수만큼(in O, min) 또는 근무를 0번(not_in O, max 0)
    const offWish = (p.shifts.in?.join() === "O" && !!p.min) || (p.shifts.not_in?.join() === "O" && p.max?.n === 0);
    expect(offWish, `휴무 희망 모양: ${JSON.stringify(q2[0])}`).toBe(true);
  }
  const prefCard = pendingCards(page).filter({ hasText: "희망·기피 근무" });
  await expect(prefCard).toContainText("김철수 ·");
  await expect(prefCard).toContainText("휴무 희망");
  await expectCardChrome(prefCard, "가능하면");
  await expectNoDevTerms(page, "② 예외 입력(적용 대기)");

  await applyAllPending(page);

  const q3 = await interpret(page, REQUEST_INPUT, "요청 만들기", "홍길동 5일 휴가");
  if (q3.status === "ok" && q3.constraints.length > 0) {
    const orphan = pendingCards(page).filter({ hasText: "(명단에 없는 직원)" });
    await expect(orphan.first().getByText("명단에 없는 직원을 가리켜요.")).toBeVisible();
  } else {
    test.info().annotations.push({ type: "확인 필요", description: `"홍길동 5일 휴가" → ${q3.status}` });
  }
  await deleteAllPending(page);
  // 되묻기면 입력이 남아 [요청 만들기]가 눌리는 상태로 있다
  await page.getByRole("textbox", { name: REQUEST_INPUT }).fill("");

  // S9-b. 근무표 만들기: ③에는 예외 입력이 없다
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(currentStep()).toContainText("근무표");
  await expect(scheduleTitle(page)).toBeVisible();
  await expect(workStepper().getByRole("button", { name: /가능 시간/ })).toBeEnabled();
  await expect(workStepper().getByRole("button", { name: /매장 조건/ })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: REQUEST_INPUT })).toHaveCount(0);
  // 만들기 전 요약 한 줄: 제출 수와 반드시·가능하면 규칙 수(필요 인원·요청 포함)
  await expect(page.getByRole("main")).toContainText(/제출 12\/12명 · 반드시 \d+개 · 가능하면 \d+개/);
  await expect(primaryButtons(page)).toHaveText("근무표 만들기");
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("ok");
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expect(page.getByText("희망 반영", { exact: true })).toBeVisible();
  await expect(page.getByText("못 지킨 가능하면 규칙", { exact: true })).toBeVisible();
  await expect(page.getByText("칸을 누르면 바꿀 수 있어요.")).toBeVisible();
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("확정");
  await expect(page.getByRole("button", { name: "다시 만들기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "CSV 받기" })).toBeVisible();

  // 개인별 통계는 접혀 있다가 버튼으로 펼친다
  await expect(page.getByRole("heading", { name: "개인별 통계", exact: true })).toHaveCount(0);
  await openStats(page);
  const stats = sectionWith("개인별 통계");
  await expect(stats.locator("tbody tr")).toHaveCount(EMPLOYEE_COUNT);
  for (const h of ["A", "M", "C", "O", "근무 시간", "주말·공휴일 근무", "최대 연속 근무", "희망 반영률", "평균보다 많은 근무일"]) {
    await expect(stats.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
  }
  // 첫 근무표: 최근 4주 기록이 없어 열과 근거 한 줄을 그리지 않는다
  expect(lastSolve!.history ?? null).toBeNull();
  await expect(page.getByText(/최근 4주/)).toHaveCount(0);

  await expectHardRulesHold(page, WEEK, lastSolve);
  await expectParkAvailability();
  const stored = (await readState(page)).shop.rules;
  expect((lastSolve!.constraints ?? []).some((c) => c.id.startsWith("avail-")), "요청에 가능 시간 규칙").toBe(true);
  expect(stored.some((r) => r.id.startsWith("avail-")), "저장된 매장 조건에는 없음").toBe(false);
  expect((await readGrid(page, WEEK))["이영희"].slice(1, 4)).toEqual(["O", "O", "O"]);
  await expectNoDevTerms(page, "③ 근무표");

  // 가능 시간이 바뀌면 다시 들어왔을 때 배너가 뜬다
  const oh = (await linkRows(WEEK.start_date)).find((r) => r.employee_name === "오민준")!;
  const slots = fullDaySlots(WEEK);
  slots["2026-11-02"] = [["09:00", "23:30"]];
  expect((await submitAvailability(oh.token, slots)).error).toBeNull();
  await expectSaved(page);
  await page.reload();
  await expect(scheduleTitle(page)).toBeVisible();
  const changed = page.getByRole("status").filter({ hasText: "가능 시간이 바뀌었어요. 다시 만들어 주세요" });
  await expect(changed).toBeVisible();
  await expect(page.getByRole("button", { name: "확정", exact: true }), "다시 만들기 전에는 확정할 수 없다").toBeDisabled();
  await expect(page.getByText("입력이 바뀌었어요. 다시 만들어 주세요"), "새로고침만으로 입력 변경 배너가 뜨지 않는다").toHaveCount(0);
  expect(await solve(() => changed.getByRole("button", { name: "다시 만들기" }).click())).toBe("ok");
  await expect(changed).toHaveCount(0);
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
});

/** 박민수는 칠한 칸이 근무조를 완전히 덮는 칸에만 배정된다. 칸 고정한 날은 뺀다. */
async function expectParkAvailability(fixedDays: number[] = []) {
  const row = (await readGrid(page, WEEK))["박민수"];
  [1, 3, 5, 6, 7].forEach((d) => {
    if (!fixedDays.includes(d)) expect(row[d - 1], `박민수 ${d}번째 날`).toBe("O");
  });
  expect(["M", "C", "O"]).toContain(row[1]); // 11/3
  expect(["M", "O"]).toContain(row[3]); // 11/5
}

test("S10. 근무표 없음 → 설명과 검증된 제안", async () => {
  const explains: { proposals?: { changes: { constraint_id: string }[] }[] }[] = [];
  const onResponse = async (r: { url: () => string; json: () => Promise<unknown> }) => {
    if (r.url().includes("/api/py/explain")) explains.push((await r.json()) as (typeof explains)[number]);
  };
  page.on("response", onResponse);

  // 예외는 ②에서 적는다. 요청이 있어 예외 패널이 펼쳐져 있다
  await workStepper().getByRole("button", { name: /매장 조건/ }).click();
  await expect(page.getByRole("textbox", { name: REQUEST_INPUT })).toBeVisible();
  for (const text of ["이영희, 김철수, 정유진, 최지훈 11월 6일 휴가", "강서연, 임하늘, 한소율 11월 6일 휴가"]) {
    const cards = await interpretOk(page, REQUEST_INPUT, "요청 만들기", text);
    // 사람마다 한 장이어도, 여러 사람을 한 장에 묶어도 휴가 모양이면 된다
    expect(cards.every((c) => leavesOf(c).length > 0), `${text} → 휴가 카드`).toBe(true);
    await applyAllPending(page);
  }
  const requests = (await periodByStart(page, WEEK.start_date)).requests;
  const off = new Set(requests.flatMap((c) => leavesOf(c).flatMap((l) => (l.days.includes(5) ? [l.employee_id] : []))));
  expect(off.size, "11/6 휴가 인원").toBe(7);
  const lee = await employeeId(page, "이영희");
  const leeLeave = (list: ConstraintSpec[]) => list.find((c) => leaveOf(c)?.employee_id === lee && leaveOf(c)!.days.includes(2));
  expect(leaveOf(leeLeave(requests)!), "S9의 이영희 11/3~11/5 휴가").toEqual({ employee_id: lee, days: [2, 3, 4] });
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(currentStep()).toContainText("근무표");

  const stale = page.getByRole("status").filter({ hasText: "입력이 바뀌었어요. 다시 만들어 주세요" });
  await expect(stale).toBeVisible();
  // 지금 조건으로 만든 근무표가 아니면 확정하지 않는다
  const confirmButton = page.getByRole("button", { name: "확정", exact: true });
  await expect(confirmButton).toBeDisabled();
  await expect(page.getByText("지금 조건으로 만든 근무표만 확정할 수 있어요")).toBeVisible();
  expect(await solve(() => stale.getByRole("button", { name: "다시 만들기" }).click())).toBe("infeasible");
  const panel = page.locator("section").filter({ hasText: "이 조건으로는 근무표를 만들 수 없어요" });
  await expect(panel.getByText("근무표 없음", { exact: true })).toBeVisible();
  await expect(confirmButton).toBeDisabled();
  await expect(panel.getByRole("heading", { name: "함께 지킬 수 없는 규칙" })).toBeVisible();
  const explanation = panel.locator("p.whitespace-pre-line");
  await expect(explanation).not.toBeEmpty();
  test.info().annotations.push({ type: "충돌 설명", description: await explanation.innerText() });

  // 가능 시간은 규칙 목록과 따로 이름만 보여 주고, 끄는 버튼이 없다
  const availBlock = panel.locator("div").filter({ has: page.getByRole("heading", { name: "가능 시간도 함께 걸려 있어요" }) }).last();
  test.info().annotations.push({ type: "가능 시간 행", description: (await availBlock.count()) > 0 ? await availBlock.innerText() : "없음" });
  await expect(availBlock.getByRole("button")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "이번 근무표에서만 끄기" }).first()).toBeVisible();

  // 제안은 가능 시간을 바꾸지 않는다
  await expect.poll(() => explains.length, { message: "/explain 응답" }).toBeGreaterThan(0);
  const touched = (explains.at(-1)?.proposals ?? []).flatMap((p) => p.changes.map((c) => c.constraint_id));
  expect(touched.filter((id) => id.startsWith("avail-")), "가능 시간을 바꾸는 제안 없음").toEqual([]);

  const proposals = panel.locator("article").filter({ hasText: "검증됨" });
  if ((await proposals.count()) > 0) {
    const first = proposals.first();
    await expect(first).toContainText(/이렇게 바꾸면 근무표를 만들 수 있어요 · 희망 반영 \d+\/\d+/);
    await expect(first).toContainText(/\S+ → \S+|이번 근무표에서만 끄기/);
    await expect(first).toContainText("이번 근무표에만 적용돼요. 매장 조건은 그대로예요");
    await expect(first).not.toContainText("가능 시간");
    test.info().annotations.push({ type: "S10 분기", description: `8-a 제안 수락: ${await first.innerText()}` });
    expect(await solve(() => first.getByRole("button", { name: "수락" }).click())).toBe("ok");
  } else {
    test.info().annotations.push({ type: "S10 분기", description: "8-b 이번 근무표에서만 끄기" });
    let offCount = 0;
    for (let tries = 0; ; tries++) {
      expect(tries, "이번 근무표에서만 끄기 반복").toBeLessThan(8);
      const rows = panel.locator("li").filter({ has: page.getByRole("button", { name: "이번 근무표에서만 끄기" }) });
      const leaveRow = rows.filter({ hasText: "11/6" });
      const row = (await leaveRow.count()) > 0 ? leaveRow.first() : rows.first();
      offCount++;
      if ((await solve(() => row.getByRole("button", { name: "이번 근무표에서만 끄기" }).click())) === "ok") break;
    }
    // 요약 지표: 결과 배지 옆 "끈 규칙 n개"와 "이번 근무표에서 끈 규칙" 칸
    await expect(page.getByText(`끈 규칙 ${offCount}개`, { exact: true })).toBeVisible();
    await expect(page.getByText("이번 근무표에서 끈 규칙", { exact: true })).toBeVisible();
    expect((await periodByStart(page, WEEK.start_date)).disabledIds, "이번 근무표에서 끈 규칙").toHaveLength(offCount);
  }
  page.off("response", onResponse);

  await expect(page.getByText("이 조건으로는 근무표를 만들 수 없어요")).toHaveCount(0);
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expect(confirmButton).toBeEnabled();
  await expectHardRulesHold(page, WEEK, lastSolve);
  expect(leeLeave(lastSolve!.constraints ?? [])?.enabled, "이영희 휴가가 켜져 있음").not.toBe(false);
  expect((await readGrid(page, WEEK))["이영희"].slice(1, 4)).toEqual(["O", "O", "O"]);
});

test("S11. 칸 고정 후 다시 만들기", async () => {
  const grid = await readGrid(page, WEEK);
  const row = grid["김철수"];
  // 11/2부터, 인원이 빠듯한 11/6(5번째 날)을 빼고 근무가 있는 첫 날을 O로 고정한다
  const day = [1, 2, 3, 4, 6, 7].find((d) => row[d - 1] !== "O");
  expect(day, "고정할 날").toBeDefined();
  const dom = day! + 1;
  fixedCell = { day: day!, code: "O" };

  await page.getByRole("button", { name: `김철수 11월 ${dom}일 ${row[day! - 1]}` }).click();
  await expect(page.getByText(`김철수 11/${dom}`)).toBeVisible();
  // 조사는 코드 읽는 소리를 따른다(M으로, A·C·O로)
  for (const code of ["A", "M", "C", "O"]) await expect(page.getByRole("button", { name: new RegExp(`^${code}(으)?로 고정$`) })).toBeVisible();
  await expect(page.getByRole("button", { name: "취소" })).toBeVisible();

  expect(await solve(() => page.getByRole("button", { name: "O로 고정" }).click())).toBe("ok");
  const cell = page.getByRole("button", { name: `김철수 11월 ${dom}일 O` });
  await expect(cell.locator("svg")).toHaveCount(1);
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expectHardRulesHold(page, WEEK, lastSolve);

  const afterFix = await readGrid(page, WEEK);
  await page.getByRole("button", { name: `한소율 11월 5일 ${afterFix["한소율"][3]}` }).click();
  await expect(page.getByRole("button", { name: "A로 고정" })).toBeVisible();
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByRole("button", { name: "A로 고정" })).toHaveCount(0);
  expect(await readGrid(page, WEEK)).toEqual(afterFix);

  // 칸 고정이 가능 시간보다 우선한다: 박민수는 11/4에 칠한 칸이 없다
  await page.getByRole("button", { name: `박민수 11월 4일 ${afterFix["박민수"][2]}` }).click();
  expect(await solve(() => page.getByRole("button", { name: "A로 고정" }).click())).toBe("ok");
  await expect(page.getByRole("button", { name: "박민수 11월 4일 A" }).locator("svg")).toHaveCount(1);
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  const park = await employeeId(page, "박민수");
  const parkA = (lastSolve!.constraints ?? []).find((c) => c.id === `avail-${park}-A`);
  const forbidden = parkA?.type === "rule" && parkA.body.kind === "require" ? parkA.body.for_each.days?.days : null;
  expect(forbidden, "박민수 A 금지 규칙").toBeTruthy();
  expect(forbidden, "고정한 11/4는 금지하지 않음").not.toContain(3);
  await expectHardRulesHold(page, WEEK, lastSolve);
  await expectParkAvailability([3]);
  expect((await readGrid(page, WEEK))["김철수"][day! - 1]).toBe("O");
});

test("S12. 확정 → 확정 근무표 → 직원 링크 잠김", async ({ browser }) => {
  await confirmSchedule(page);
  await expect(page.getByRole("button", { name: "CSV 받기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "확정", exact: true })).toHaveCount(0);
  await expect(workStepper()).toHaveCount(0);
  await expect(page.getByRole("button", { name: "이전" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 }).locator("..").getByText("확정", { exact: true })).toBeVisible();
  await expect(page.getByText(/마지막 확정/)).toBeVisible();
  await expect(page.getByText(/직원 링크는 잠겼어요\. 직원은 같은 링크에서 근무표를 봐요/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "변경 입력" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "변경 입력" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 확정" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "변경 취소" })).toHaveCount(0);
  const cell = page.getByRole("button", { name: `김철수 11월 ${fixedCell.day + 1}일 ${fixedCell.code}` });
  await expect(cell.locator("svg")).toHaveCount(1);
  finalGrid = await readGrid(page, WEEK);
  expect((await periodByStart(page, WEEK.start_date)).versions).toHaveLength(1);
  await expectNoDevTerms(page, "확정 근무표");
  // 확정 저장(디바운스 1초)이 홈으로 옮기기 전에 끝나야 한다. 화면 이동만으로는 저장하지 않으므로(store),
  // 먼저 옮기면 서버 문서의 화면이 홈이 되어 S13이 확정 근무표를 열어도 저장된 상태와 달라진다
  await expectSaved(page);

  await page.getByRole("button", { name: "← 근무표 목록" }).click();
  await expect(page.getByText("운영 중", { exact: true })).toHaveCount(0);
  // 필요 인원은 세지 않는다. 시간대 필요 인원(R4)도 LLM이 필요 인원 모양으로 세우면 빠진다
  const conditions = (await readState(page)).shop.rules.filter((r) => presetName(r) !== "필요 인원").length;
  await expect(page.getByRole("main")).toContainText(`직원 12명 · 매장 조건 ${conditions}개 · 1주 단위`);
  const task = sectionWith(WEEK_NAME);
  await expect(task).toContainText("확정했어요 · 10/28 09:00");
  await expect(task.getByRole("button", { name: "열기" })).toHaveClass(/bg-white/);
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("11/9~11/15 근무표 만들기");
  await expect(page.getByText("확정한 근무표가 여기에 쌓여요.")).toBeVisible();
  await expectNoDevTerms(page, "매장 홈(확정 후)");

  const rows = await linkRows(WEEK.start_date);
  expect(rows.every((r) => r.locked_at), "링크 12행 잠김").toBe(true);

  // 잠긴 직원 화면: 이름을 고르면 가능 시간 입력 대신 확정 근무표를 본다
  const staff = await openFlow(browser, { width: 1280, height: 800 });
  await staff.page.goto(shareLink);
  await expect(staff.page.getByText("확정된 근무표예요. 내 이름을 고르면 근무표를 볼 수 있어요")).toBeVisible();
  await expect(staff.page.getByText("제출함", { exact: true })).toHaveCount(0);
  await expectNoDevTerms(staff.page, "잠긴 직원 화면(이름 고르기)");
  await staff.page.getByRole("button", { name: "박민수", exact: true }).click();
  await expect(staff.page.getByRole("heading", { level: 1 })).toHaveText("한강 카페 · 박민수님의 근무표");
  await expect(staff.page.getByRole("button", { name: "이어서 고치기" })).toHaveCount(0);
  await expect(staff.page.getByRole("button", { name: "제출" })).toHaveCount(0);
  await expect(staff.page.getByRole("button", { name: /^\d+월 \d+일 \d{2}:\d{2}~\d{2}:\d{2}$/ })).toHaveCount(0);
  const mine = staff.page.locator("section").filter({ has: staff.page.getByRole("heading", { name: "내 근무", exact: true }) });
  const whole = staff.page.locator("section").filter({ has: staff.page.getByRole("heading", { name: "전체 근무표", exact: true }) });
  await expect(mine).toBeVisible();
  await expect(whole).toBeVisible();
  // 칸 코드가 매니저가 확정한 근무표와 같다. 직원 id는 응답과 화면에 없다
  const confirmed = await confirmedGrid(page, WEEK.start_date);
  expect(await readCells(mine, WEEK), "내 근무").toEqual({ 박민수: confirmed["박민수"] });
  expect(await readCells(whole, WEEK), "전체 근무표").toEqual(confirmed);
  await expectNoDevTerms(staff.page, "잠긴 직원 화면(확정 근무표)");
  await expectNoProblems(staff.page, staff.problems);
  await staff.context.close();

  const park = rows.find((r) => r.employee_name === "박민수")!;
  const { error } = await submitAvailability(park.token, fullDaySlots(WEEK));
  expect(error?.code, "잠긴 링크 제출 거부").toBe("P0001");
  expect((await linkRows(WEEK.start_date)).find((r) => r.employee_name === "박민수")!.slots).toEqual(park.slots);
});

test("S13. 저장과 다시 들어오기", async () => {
  await sectionWith(WEEK_NAME).getByRole("button", { name: "열기" }).click();
  await expect(page.getByRole("heading", { name: "변경 입력" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expectSaved(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(WEEK_NAME);
  await expect(page.getByRole("heading", { name: "변경 입력" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toHaveCount(0);
  await expect(page.getByText("입력이 바뀌었어요. 다시 만들어 주세요")).toHaveCount(0);
  expect(await readGrid(page, WEEK)).toEqual(finalGrid);
  const saved = (await savedDoc())!.state.periods.find((p) => p.start_date === WEEK.start_date)!;
  expect(saved.holidays).toEqual([HOLIDAY]);
  const lee = await employeeId(page, "이영희");
  expect(saved.requests.some((c) => leaveOf(c)?.employee_id === lee && leaveOf(c)!.days.join() === "2,3,4")).toBe(true);

  await page.getByRole("button", { name: "매장 설정", exact: true }).click();
  await expect(page.getByRole("button", { name: "첫 근무표 시작하기" })).toHaveCount(0);
  await page.getByRole("tab", { name: "매장 조건" }).click();
  await expect(appliedCards(page)).toHaveCount(ruleCount + COVERAGE.length);
  const first = page.locator("article").first();
  await expect(first.getByText("기본", { exact: true })).toBeVisible();
  await expect(first.getByRole("button", { name: "삭제" })).toHaveCount(0);
  const weekdayOpen = page
    .locator("article")
    .filter({ has: page.getByText("기본", { exact: true }) })
    .filter({ hasText: /평일.*오픈/ })
    .first();
  await weekdayOpen.getByRole("button", { name: "매장 조건에서 끄기" }).click();
  await expect(weekdayOpen.getByText("매장 조건에서 꺼짐", { exact: true })).toBeVisible();
  await weekdayOpen.getByRole("button", { name: "다시 켜기" }).click();
  await expect(weekdayOpen.getByText("적용됨", { exact: true })).toBeVisible();
});

test("S19. 아무도 제출하지 않은 근무표 → 미제출 안내", async () => {
  const NEXT: PeriodRange = { start_date: "2026-11-09", length: 7 };
  let explains = 0;
  const onRequest = (r: { url: () => string }) => {
    if (r.url().includes("/api/py/explain")) explains++;
  };
  page.on("request", onRequest);

  await page.getByRole("button", { name: "근무표", exact: true }).click();
  await primaryButtons(page).filter({ hasText: "11/9~11/15 근무표 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11/9~11/15 근무표");
  await expect.poll(async () => (await linkRows(NEXT.start_date)).length, { message: "링크 행" }).toBe(EMPLOYEE_COUNT);
  expect((await linkRows(NEXT.start_date)).some((r) => r.submitted_at), "아무도 제출하지 않음").toBe(false);
  await expect(page.getByText(`${EMPLOYEE_COUNT}명 중 0명 제출`)).toBeVisible();

  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(scheduleTitle(page)).toBeVisible();
  await expect(page.getByRole("main")).toContainText(`제출 0/${EMPLOYEE_COUNT}명`);
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("infeasible");

  // 원인이 미제출이면 안내와 [① 가능 시간으로]만 보이고, 설명을 부르지 않는다
  const panel = page.locator("section").filter({ hasText: "이 조건으로는 근무표를 만들 수 없어요" });
  await expect(panel.getByText("근무표 없음", { exact: true })).toBeVisible();
  await expect(panel).toContainText("아직 가능 시간을 제출한 직원이 없어요. ①에서 링크를 보내고 제출을 기다려 주세요");
  await expect(panel.getByRole("button")).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "① 가능 시간으로" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "이번 근무표에서만 끄기" })).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: "함께 지킬 수 없는 규칙" })).toHaveCount(0);
  await expect(panel.getByText("왜 만들 수 없나요?")).toHaveCount(0);
  await expect(page.getByText("원인을 분석하는 중…")).toHaveCount(0);
  expect(explains, "/explain 요청 없음").toBe(0);
  await expect(page.getByRole("button", { name: "확정", exact: true })).toHaveCount(0);
  await expectNoDevTerms(page, "③ 근무표(미제출 안내)");
  page.off("request", onRequest);

  await panel.getByRole("button", { name: "① 가능 시간으로" }).click();
  await expect(currentStep()).toContainText("가능 시간");
  await expect(page.getByRole("button", { name: "링크 복사" })).toHaveCount(1);
});
