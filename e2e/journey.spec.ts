// docs/BROWSER_TEST_SCENARIOS.md S3~S11. 앞 시나리오의 상태를 이어받는 하나의 흐름이라 페이지 하나를 공유하며 순서대로 돈다.
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";

import type { ConstraintSpec, Nurse, Period, TranslateResponse } from "../lib/types.gen";

type Code = "D" | "E" | "N" | "O";
type Grid = Record<string, Code[]>;
type StoredState = { nurses: Nurse[]; constraints: ConstraintSpec[]; holidays: number[]; period: Period };

const YEAR = 2026;
const MONTH = 11;
const DAYS = 30;
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
const WEEKEND_DAYS = [1, 7, 8, 14, 15, 21, 22, 28, 29, HOLIDAY];

// --- 공통 도우미 ---

const pendingCards = (page: Page) => page.locator("article").filter({ hasText: "적용 대기" });
const solveButton = (page: Page) => page.getByRole("button", { name: "생성", exact: true });

async function readState(page: Page): Promise<StoredState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("nurse-scheduler")!).state);
}

async function nurseId(page: Page, name: string): Promise<string> {
  const n = (await readState(page)).nurses.find((x) => x.name === name);
  expect(n, `명단에 ${name}`).toBeTruthy();
  return n!.id;
}

/** 근무 칸 버튼의 aria-label("{이름} 11월 {일}일 {코드}")로 근무표를 읽는다. */
async function readGrid(page: Page): Promise<Grid> {
  return page.evaluate((month) => {
    const re = new RegExp(`^(.+) ${month}월 (\\d+)일 ([DENO])$`);
    const grid: Record<string, string[]> = {};
    for (const b of document.querySelectorAll("button[aria-label]")) {
      const m = re.exec(b.getAttribute("aria-label") ?? "");
      if (m) (grid[m[1]] ??= [])[Number(m[2]) - 1] = m[3];
    }
    return grid as Grid;
  }, MONTH);
}

const cellCount = (grid: Grid) => Object.values(grid).reduce((sum, row) => sum + row.filter(Boolean).length, 0);

/** 저장된 hard 제약(꺼진 것 제외)과 나이트 전담을 근무표에 대어 위반을 모은다. 솔버와 따로 구현한 검사다. */
function hardViolations(state: StoredState, grid: Grid): string[] {
  const out: string[] = [];
  const { nurses, constraints, holidays, period } = state;
  const days = new Date(period.year, period.month, 0).getDate();
  const isWeekend = (d: number) => {
    const w = new Date(period.year, period.month - 1, d).getDay();
    return w === 0 || w === 6 || holidays.includes(d);
  };
  const rows = new Map<string, Code[]>();
  for (const n of nurses) {
    const row = grid[n.name];
    if (!row || row.length !== days || row.some((c) => !c)) {
      out.push(`${n.name}: 근무표 행이 없거나 ${days}칸이 아님`);
      continue;
    }
    rows.set(n.id, row);
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
        for (const [id, r] of rows)
          for (let d = 1; d < days; d++)
            if (r[d - 1] === c.params.first && r[d] === c.params.second) out.push(`${tag}: ${name(id)} ${d}~${d + 1}일`);
        break;
      case "max_consecutive_nights":
        for (const [id, r] of rows) if (runs(r, (x) => x === "N") > c.params.days) out.push(`${tag}: ${name(id)}`);
        break;
      case "max_consecutive_work":
        for (const [id, r] of rows) if (runs(r, (x) => x !== "O") > c.params.days) out.push(`${tag}: ${name(id)}`);
        break;
      case "min_days_off":
        for (const [id, r] of rows) if (r.filter((x) => x === "O").length < c.params.days) out.push(`${tag}: ${name(id)}`);
        break;
      case "off_after_night_block":
        for (const [id, r] of rows)
          for (let d = 1; d < days; d++) {
            if (r[d - 1] !== "N" || r[d] === "N") continue;
            for (let k = 1; k <= c.params.days && d + k <= days; k++)
              if (r[d + k - 1] !== "O") out.push(`${tag}: ${name(id)} ${d}일 N 뒤 ${d + k}일 ${r[d + k - 1]}`);
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

async function expectHardRulesHold(page: Page) {
  const [state, grid] = await Promise.all([readState(page), readGrid(page)]);
  expect(cellCount(grid), "근무 칸 수").toBe(NURSE_COUNT * DAYS);
  expect(hardViolations(state, grid), "hard 규칙 위반").toEqual([]);
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
  const body = (await res.json()) as { status: string };
  await expect(solveButton(page)).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByText("원인을 분석하는 중…")).toHaveCount(0);
  return body;
}

/** 대기 카드를 모두 [적용]한다. ④에서는 적용마다 재풀이가 돌므로 onSchedule이면 끝까지 기다린다. */
async function applyAllPending(page: Page, onSchedule = false) {
  for (let guard = 0; (await pendingCards(page).count()) > 0; guard++) {
    expect(guard, "대기 카드 적용 반복").toBeLessThan(20);
    const apply = pendingCards(page).first().getByRole("button", { name: "적용" });
    if (onSchedule) await solveVia(page, () => apply.click());
    else await apply.click();
  }
}

async function expectCardChrome(card: Locator, hard: "hard" | "soft") {
  await expect(card.getByText("적용 대기")).toBeVisible();
  await expect(card.getByRole("button", { name: "삭제" })).toBeVisible();
  await expect(card.getByRole("button", { name: "적용" })).toBeVisible();
  await expect(card.getByRole("group", { name: "hard/soft" }).getByRole("button", { name: hard })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

// --- 시나리오 ---

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let problems: string[] = [];
let confirmedGrid: Grid;
let fixedCell: { day: number; code: Code };
let finalGrid: Grid;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul", viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
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
  // 오류 토스트([다시 시도]가 있는 alert). Next 개발 서버의 route announcer도 role=alert라 구분한다
  await expect(page.getByRole("alert").filter({ hasText: "다시 시도" })).toHaveCount(0);
  expect(problems, "콘솔 오류·API 실패").toEqual([]);
});

test("S3. ① 병동 준비", async () => {
  await page.goto("/app");
  await page.getByRole("button", { name: "새로 시작" }).click();
  await expect(page.getByRole("heading", { name: "병동 준비" })).toBeVisible();

  await page.locator('input[type="month"]').fill(`${YEAR}-${MONTH}`);
  await expect(page.getByRole("banner")).toContainText(`${YEAR}년 ${MONTH}월`);
  const next = page.getByRole("button", { name: "다음" });
  await expect(next).toBeDisabled();

  await page.getByLabel("엑셀에서 복사한 명단 붙여넣기 (이름, 연차, 나이트 전담)").fill(ROSTER);
  await page.getByRole("button", { name: "변환" }).click();
  await expect(page.getByRole("combobox", { name: "이름 열" })).toHaveValue("0");
  await expect(page.getByRole("combobox", { name: "연차 열" })).toHaveValue("1");
  await expect(page.getByRole("combobox", { name: "나이트 전담 열" })).toHaveValue("2");
  await expect(page.getByRole("banner")).toContainText(`로테이션 ${NURSE_COUNT}명`);
  await expect(page.getByRole("textbox", { name: "15행 3열", exact: true })).toHaveValue("Y"); // 문가람
  await expect(page.getByRole("textbox", { name: "16행 3열", exact: true })).toHaveValue("Y"); // 배수아

  const leeYears = page.getByRole("textbox", { name: "2행 2열", exact: true });
  await leeYears.fill("abc");
  await expect(leeYears).toHaveAttribute("aria-invalid", "true");
  await expect(next).toBeDisabled();
  await leeYears.fill("12");
  await expect(leeYears).not.toHaveAttribute("aria-invalid", "true");

  for (const [kind, shift, min, max] of COVERAGE) {
    await page.getByRole("textbox", { name: `${kind} ${shift} 최소` }).fill(String(min));
    await page.getByRole("textbox", { name: `${kind} ${shift} 최대` }).fill(String(max));
  }
  const weekdayDayMin = page.getByRole("textbox", { name: "평일 데이 최소" });
  await weekdayDayMin.fill("5");
  await expect(page.getByText("최소 인원이 최대 인원보다 많아요.")).toBeVisible();
  await expect(next).toBeDisabled();
  await weekdayDayMin.fill("3");
  await expect(page.getByText("최소 인원이 최대 인원보다 많아요.")).toHaveCount(0);

  await page.getByRole("button", { name: `${MONTH}월 ${HOLIDAY}일 공휴일 지정` }).click();
  await expect(page.getByRole("button", { name: `${MONTH}월 ${HOLIDAY}일 공휴일 해제` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  page.once("dialog", (d) => void d.dismiss());
  await page.getByRole("button", { name: "샘플 병동 불러오기" }).click();
  await expect(page.getByRole("banner")).toContainText(`로테이션 ${NURSE_COUNT}명`);
  await expect(page.getByRole("textbox", { name: "2행 1열", exact: true })).toHaveValue("이영희");

  const state = await readState(page);
  expect(state.period).toEqual({ year: YEAR, month: MONTH });
  expect(state.holidays).toEqual([HOLIDAY]);
  expect(state.nurses.filter((n) => n.night_only).map((n) => n.name)).toEqual(["문가람", "배수아"]);
  expect(state.constraints.filter((c) => c.type === "daily_coverage")).toHaveLength(6);

  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByRole("heading", { name: "병동 규칙" })).toBeVisible();
});

test("S4. ② 병동 규칙", async () => {
  const input = "병동 규칙 입력";

  // S4-a. 규칙 3개
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

  const total = r1.length + r2.length + r3.length;
  await expect(pendingCards(page)).toHaveCount(total);
  for (const card of await pendingCards(page).all()) await expectCardChrome(card, "hard");
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
    while ((await pendingCards(page).count()) > 0) await pendingCards(page).first().getByRole("button", { name: "삭제" }).click();
  }
  await expect(page.locator("article")).toHaveCount(total);

  // S4-d
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "이달 요청" })).toBeVisible();
});

test("S5. ③ 이달 요청", async () => {
  const input = "이달 요청 입력";
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
    const weekendOnly = pref.params.weekends_only === true || (pref.params.days ?? []).every((d) => WEEKEND_DAYS.includes(d));
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
  while ((await pendingCards(page).count()) > 0) await pendingCards(page).first().getByRole("button", { name: "삭제" }).click();

  await expect(page.getByRole("heading", { name: "전월 마지막 주 근무 (선택)" })).toBeVisible();
  await expect(page.getByText(/지금 반영된 간호사:\s*0명/)).toBeVisible();
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "근무표", level: 1 })).toBeVisible();
});

test("S6. ④ 생성", async () => {
  await expect(page.getByText("[생성]을 누르면 지금까지 적용한 규칙과 요청으로 근무표를 만들어요.")).toBeVisible();
  const res = await solveVia(page, () => solveButton(page).click());
  expect(res.status).toBe("ok");

  await expect(page.getByText("해 있음", { exact: true })).toBeVisible();
  await expect(page.getByText("희망 반영", { exact: true })).toBeVisible();
  await expect(page.getByText("soft 위반", { exact: true })).toBeVisible();

  const stats = page.locator("section").filter({ has: page.getByRole("heading", { name: "개인별 통계" }) });
  await expect(stats.locator("tbody tr")).toHaveCount(NURSE_COUNT);
  for (const h of ["D", "E", "N", "O", "주말·공휴일 근무", "최대 연속 근무", "희망 반영률", "평균 대비 편차"]) {
    await expect(stats.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
  }

  await expectHardRulesHold(page);
  const grid = await readGrid(page);
  expect(grid["이영희"].slice(14, 17)).toEqual(["O", "O", "O"]);
});

test("S7. 해 없음 → 설명과 검증된 제안", async () => {
  await page.getByRole("button", { name: "이전" }).click();
  await expect(page.getByRole("heading", { name: "이달 요청" })).toBeVisible();
  for (const text of ["이영희, 박민수, 김철수, 정유진 20일 휴가", "최지훈, 강서연, 윤지민, 임하늘 20일 휴가"]) {
    const cards = await interpretOk(page, "이달 요청 입력", text);
    expect(cards.every((c) => c.type === "leave"), `${text} → 휴가 카드`).toBe(true);
    await applyAllPending(page);
  }
  const state = await readState(page);
  const offOn20 = new Set(
    state.constraints.flatMap((c) => (c.type === "leave" && c.params.days.includes(20) ? [c.params.nurse_id] : [])),
  );
  expect(offOn20.size, "11/20 휴가 인원").toBe(8);
  const lee = await nurseId(page, "이영희");
  const leeLeave15 = (st: StoredState) =>
    st.constraints.find((c) => c.type === "leave" && c.params.nurse_id === lee && c.params.days.includes(15));
  expect(leeLeave15(state)?.params, "S5의 이영희 15~17일 휴가가 남아 있음").toEqual({ nurse_id: lee, days: [15, 16, 17] });

  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("status").filter({ hasText: "입력이 바뀌었어요. 다시 생성하세요" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 생성" })).toBeVisible();

  const res = await solveVia(page, () => solveButton(page).click());
  expect(res.status).toBe("infeasible");
  const panel = page.locator("section").filter({ hasText: "지금 규칙으로는 근무표를 만들 수 없어요" });
  await expect(panel.getByText("해 없음", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "충돌하는 규칙" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "이번 달만 끄기" }).first()).toBeVisible();
  const explanation = panel.locator("p.whitespace-pre-line");
  await expect(explanation).not.toBeEmpty();
  test.info().annotations.push({ type: "충돌 설명", description: await explanation.innerText() });

  const proposals = panel.locator("article").filter({ hasText: "검증됨" });
  if ((await proposals.count()) > 0) {
    const first = proposals.first();
    await expect(first).toContainText(/재풀이 결과 · 해 있음 · 희망 반영 \d+\/\d+/);
    test.info().annotations.push({ type: "S7 분기", description: `10-a 제안 수락: ${await first.innerText()}` });
    const after = await solveVia(page, () => first.getByRole("button", { name: "수락" }).click());
    expect(after.status).toBe("ok");
  } else {
    test.info().annotations.push({ type: "S7 분기", description: "10-b 이번 달만 끄기" });
    for (let tries = 0; ; tries++) {
      expect(tries, "이번 달만 끄기 반복").toBeLessThan(8);
      const rows = panel.locator("li").filter({ has: page.getByRole("button", { name: "이번 달만 끄기" }) });
      const leaveRow = rows.filter({ hasText: "20일" });
      const row = (await leaveRow.count()) > 0 ? leaveRow.first() : rows.first();
      const after = await solveVia(page, () => row.getByRole("button", { name: "이번 달만 끄기" }).click());
      if (after.status === "ok") break;
    }
  }

  await expect(page.getByText("지금 규칙으로는 근무표를 만들 수 없어요")).toHaveCount(0);
  await expect(page.getByText("해 있음", { exact: true })).toBeVisible();
  await expectHardRulesHold(page);
  expect(leeLeave15(await readState(page))?.enabled, "이영희 15~17일 휴가가 켜져 있음").not.toBe(false);
  expect((await readGrid(page))["이영희"].slice(14, 17)).toEqual(["O", "O", "O"]);
});

test("S8. 칸 고정 후 재풀이", async () => {
  const grid = await readGrid(page);
  const row = grid["김철수"];
  // 11/10부터, 근무가 있고 전날이 N이 아닌 날을 O로 고정한다(나이트 규칙과 부딪히지 않게)
  const day = Array.from({ length: DAYS - 9 }, (_, i) => i + 10).find((d) => row[d - 1] !== "O" && row[d - 2] !== "N");
  expect(day, "고정할 날").toBeDefined();
  fixedCell = { day: day!, code: "O" };
  const before = row[day! - 1];

  await page.getByRole("button", { name: `김철수 ${MONTH}월 ${day}일 ${before}` }).click();
  await expect(page.getByText(`김철수 ${MONTH}/${day}`)).toBeVisible();
  for (const code of ["D", "E", "N", "O"]) await expect(page.getByRole("button", { name: `${code}로 고정` })).toBeVisible();

  const res = await solveVia(page, () => page.getByRole("button", { name: "O로 고정" }).click());
  expect(res.status).toBe("ok");
  const cell = page.getByRole("button", { name: `김철수 ${MONTH}월 ${day}일 O` });
  await expect(cell.locator("svg")).toHaveCount(1);
  await expect(page.getByText("해 있음", { exact: true })).toBeVisible();
  await expectHardRulesHold(page);

  const afterFix = await readGrid(page);
  const other = afterFix["한소율"][4];
  await page.getByRole("button", { name: `한소율 ${MONTH}월 5일 ${other}` }).click();
  await expect(page.getByRole("button", { name: "D로 고정" })).toBeVisible();
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByRole("button", { name: "D로 고정" })).toHaveCount(0);
  expect(await readGrid(page)).toEqual(afterFix);
});

test("S9. 확정", async () => {
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "확정됨" })).toBeDisabled();
  await expect(page.locator("section").getByText("확정됨", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "월중 변경" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "월중 변경 입력" })).toBeVisible();
  const cell = page.getByRole("button", { name: `김철수 ${MONTH}월 ${fixedCell.day}일 ${fixedCell.code}` });
  await expect(cell.locator("svg")).toHaveCount(1);
  confirmedGrid = await readGrid(page);
});

test("S10. 월중 변경 → 최소 변경 재스케줄", async () => {
  const choi = await nurseId(page, "최지훈");
  const cards = await interpretOk(page, "월중 변경 입력", "최지훈 11월 9일부터 13일까지 병가");
  const sick = cards.filter((c) => c.type === "leave" && c.params.nurse_id === choi);
  expect(sick, "최지훈 병가 카드").toHaveLength(1);
  if (sick[0].type === "leave") expect(sick[0].params.days).toEqual([9, 10, 11, 12, 13]);

  await applyAllPending(page, true);
  await expect(page.getByText("해 있음", { exact: true })).toBeVisible();
  await expect(page.getByText("초안", { exact: true })).toBeVisible();
  const choiLeaves = (await readState(page)).constraints.filter((c) => c.type === "leave" && c.params.nurse_id === choi);
  expect(
    choiLeaves.some((c) => c.type === "leave" && c.params.days.includes(20)),
    "S7의 최지훈 20일 휴가가 남아 있음",
  ).toBe(true);
  await expect(page.getByText(/^\d+칸$/)).toBeVisible(); // 이전 대비 변경

  const banner = page.getByRole("status").filter({ hasText: "확정본 대비" });
  await expect(banner).toContainText("주황 테두리 칸이 바뀐 곳이에요.");
  const m = /확정본 대비\s*(\d+)\s*명,\s*(\d+)\s*칸 변경/.exec(await banner.innerText());
  expect(m, "변경 요약 문구").toBeTruthy();
  const [changedNurses, changedCells] = [Number(m![1]), Number(m![2])];

  finalGrid = await readGrid(page);
  expect(finalGrid["최지훈"].slice(8, 13)).toEqual(["O", "O", "O", "O", "O"]);
  expect(finalGrid["김철수"][fixedCell.day - 1]).toBe(fixedCell.code);

  const diff: { name: string; day: number }[] = [];
  for (const [name, row] of Object.entries(finalGrid))
    row.forEach((c, i) => {
      if (confirmedGrid[name][i] !== c) diff.push({ name, day: i + 1 });
    });
  test.info().annotations.push({ type: "월중 변경 diff", description: JSON.stringify(diff) });
  expect(diff.length).toBe(changedCells);
  expect(new Set(diff.map((d) => d.name)).size).toBe(changedNurses);
  expect(diff.length, "최소 변경(전체의 10% 이하)").toBeLessThanOrEqual((NURSE_COUNT * DAYS) / 10);

  const highlighted = await page.evaluate((month) => {
    const re = new RegExp(`^(.+) ${month}월 (\\d+)일 [DENO]$`);
    return [...document.querySelectorAll("button[aria-label]")]
      .filter((b) => re.test(b.getAttribute("aria-label") ?? "") && b.className.includes("inset_0_0_0_2px"))
      .map((b) => {
        const [, name, day] = re.exec(b.getAttribute("aria-label")!)!;
        return { name, day: Number(day) };
      });
  }, MONTH);
  const key = (c: { name: string; day: number }) => `${c.name}-${c.day}`;
  expect(highlighted.map(key).sort(), "하이라이트 칸 = 바뀐 칸").toEqual(diff.map(key).sort());

  await expectHardRulesHold(page);
});

test("S11. 저장과 이어서 하기", async () => {
  await page.reload();
  await expect(page.getByText(`근무표 단계 · 명단 ${NURSE_COUNT}명`)).toBeVisible();
  await page.getByRole("button", { name: "이어서 하기" }).click();
  await expect(page.getByRole("heading", { name: "근무표", level: 1 })).toBeVisible();
  await expect(page.getByText("초안", { exact: true })).toBeVisible();
  expect(await readGrid(page)).toEqual(finalGrid);

  await page.getByRole("button", { name: "병동", exact: true }).click();
  await expect(page.getByRole("banner")).toContainText(`로테이션 ${NURSE_COUNT}명`);
  await expect(page.getByRole("button", { name: `${MONTH}월 ${HOLIDAY}일 공휴일 해제` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "병동 규칙" })).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "적용됨" }).first()).toBeVisible();
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "이달 요청" })).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "적용됨" }).filter({ hasText: "이영희 ·" }).first()).toBeVisible();
});
