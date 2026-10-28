// docs/BROWSER_TEST_SCENARIOS.md S3~S13. 앞 시나리오의 상태를 이어받는 하나의 흐름이라 페이지 하나를 공유하며 순서대로 돈다.
// 게스트 모드만 다룬다(ADR-014). LLM은 mock하지 않는다(ADR-013).
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";

import { isWeekendDay, type PeriodRange, periodDays } from "../lib/period";
import type { Ward, WorkPeriod } from "../lib/store";
import type { ConstraintSpec, HistoryLoad, ScheduleRequest, TranslateResponse } from "../lib/types.gen";

type Code = "D" | "E" | "N" | "O";
type Grid = Record<string, Code[]>;
type StoredState = { ward: Ward; periods: WorkPeriod[]; view: { screen: string; periodId?: string } };

const T0 = new Date("2026-10-28T09:00:00+09:00");
const T1 = new Date("2026-11-09T09:00:00+09:00");
const NOV: PeriodRange = { start_date: "2026-11-01", length: 30 };
const DEC: PeriodRange = { start_date: "2026-12-01", length: 31 };
const NOV_TITLE = "2026.11.1 – 11.30";
const DEC_TITLE = "2026.12.1 – 12.31";
const ROSTER = `이름\t연차\t나이트전담
이영희\t12
박민수\t9
김철수\t7
정유진\t5
최지훈\t3
강서연\t15
윤지민\t10
임하늘\t8
한소율\t6
오민준\t4
서예린\t2
신도윤\t1
조은비\t2
문가람\t11\tY
배수아\t4\tY`;
const NURSE_COUNT = 15;
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
const CARRY_OVER_DAYS = 7;
const HISTORY_FROM = 3; // 12/1 직전 28일 = 11/3~11/30

// --- 공통 도우미 ---

const pendingCards = (page: Page) => page.locator("article").filter({ hasText: "적용 대기" });
const solveButton = (page: Page) => page.getByRole("button", { name: "생성", exact: true });
const scheduleTitle = (page: Page) => page.getByRole("heading", { name: "근무표", exact: true }).first();

async function readState(page: Page): Promise<StoredState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("nurse-scheduler")!).state);
}

async function nurseId(page: Page, name: string): Promise<string> {
  const n = (await readState(page)).ward.nurses.find((x) => x.name === name);
  expect(n, `명단에 ${name}`).toBeTruthy();
  return n!.id;
}

async function periodByStart(page: Page, start: string): Promise<WorkPeriod> {
  const p = (await readState(page)).periods.find((x) => x.start_date === start);
  expect(p, `${start} 기간`).toBeTruthy();
  return p!;
}

/** 근무 칸 버튼의 aria-label("{이름} {M}월 {D}일 {코드}")로 기간의 근무표를 읽는다. */
async function readGrid(page: Page, period: PeriodRange): Promise<Grid> {
  const index = Object.fromEntries(periodDays(period).map((d) => [`${d.month}-${d.dom}`, d.day]));
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label") ?? ""),
  );
  const grid: Grid = {};
  for (const label of labels) {
    const m = /^(.+) (\d+)월 (\d+)일 ([DENO])$/.exec(label);
    const day = m && index[`${m[2]}-${m[3]}`];
    if (m && day) (grid[m[1]] ??= [])[day - 1] = m[4] as Code;
  }
  return grid;
}

const cellCount = (grid: Grid) => Object.values(grid).reduce((sum, row) => sum + row.filter(Boolean).length, 0);

/**
 * 마지막 /solve 요청의 hard 제약(꺼진 것 제외)과 나이트 전담을 근무표에 대어 위반을 모은다. 솔버와 따로 구현한 검사다.
 * 순서·연속 규칙은 이월 근무를 앞에 붙여 기간 경계도 본다.
 */
function hardViolations(req: ScheduleRequest, grid: Grid): string[] {
  const out: string[] = [];
  const { nurses, period, holidays = [], constraints = [], carry_over = [] } = req;
  const days = period.length;
  const isWeekend = (d: number) => isWeekendDay(period, d, holidays);
  const rows = new Map<string, Code[]>();
  const extended = new Map<string, { row: Code[]; offset: number }>();
  for (const n of nurses) {
    const row = grid[n.name];
    if (!row || row.length !== days || row.some((c) => !c)) {
      out.push(`${n.name}: 근무표 행이 없거나 ${days}칸이 아님`);
      continue;
    }
    rows.set(n.id, row);
    const carry = (carry_over.find((r) => r.nurse_id === n.id)?.shifts ?? []) as Code[];
    extended.set(n.id, { row: [...carry, ...row], offset: carry.length });
    if (n.night_only && row.some((c) => c === "D" || c === "E")) out.push(`${n.name}: 나이트 전담인데 D/E 배정`);
  }
  const name = (id: string) => nurses.find((n) => n.id === id)?.name ?? id;
  const runs = (row: Code[], inRun: (c: Code) => boolean) => {
    let best = 0;
    let cur = 0;
    for (const c of row) {
      cur = inRun(c) ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
    return best;
  };

  for (const c of constraints) {
    if (c.enabled === false || (c.hardness ?? "hard") !== "hard") continue;
    const tag = `${c.type} "${c.source_text}"`;
    switch (c.type) {
      case "daily_coverage":
        for (let d = 1; d <= days; d++) {
          if (isWeekend(d) !== (c.params.day_kind === "weekend")) continue;
          const count = [...rows.values()].filter((r) => r[d - 1] === c.params.shift).length;
          if (count < c.params.min || count > c.params.max) out.push(`${tag}: ${d}일 ${c.params.shift} ${count}명`);
        }
        break;
      case "forbidden_sequence":
        for (const [id, { row: r, offset }] of extended)
          for (let i = Math.max(0, offset - 1); i + 1 < r.length; i++)
            if (r[i] === c.params.first && r[i + 1] === c.params.second)
              out.push(`${tag}: ${name(id)} ${i - offset + 1}~${i - offset + 2}일`);
        break;
      case "max_consecutive_nights":
        for (const [id, { row }] of extended) if (runs(row, (x) => x === "N") > c.params.days) out.push(`${tag}: ${name(id)}`);
        break;
      case "max_consecutive_work":
        for (const [id, { row }] of extended) if (runs(row, (x) => x !== "O") > c.params.days) out.push(`${tag}: ${name(id)}`);
        break;
      case "min_days_off":
        for (const [id, r] of rows) if (r.filter((x) => x === "O").length < c.params.days) out.push(`${tag}: ${name(id)}`);
        break;
      case "off_after_night_block":
        for (const [id, { row: r, offset }] of extended)
          for (let i = 0; i + 1 < r.length; i++) {
            if (r[i] !== "N" || r[i + 1] === "N") continue;
            for (let k = 1; k <= c.params.days && i + k < r.length; k++)
              if (i + k >= offset && r[i + k] !== "O")
                out.push(`${tag}: ${name(id)} ${i - offset + 1}일 N 뒤 ${i + k - offset + 1}일 ${r[i + k]}`);
          }
        break;
      case "skill_mix": {
        const seniors = nurses.filter((n) => n.years >= c.params.min_years).map((n) => n.id);
        for (let d = 1; d <= days; d++) {
          const count = seniors.filter((id) => rows.get(id)?.[d - 1] === c.params.shift).length;
          if (count < c.params.min_count) out.push(`${tag}: ${d}일 ${c.params.shift} ${count}명`);
        }
        break;
      }
      case "leave":
        for (const d of c.params.days)
          if (rows.get(c.params.nurse_id)?.[d - 1] !== "O") out.push(`${tag}: ${name(c.params.nurse_id)} ${d}일`);
        break;
      case "fixed_assignment":
        if (rows.get(c.params.nurse_id)?.[c.params.day - 1] !== c.params.shift)
          out.push(`${tag}: ${name(c.params.nurse_id)} ${c.params.day}일`);
        break;
    }
  }
  return out;
}

async function expectHardRulesHold(page: Page, period: PeriodRange) {
  const grid = await readGrid(page, period);
  expect(cellCount(grid), "근무 칸 수").toBe(NURSE_COUNT * period.length);
  expect(lastSolve, "마지막 /solve 요청").toBeTruthy();
  expect(lastSolve.period).toEqual(period);
  expect(hardViolations(lastSolve, grid), "hard 규칙 위반").toEqual([]);
}

/** 입력칸에 말을 넣고 [해석]한 뒤 응답을 돌려준다. */
async function interpret(page: Page, inputName: string, text: string): Promise<TranslateResponse> {
  await page.getByRole("textbox", { name: inputName }).fill(text);
  const response = page.waitForResponse((r) => r.url().includes("/api/py/translate"), { timeout: 60_000 });
  await page.getByRole("button", { name: "해석", exact: true }).click();
  const res = await response;
  expect(res.ok(), `translate ${res.status()}`).toBe(true);
  const body = (await res.json()) as TranslateResponse;
  await expect(page.getByRole("button", { name: "해석 중…" })).toHaveCount(0);
  test.info().annotations.push({ type: "LLM 해석", description: `${text} → ${JSON.stringify(body)}` });
  return body;
}

async function interpretOk(page: Page, inputName: string, text: string): Promise<ConstraintSpec[]> {
  const body = await interpret(page, inputName, text);
  expect(body.status, `"${text}" 해석 상태`).toBe("ok");
  return body.status === "ok" ? body.constraints : [];
}

/** action이 일으킨 /solve(와 이어지는 /explain)가 끝나 [생성]이 다시 눌릴 때까지 기다린다. */
async function solveVia(page: Page, action: () => Promise<void>): Promise<{ status: string }> {
  const response = page.waitForResponse((r) => r.url().includes("/api/py/solve"), { timeout: 60_000 });
  await action();
  const res = await response;
  expect(res.ok(), `solve ${res.status()}`).toBe(true);
  lastSolve = res.request().postDataJSON() as ScheduleRequest;
  const body = (await res.json()) as { status: string };
  await expect(solveButton(page)).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByText("원인을 분석하는 중…")).toHaveCount(0);
  return body;
}

/** 대기 카드를 모두 [적용]한다. ③ 운영 중 변경에서는 적용마다 재풀이가 돌므로 onSchedule이면 끝까지 기다린다. */
async function applyAllPending(page: Page, onSchedule = false) {
  for (let guard = 0; (await pendingCards(page).count()) > 0; guard++) {
    expect(guard, "대기 카드 적용 반복").toBeLessThan(20);
    const apply = pendingCards(page).first().getByRole("button", { name: "적용" });
    if (onSchedule) await solveVia(page, () => apply.click());
    else await apply.click();
  }
}

async function deleteAllPending(page: Page) {
  while ((await pendingCards(page).count()) > 0) await pendingCards(page).first().getByRole("button", { name: "삭제" }).click();
}

async function expectCardChrome(card: Locator, hardness: "hard" | "soft") {
  await expect(card.getByText("적용 대기")).toBeVisible();
  await expect(card.getByRole("button", { name: "삭제" })).toBeVisible();
  await expect(card.getByRole("button", { name: "적용" })).toBeVisible();
  await expect(card.getByRole("group", { name: "hard/soft" }).getByRole("button", { name: hardness })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

// --- 시나리오 ---

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let problems: string[] = [];
let lastSolve: ScheduleRequest;
let ruleCount: number;
let fixedCell: { day: number; code: Code };
let confirmedGrid: Grid;
let finalNovGrid: Grid;
let decGrid: Grid;

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

test("S3. 병동 설정: 기본·명단·필요 인원", async () => {
  await page.goto("/app");
  await page.getByRole("button", { name: "내 병동으로 시작하기" }).click();
  await expect(page.getByRole("heading", { name: "병동 설정", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "명단·필요 인원" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("textbox", { name: "병동 이름" }).fill("내과 병동");
  await expect(page.getByRole("banner")).toContainText("내과 병동 · 달력 월");
  const unit = page.getByRole("combobox", { name: "기간 단위" });
  await unit.selectOption({ label: "2주" });
  await expect(page.getByRole("status").filter({ hasText: "다음에 만드는 기간부터 적용돼요." })).toContainText(
    "최소 오프 일수 같은 규칙 값을 다시 확인하세요.",
  );
  await unit.selectOption({ label: "달력 월" });
  await expect(page.getByRole("banner")).toContainText("내과 병동 · 달력 월");

  const createFirst = page.getByRole("button", { name: "첫 기간 만들기" });
  await expect(createFirst).toBeDisabled();
  await expect(page.getByText("명단과 필요 인원을 입력하면 첫 기간을 만들 수 있어요.")).toBeVisible();

  await page.getByLabel("엑셀에서 복사한 명단 붙여넣기 (이름, 연차, 나이트 전담)").fill(ROSTER);
  await page.getByRole("button", { name: "변환" }).click();
  await expect(page.getByRole("combobox", { name: "이름 열" })).toHaveValue("0");
  await expect(page.getByRole("combobox", { name: "연차 열" })).toHaveValue("1");
  await expect(page.getByRole("combobox", { name: "나이트 전담 열" })).toHaveValue("2");
  await expect(page.getByRole("textbox", { name: "15행 3열", exact: true })).toHaveValue("Y"); // 문가람
  await expect(page.getByRole("textbox", { name: "16행 3열", exact: true })).toHaveValue("Y"); // 배수아

  const leeYears = page.getByRole("textbox", { name: "2행 2열", exact: true });
  const applyRoster = page.getByRole("button", { name: "명단에 반영" });
  await leeYears.fill("abc");
  await expect(leeYears).toHaveAttribute("aria-invalid", "true");
  await expect(applyRoster).toBeDisabled();
  await leeYears.fill("12");
  await expect(leeYears).not.toHaveAttribute("aria-invalid", "true");
  await applyRoster.click();

  await expect(page.getByRole("textbox", { name: "1행 이름", exact: true })).toHaveValue("이영희");
  await expect(page.getByRole("textbox", { name: "15행 이름", exact: true })).toHaveValue("배수아");
  await expect(page.getByRole("checkbox", { name: "14행 나이트 전담" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "15행 나이트 전담" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "13행 나이트 전담" })).not.toBeChecked();

  for (const [kind, shift, min, max] of COVERAGE) {
    await page.getByRole("textbox", { name: `${kind} ${shift} 최소` }).fill(String(min));
    await page.getByRole("textbox", { name: `${kind} ${shift} 최대` }).fill(String(max));
  }
  const weekdayDayMin = page.getByRole("textbox", { name: "평일 데이 최소" });
  await weekdayDayMin.fill("5");
  await expect(page.getByText("최소 인원이 최대 인원보다 많아요.")).toBeVisible();
  await weekdayDayMin.fill("3");
  await expect(page.getByText("최소 인원이 최대 인원보다 많아요.")).toHaveCount(0);

  const idsBefore = (await readState(page)).ward.nurses.map((n) => n.id);
  const baeRow = page.getByRole("row").filter({ has: page.getByRole("textbox", { name: "15행 이름", exact: true }) });
  await baeRow.getByRole("button", { name: "비활성으로" }).click();
  await expect(page.getByRole("textbox", { name: "15행 이름", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "비활성 1명 보기" }).click();
  const inactiveRow = page.getByRole("row").filter({ hasText: "배수아" });
  await expect(inactiveRow.getByText("비활성", { exact: true })).toBeVisible();
  await inactiveRow.getByRole("button", { name: "다시 활성으로" }).click();
  await expect(page.getByRole("textbox", { name: "15행 이름", exact: true })).toHaveValue("배수아");

  const { ward } = await readState(page);
  expect(ward.name).toBe("내과 병동");
  expect(ward.unit).toBe("month");
  expect(ward.nurses.map((n) => n.id), "간호사 id 유지").toEqual(idsBefore);
  expect(ward.nurses.filter((n) => n.active)).toHaveLength(NURSE_COUNT);
  expect(ward.nurses.filter((n) => n.night_only).map((n) => n.name)).toEqual(["문가람", "배수아"]);
  expect(ward.rules.filter((c) => c.type === "daily_coverage")).toHaveLength(6);
  await expect(createFirst).toBeEnabled();
});

test("S4. 병동 설정: 병동 규칙", async () => {
  await page.getByRole("tab", { name: "병동 규칙" }).click();
  const input = "병동 규칙 입력";

  // S4-a. 규칙 해석
  const r1 = await interpretOk(page, input, "나이트 다음 날은 무조건 쉬게");
  expect(r1.length).toBeGreaterThan(0);
  for (const c of r1) {
    expect(["off_after_night_block", "forbidden_sequence"]).toContain(c.type);
    if (c.type === "forbidden_sequence") {
      expect(c.params.first).toBe("N");
      expect(["D", "E"]).toContain(c.params.second);
    }
  }
  const r2 = await interpretOk(page, input, "나이트는 3일 넘게 연속으로 하지 않게");
  expect(r2.map((c) => c.type)).toEqual(["max_consecutive_nights"]);
  expect(r2[0].params).toEqual({ days: 3 });
  const r3 = await interpretOk(page, input, "근무조마다 3년차 이상 한 명은 꼭 있어야 해");
  expect(r3.length).toBeGreaterThan(0);
  for (const c of r3) {
    expect(c.type).toBe("skill_mix");
    if (c.type === "skill_mix") expect({ min_years: c.params.min_years, min_count: c.params.min_count }).toEqual({ min_years: 3, min_count: 1 });
  }
  const shifts = r3.flatMap((c) => (c.type === "skill_mix" ? [c.params.shift] : []));
  expect([...shifts].sort(), "숙련도 믹스가 D/E/N을 모두 덮는다").toEqual(["D", "E", "N"]);
  const r4 = await interpretOk(page, input, "나이트는 다 같이 공평하게 나눠 줘");
  expect(r4.map((c) => c.type)).toEqual(["night_fairness"]);

  const total = r1.length + r2.length + r3.length + r4.length;
  await expect(pendingCards(page)).toHaveCount(total);
  for (const card of await pendingCards(page).all()) {
    const fairness = (await card.getByRole("heading").innerText()) === "나이트 공정성";
    await expectCardChrome(card, fairness ? "soft" : "hard");
  }
  await expect(page.getByText(`적용하지 않은 카드 ${total}개는 근무표에 반영되지 않아요.`)).toBeVisible();

  const r2Card = page.locator("article").filter({ hasText: "최대 연속 나이트" });
  const toggle = r2Card.getByRole("group", { name: "hard/soft" });
  await toggle.getByRole("button", { name: "soft" }).click();
  await expect(toggle.getByRole("button", { name: "soft" })).toHaveAttribute("aria-pressed", "true");
  await toggle.getByRole("button", { name: "hard" }).click();
  await expect(toggle.getByRole("button", { name: "hard" })).toHaveAttribute("aria-pressed", "true");

  await applyAllPending(page);
  await expect(page.locator("article").filter({ hasText: "적용됨" })).toHaveCount(total);
  await expect(page.getByText(/적용하지 않은 카드/)).toHaveCount(0);

  // S4-b. 적용된 카드 수정
  for (const days of ["4", "3"]) {
    await r2Card.getByRole("button", { name: "수정" }).click();
    await r2Card.getByLabel("일수").fill(days);
    await r2Card.getByRole("button", { name: "저장" }).click();
    await expect(r2Card).toContainText(`연속 N ≤ ${days}일`);
  }

  // S4-c. 되묻기와 미지원. LLM 판단이 달라도 실패로 보지 않고 기록한 뒤 생긴 카드를 지운다.
  const cases = [
    { text: "주말은 적당히", expected: "clarify" },
    { text: "사이 안 좋은 간호사끼리는 같은 날 근무 안 넣게", expected: "unsupported" },
  ] as const;
  for (const { text, expected } of cases) {
    const body = await interpret(page, input, text);
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

  // S4-d. 병동 홈
  const homeTab = page.getByRole("button", { name: "홈", exact: true });
  await homeTab.click();
  await expect(homeTab).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "내과 병동", level: 1 })).toBeVisible();
  await expect(page.getByText("아직 만든 기간이 없어요.")).toBeVisible();
  await expect(page.getByText("아직 확정한 기간이 없어요.")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("활성 15명");
  await expect(page.getByRole("main")).toContainText(`병동 규칙 ${ruleCount}개`);
});

test("S5. 첫 기간 ① 준비", async () => {
  await page.getByRole("button", { name: "첫 기간 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOV_TITLE);
  await expect(page.getByText("초안", { exact: true })).toBeVisible();
  const stepper = page.getByRole("list", { name: "기간 작업 단계" });
  await expect(stepper.locator('[aria-current="step"]')).toContainText("준비");
  await expect(stepper.getByRole("button", { name: /요청/ })).toBeDisabled();
  await expect(stepper.getByRole("button", { name: /근무표/ })).toBeDisabled();

  await expect(page.getByRole("heading", { name: "준비", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(`${NOV_TITLE} · 30일`);
  await expect(page.getByText("2026년 11월")).toBeVisible();
  await expect(page.getByRole("button", { name: /^\d+월 \d+일 공휴일 (지정|해제)$/ })).toHaveCount(30);

  await page.getByRole("button", { name: `11월 ${HOLIDAY}일 공휴일 지정` }).click();
  await expect(page.getByRole("button", { name: `11월 ${HOLIDAY}일 공휴일 해제` })).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByRole("main")).toContainText(`명단 활성 ${NURSE_COUNT}명`);
  await expect(page.getByText("지난 기간과 명단이 같아요")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "이월 근무 (선택)" })).toBeVisible();
  await expect(page.getByText(/지금 반영된 간호사:\s*0명/)).toBeVisible();

  const p = await periodByStart(page, NOV.start_date);
  expect({ start_date: p.start_date, length: p.length }).toEqual(NOV);
  expect(p.holidays).toEqual([HOLIDAY]);

  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "요청", exact: true })).toBeVisible();
  await expect(stepper.getByRole("button", { name: "준비", exact: true })).toBeEnabled();
});

test("S6. ② 요청", async () => {
  const input = "요청 입력";
  const lee = await nurseId(page, "이영희");
  const park = await nurseId(page, "박민수");

  const q1 = await interpretOk(page, input, "이영희 11월 15~17일 휴가");
  expect(q1.map((c) => c.type)).toEqual(["leave"]);
  expect(q1[0].params).toEqual({ nurse_id: lee, days: [15, 16, 17] });
  const leaveCard = pendingCards(page).filter({ hasText: "이영희 ·" });
  await expectCardChrome(leaveCard, "hard");
  const leaveToggle = leaveCard.getByRole("group", { name: "hard/soft" });
  await expect(leaveToggle).toHaveAttribute("title", "휴가와 고정 배정은 항상 hard예요");
  await expect(leaveToggle.getByRole("button", { name: "hard" })).toBeDisabled();
  await expect(leaveToggle.getByRole("button", { name: "soft" })).toBeDisabled();

  const q2 = await interpretOk(page, input, "박민수는 주말에 쉬고 싶대요");
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
  await expectCardChrome(pendingCards(page).filter({ hasText: "희망/기피 근무" }), "soft");

  await applyAllPending(page);

  const q3 = await interpret(page, input, "홍길동 20일 휴가");
  if (q3.status === "ok" && q3.constraints.length > 0) {
    const orphan = pendingCards(page).filter({ hasText: "홍길동" });
    await expect(orphan.first().getByText("명단에 없는 간호사를 가리켜요.")).toBeVisible();
  } else {
    test.info().annotations.push({ type: "확인 필요", description: `"홍길동 20일 휴가" → ${q3.status}` });
  }
  await deleteAllPending(page);

  await expect(page.getByRole("heading", { name: "이 기간에 적용될 병동 규칙" })).toBeVisible();
  await page.getByRole("button", { name: "병동 규칙 보기" }).click();
  await expect(page.getByRole("button", { name: "이번 기간만 끄기" }).first()).toBeVisible();
  await page.getByRole("button", { name: "접기" }).click();

  await page.getByRole("button", { name: "다음" }).click();
  await expect(scheduleTitle(page)).toBeVisible();
});

test("S7. ③ 생성", async () => {
  await expect(page.getByText("[생성]을 누르면 지금까지 적용한 규칙과 요청으로 근무표를 만들어요.")).toBeVisible();
  const res = await solveVia(page, () => solveButton(page).click());
  expect(res.status).toBe("ok");

  await expect(page.getByText("해 있음", { exact: true })).toBeVisible();
  await expect(page.getByText("희망 반영", { exact: true })).toBeVisible();
  await expect(page.getByText("soft 위반", { exact: true })).toBeVisible();
  await expect(page.getByText("4주 N", { exact: true })).toBeVisible();
  await expect(page.getByText("4주 주말", { exact: true })).toBeVisible();

  const stats = page.locator("section").filter({ has: page.getByRole("heading", { name: "개인별 통계" }) });
  await expect(stats.locator("tbody tr")).toHaveCount(NURSE_COUNT);
  for (const h of ["D", "E", "N", "O", "주말·공휴일 근무", "최대 연속 근무", "희망 반영률", "평균 대비 편차", "최근 4주 N", "최근 4주 주말"]) {
    await expect(stats.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
  }
  // 첫 기간: 지난 확정본이 없어 누적 부담이 모두 0이고 근거 한 줄이 없다
  expect(lastSolve.history_load ?? []).toEqual([]);
  expect(Object.values(await readHistoryColumns(page)).every((v) => v.nights === 0 && v.weekends === 0)).toBe(true);
  await expect(page.getByText(/지난 4주 나이트|최근 4주 나이트가 많았던/)).toHaveCount(0);

  await expectHardRulesHold(page, NOV);
  const grid = await readGrid(page, NOV);
  expect(grid["이영희"].slice(14, 17)).toEqual(["O", "O", "O"]);
});

test("S8. 해 없음 → 설명과 검증된 제안", async () => {
  await page.getByRole("button", { name: "이전" }).click();
  await expect(page.getByRole("heading", { name: "요청", exact: true })).toBeVisible();
  for (const text of ["이영희, 박민수, 김철수, 정유진 20일 휴가", "최지훈, 강서연, 윤지민, 임하늘 20일 휴가"]) {
    const cards = await interpretOk(page, "요청 입력", text);
    expect(cards.every((c) => c.type === "leave"), `${text} → 휴가 카드`).toBe(true);
    await applyAllPending(page);
  }
  const requests = (await periodByStart(page, NOV.start_date)).requests;
  const offOn20 = new Set(requests.flatMap((c) => (c.type === "leave" && c.params.days.includes(20) ? [c.params.nurse_id] : [])));
  expect(offOn20.size, "11/20 휴가 인원").toBe(8);
  const lee = await nurseId(page, "이영희");
  const leeLeave15 = (list: ConstraintSpec[]) =>
    list.find((c) => c.type === "leave" && c.params.nurse_id === lee && c.params.days.includes(15));
  expect(leeLeave15(requests)?.params, "S6의 이영희 15~17일 휴가가 남아 있음").toEqual({ nurse_id: lee, days: [15, 16, 17] });

  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("status").filter({ hasText: "입력이 바뀌었어요. 다시 생성하세요" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 생성" })).toBeVisible();

  const res = await solveVia(page, () => solveButton(page).click());
  expect(res.status).toBe("infeasible");
  const panel = page.locator("section").filter({ hasText: "지금 규칙으로는 근무표를 만들 수 없어요" });
  await expect(panel.getByText("해 없음", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "충돌하는 규칙" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "이번 기간만 끄기" }).first()).toBeVisible();
  const explanation = panel.locator("p.whitespace-pre-line");
  await expect(explanation).not.toBeEmpty();
  test.info().annotations.push({ type: "충돌 설명", description: await explanation.innerText() });

  const proposals = panel.locator("article").filter({ hasText: "검증됨" });
  if ((await proposals.count()) > 0) {
    const first = proposals.first();
    await expect(first).toContainText(/재풀이 결과 · 해 있음 · 희망 반영 \d+\/\d+/);
    test.info().annotations.push({ type: "S8 분기", description: `10-a 제안 수락: ${await first.innerText()}` });
    const after = await solveVia(page, () => first.getByRole("button", { name: "수락" }).click());
    expect(after.status).toBe("ok");
  } else {
    test.info().annotations.push({ type: "S8 분기", description: "10-b 이번 기간만 끄기" });
    for (let tries = 0; ; tries++) {
      expect(tries, "이번 기간만 끄기 반복").toBeLessThan(8);
      const rows = panel.locator("li").filter({ has: page.getByRole("button", { name: "이번 기간만 끄기" }) });
      const leaveRow = rows.filter({ hasText: "11/20" });
      const row = (await leaveRow.count()) > 0 ? leaveRow.first() : rows.first();
      const after = await solveVia(page, () => row.getByRole("button", { name: "이번 기간만 끄기" }).click());
      if (after.status === "ok") break;
    }
  }

  await expect(page.getByText("지금 규칙으로는 근무표를 만들 수 없어요")).toHaveCount(0);
  await expect(page.getByText("해 있음", { exact: true })).toBeVisible();
  await expectHardRulesHold(page, NOV);
  const sent = leeLeave15(lastSolve.constraints ?? []);
  expect(sent?.enabled, "이영희 15~17일 휴가가 켜져 있음").not.toBe(false);
  expect((await readGrid(page, NOV))["이영희"].slice(14, 17)).toEqual(["O", "O", "O"]);
});

test("S9. 칸 고정 후 재풀이", async () => {
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

  const res = await solveVia(page, () => page.getByRole("button", { name: "O로 고정" }).click());
  expect(res.status).toBe("ok");
  const cell = page.getByRole("button", { name: `김철수 11월 ${day}일 O` });
  await expect(cell.locator("svg")).toHaveCount(1);
  await expect(page.getByText("해 있음", { exact: true })).toBeVisible();
  await expectHardRulesHold(page, NOV);

  const afterFix = await readGrid(page, NOV);
  const other = afterFix["한소율"][4];
  await page.getByRole("button", { name: `한소율 11월 5일 ${other}` }).click();
  await expect(page.getByRole("button", { name: "D로 고정" })).toBeVisible();
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByRole("button", { name: "D로 고정" })).toHaveCount(0);
  expect(await readGrid(page, NOV)).toEqual(afterFix);
});

test("S10. 확정", async () => {
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "확정됨" })).toBeDisabled();
  await expect(page.locator("section").getByText("확정됨", { exact: true })).toBeVisible();
  await expect(page.getByText("확정", { exact: true })).toBeVisible(); // 제목 옆 배지
  await expect(page.getByText(/마지막 확정/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "운영 중 변경" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "운영 중 변경 입력" })).toBeVisible();
  const cell = page.getByRole("button", { name: `김철수 11월 ${fixedCell.day}일 ${fixedCell.code}` });
  await expect(cell.locator("svg")).toHaveCount(1);
  confirmedGrid = await readGrid(page, NOV);

  await page.getByRole("button", { name: "← 홈" }).click();
  await expect(page.getByText("운영 중 기간")).toHaveCount(0);
  const next = page.locator("section").filter({ has: page.getByRole("heading", { name: "다음 기간" }) });
  await expect(next).toContainText(NOV_TITLE);
  await expect(next.getByText("확정", { exact: true })).toBeVisible();
  await expect(next.getByRole("button", { name: "열기" })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("S11. 운영 중 변경 → 최소 변경 재스케줄 → 다시 확정", async () => {
  await page.clock.setFixedTime(T1);
  await page.reload();
  await expect(page.getByText(`병동 홈 · 명단 ${NURSE_COUNT}명`)).toBeVisible();
  await page.getByRole("button", { name: "이어서 하기" }).click();

  const operating = page.locator("section").filter({ has: page.getByRole("heading", { name: "운영 중 기간" }) });
  await expect(operating).toContainText(NOV_TITLE);
  await expect(operating.getByText("운영 중", { exact: true })).toBeVisible();
  await expect(operating).toContainText("마지막 확정");
  await expect(page.getByRole("button", { name: "다음 기간 만들기" })).toBeVisible();
  await operating.getByRole("button", { name: "열기" }).click();
  await expect(scheduleTitle(page)).toBeVisible();

  // 지난 날짜(11/1~11/8) 잠금
  const lockState = await page.evaluate(() =>
    [...document.querySelectorAll("button[aria-label]")].flatMap((b) => {
      const m = /^(.+) 11월 (\d+)일 [DENO]$/.exec(b.getAttribute("aria-label") ?? "");
      return m ? [{ day: Number(m[2]), disabled: b.getAttribute("aria-disabled") === "true", lock: b.querySelector("svg") !== null }] : [];
    }),
  );
  const past = lockState.filter((c) => c.day <= 8);
  expect(past).toHaveLength(NURSE_COUNT * 8);
  expect(past.every((c) => c.disabled && c.lock), "지난 날짜는 잠김").toBe(true);
  expect(lockState.filter((c) => c.day === 9).some((c) => c.disabled), "오늘(11/9)은 잠기지 않음").toBe(false);
  await page.getByRole("button", { name: `이영희 11월 3일 ${confirmedGrid["이영희"][2]}` }).click({ force: true });
  await expect(page.getByRole("button", { name: "D로 고정" })).toHaveCount(0);

  const choi = await nurseId(page, "최지훈");
  const cards = await interpretOk(page, "운영 중 변경 입력", "최지훈 11월 9일부터 13일까지 병가");
  const sick = cards.filter((c) => c.type === "leave" && c.params.nurse_id === choi);
  expect(sick, "최지훈 병가 카드").toHaveLength(1);
  if (sick[0].type === "leave") expect(sick[0].params.days).toEqual([9, 10, 11, 12, 13]);

  await applyAllPending(page, true);
  await expect(page.getByText("해 있음", { exact: true })).toBeVisible();
  await expect(page.getByText("초안", { exact: true })).toBeVisible();
  await expect(page.getByText(/^\d+칸$/)).toBeVisible(); // 이전 대비 변경
  const locks = (lastSolve.constraints ?? []).filter((c) => c.id.startsWith("lock-"));
  expect(locks, "지난 날짜 잠금이 요청에 들어감").toHaveLength(NURSE_COUNT * 8);

  const banner = page.getByRole("status").filter({ hasText: "확정본 대비" });
  await expect(banner).toContainText("주황 테두리 칸이 바뀐 곳이에요.");
  const m = /확정본 대비\s*(\d+)\s*명,\s*(\d+)\s*칸 변경/.exec(await banner.innerText());
  expect(m, "변경 요약 문구").toBeTruthy();
  const [changedNurses, changedCells] = [Number(m![1]), Number(m![2])];

  finalNovGrid = await readGrid(page, NOV);
  expect(finalNovGrid["최지훈"].slice(8, 13)).toEqual(["O", "O", "O", "O", "O"]);
  expect(finalNovGrid["김철수"][fixedCell.day - 1]).toBe(fixedCell.code);

  const diff: { name: string; day: number }[] = [];
  for (const [name, row] of Object.entries(finalNovGrid))
    row.forEach((c, i) => {
      if (confirmedGrid[name][i] !== c) diff.push({ name, day: i + 1 });
    });
  test.info().annotations.push({ type: "운영 중 변경 diff", description: JSON.stringify(diff) });
  expect(diff.length).toBe(changedCells);
  expect(new Set(diff.map((d) => d.name)).size).toBe(changedNurses);
  expect(diff.filter((d) => d.day <= 8), "지난 날짜는 바뀌지 않음").toEqual([]);
  expect(diff.length, "최소 변경(전체의 10% 이하)").toBeLessThanOrEqual((NURSE_COUNT * NOV.length) / 10);

  const highlighted = await page.evaluate(() => {
    const re = /^(.+) 11월 (\d+)일 [DENO]$/;
    return [...document.querySelectorAll("button[aria-label]")]
      .filter((b) => re.test(b.getAttribute("aria-label") ?? "") && b.className.includes("inset_0_0_0_2px"))
      .map((b) => {
        const [, name, day] = re.exec(b.getAttribute("aria-label")!)!;
        return { name, day: Number(day) };
      });
  });
  const key = (c: { name: string; day: number }) => `${c.name}-${c.day}`;
  expect(highlighted.map(key).sort(), "하이라이트 칸 = 바뀐 칸").toEqual(diff.map(key).sort());

  await expectHardRulesHold(page, NOV);

  await page.getByRole("button", { name: "다시 확정" }).click();
  await expect(page.getByRole("button", { name: "확정됨" })).toBeDisabled();
  await expect(page.locator("section").getByText("확정됨", { exact: true })).toBeVisible();
  const { versions } = await periodByStart(page, NOV.start_date);
  expect(versions).toHaveLength(2);
  expect(versions[1].changed).toHaveLength(changedCells);
});

/** 근무표 행 끝의 누적 부담 열(4주 N, 4주 주말)과 통계 표의 최근 4주 열을 읽고 서로 같은지 확인한다. */
async function readHistoryColumns(page: Page): Promise<Record<string, { nights: number; weekends: number }>> {
  const { grid, stats } = await page.evaluate(() => {
    const grid: Record<string, [string, string]> = {};
    for (const b of document.querySelectorAll("button[aria-label]")) {
      const m = /^(.+) \d+월 \d+일 [DENO]$/.exec(b.getAttribute("aria-label") ?? "");
      if (!m || grid[m[1]] || !b.parentElement) continue;
      const kids = [...b.parentElement.children];
      grid[m[1]] = [kids.at(-2)!.textContent ?? "", kids.at(-1)!.textContent ?? ""];
    }
    const section = [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent === "개인별 통계");
    const stats: Record<string, [string, string]> = {};
    for (const tr of section?.querySelectorAll("tbody tr") ?? []) {
      const tds = [...tr.querySelectorAll("td")];
      stats[tds[0].textContent ?? ""] = [tds.at(-2)!.textContent ?? "", tds.at(-1)!.textContent ?? ""];
    }
    return { grid, stats };
  });
  expect(stats, "근무표 누적 부담 열 = 통계 최근 4주 열").toEqual(grid);
  return Object.fromEntries(Object.entries(grid).map(([name, [n, w]]) => [name, { nights: Number(n), weekends: Number(w) }]));
}

test("S12. 다음 기간 만들기 → 이월 근무와 누적 부담", async () => {
  await page.getByRole("button", { name: "← 홈" }).click();
  await page.getByRole("button", { name: "다음 기간 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(DEC_TITLE);
  await expect(page.getByText("초안", { exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(`${DEC_TITLE} · 31일`);
  await expect(page.getByText("2026년 12월")).toBeVisible();
  await expect(page.getByText("지난 기간과 명단이 같아요")).toBeVisible();

  await expect(page.getByRole("heading", { name: "이월 근무", exact: true })).toBeVisible();
  await expect(page.getByText(`지난 기간 확정본에서 가져왔어요(${NOV_TITLE})`)).toBeVisible();
  const carryLabels = await page.evaluate(() =>
    [...document.querySelectorAll("div[aria-label]")].map((d) => d.getAttribute("aria-label") ?? ""),
  );
  const carry: Grid = {};
  for (const label of carryLabels) {
    const m = /^(.+) 11\/(\d+) ([DENO])$/.exec(label);
    if (m) (carry[m[1]] ??= [])[Number(m[2]) - (NOV.length - CARRY_OVER_DAYS + 1)] = m[3] as Code;
  }
  expect(cellCount(carry), "이월 근무 칸 수").toBe(NURSE_COUNT * CARRY_OVER_DAYS);
  for (const [name, row] of Object.entries(finalNovGrid)) {
    expect(carry[name], `${name} 이월 근무`).toEqual(row.slice(-CARRY_OVER_DAYS));
  }

  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "요청", exact: true })).toBeVisible();
  await expect(page.getByText("아직 요청이 없어요.")).toBeVisible();
  await page.getByRole("button", { name: "다음" }).click();
  await expect(scheduleTitle(page)).toBeVisible();

  const res = await solveVia(page, () => solveButton(page).click());
  expect(res.status).toBe("ok");
  await expect(page.getByText("해 있음", { exact: true })).toBeVisible();

  // 기대 누적 부담: 확정본 11/3~11/30의 N 수와 주말·공휴일 근무 수
  const { ward } = await readState(page);
  const expected: Record<string, { nights: number; weekends: number }> = {};
  for (const [name, row] of Object.entries(finalNovGrid)) {
    const window = row.map((c, i) => ({ c, day: i + 1 })).filter(({ day }) => day >= HISTORY_FROM);
    expected[name] = {
      nights: window.filter(({ c }) => c === "N").length,
      weekends: window.filter(({ c, day }) => c !== "O" && isWeekendDay(NOV, day, [HOLIDAY])).length,
    };
  }
  const idOf = (name: string) => ward.nurses.find((n) => n.name === name)!.id;
  const byId = (list: HistoryLoad[]) => [...list].sort((a, b) => a.nurse_id.localeCompare(b.nurse_id));
  expect(byId(lastSolve.history_load ?? []), "요청의 history_load").toEqual(
    byId(
      Object.entries(expected)
        .filter(([, v]) => v.nights > 0 || v.weekends > 0)
        .map(([name, v]) => ({ nurse_id: idOf(name), ...v })),
    ),
  );
  const sentCarry = Object.fromEntries((lastSolve.carry_over ?? []).map((r) => [r.nurse_id, r.shifts]));
  expect(sentCarry, "요청의 carry_over").toEqual(
    Object.fromEntries(Object.entries(finalNovGrid).map(([name, row]) => [idOf(name), row.slice(-CARRY_OVER_DAYS)])),
  );

  expect(await readHistoryColumns(page), "누적 부담 열").toEqual(expected);
  const evidence = page.getByText(/지난 4주 나이트 \d+회 → 이번 기간 \d+회|최근 4주 나이트가 많았던 \d+명은 이번 기간 나이트를 줄였어요/);
  await expect(evidence).toBeVisible();
  test.info().annotations.push({ type: "누적 부담 근거", description: await evidence.innerText() });

  await expectHardRulesHold(page, DEC);
  decGrid = await readGrid(page, DEC);
});

test("S13. 저장과 이어서 하기", async () => {
  await page.reload();
  await expect(page.getByText(`기간 작업 · 명단 ${NURSE_COUNT}명`)).toBeVisible();
  await page.getByRole("button", { name: "이어서 하기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(DEC_TITLE);
  await expect(scheduleTitle(page)).toBeVisible();
  expect(await readGrid(page, DEC)).toEqual(decGrid);

  await page.getByRole("button", { name: "홈", exact: true }).click();
  const operating = page.locator("section").filter({ has: page.getByRole("heading", { name: "운영 중 기간" }) });
  await expect(operating).toContainText(NOV_TITLE);
  const next = page.locator("section").filter({ has: page.getByRole("heading", { name: "다음 기간" }) });
  await expect(next).toContainText(DEC_TITLE);
  await expect(next.getByText("초안", { exact: true })).toBeVisible();
  await expect(next.getByRole("button", { name: "이어서 작성" })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(2);

  await page.getByRole("button", { name: NOV_TITLE, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOV_TITLE);
  await expect(scheduleTitle(page)).toBeVisible();
  expect(await readGrid(page, NOV)).toEqual(finalNovGrid);

  const stepper = page.getByRole("list", { name: "기간 작업 단계" });
  await stepper.getByRole("button", { name: "준비", exact: true }).click();
  await expect(page.getByRole("button", { name: `11월 ${HOLIDAY}일 공휴일 해제` })).toHaveAttribute("aria-pressed", "true");
  await stepper.getByRole("button", { name: "요청", exact: true }).click();
  await expect(page.locator("article").filter({ hasText: "적용됨" }).filter({ hasText: "이영희 ·" }).first()).toBeVisible();

  await page.getByRole("button", { name: "병동 설정", exact: true }).click();
  await page.getByRole("tab", { name: "병동 규칙" }).click();
  await expect(page.locator("article").filter({ hasText: "적용됨" })).toHaveCount(ruleCount);
});
