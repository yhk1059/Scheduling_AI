// e2e 공통 도우미. 시나리오는 docs/BROWSER_TEST_SCENARIOS.md. LLM은 mock하지 않는다(ADR-013).
import { expect, type Locator, type Page, test } from "@playwright/test";

import { isWeekendDay, type PeriodRange, periodDays } from "../lib/period";
import type { Ward, WorkPeriod } from "../lib/store";
import type { ConstraintSpec, ScheduleRequest, TranslateResponse } from "../lib/types.gen";

export type Code = "D" | "E" | "N" | "O";
export type Grid = Record<string, Code[]>;
export type Load = { nights: number; weekends: number };
type StoredState = { ward: Ward; periods: WorkPeriod[]; view: { screen: string; periodId?: string } };

export const T0 = new Date("2026-10-28T09:00:00+09:00");
export const NURSE_COUNT = 15;
export const CARRY_OVER_DAYS = 7;

export const pendingCards = (page: Page) => page.locator("article").filter({ hasText: "적용 대기" });
export const appliedCards = (page: Page) => page.locator("article").filter({ hasText: "적용됨" });
export const scheduleTitle = (page: Page) => page.getByRole("heading", { name: "근무표", exact: true }).first();
/** 진행 중이면 비활성이 되는 버튼. 근무표가 없으면 [근무표 만들기], 있으면 [CSV 받기]다. */
const idleButton = (page: Page) => page.getByRole("button", { name: /^(근무표 만들기|CSV 받기)$/ });
/** Primary 버튼(UI_GUIDE: 영역마다 하나). */
export const primaryButtons = (page: Page) => page.locator('main button[class*="bg-[#155E75]"]');

export async function readState(page: Page): Promise<StoredState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("nurse-scheduler")!).state);
}

export async function nurseId(page: Page, name: string): Promise<string> {
  const n = (await readState(page)).ward.nurses.find((x) => x.name === name);
  expect(n, `명단에 ${name}`).toBeTruthy();
  return n!.id;
}

export async function periodByStart(page: Page, start: string): Promise<WorkPeriod> {
  const p = (await readState(page)).periods.find((x) => x.start_date === start);
  expect(p, `${start} 근무표`).toBeTruthy();
  return p!;
}

/** 저장된 근무표의 최신 확정본을 이름 기준 Grid로 바꾼다. */
export async function confirmedGrid(page: Page, start: string): Promise<Grid> {
  const { ward, periods } = await readState(page);
  const assignments = periods.find((x) => x.start_date === start)!.versions.at(-1)!.assignments;
  return Object.fromEntries(ward.nurses.map((n) => [n.name, assignments[n.id] as Code[]]));
}

/** 근무 칸 버튼의 aria-label("{이름} {M}월 {D}일 {코드}")로 근무표를 읽는다. */
export async function readGrid(page: Page, period: PeriodRange): Promise<Grid> {
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

/** ① 준비의 지난 근무 마지막 며칠 칸(`<div aria-label="{이름} {M}/{D} {코드}">`)을 읽는다. */
export async function readCarryOver(page: Page, prev: PeriodRange): Promise<Grid> {
  const first = prev.length - CARRY_OVER_DAYS + 1;
  const month = periodDays(prev).at(-1)!.month;
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("div[aria-label]")].map((d) => d.getAttribute("aria-label") ?? ""),
  );
  const carry: Grid = {};
  for (const label of labels) {
    const m = /^(.+) (\d+)\/(\d+) ([DENO])$/.exec(label);
    if (m && Number(m[2]) === month) (carry[m[1]] ??= [])[Number(m[3]) - first] = m[4] as Code;
  }
  return carry;
}

export const cellCount = (grid: Grid) => Object.values(grid).reduce((sum, row) => sum + row.filter(Boolean).length, 0);

/** 두 근무표의 바뀐 칸. */
export function gridDiff(before: Grid, after: Grid): { name: string; day: number }[] {
  const out: { name: string; day: number }[] = [];
  for (const [name, row] of Object.entries(after))
    row.forEach((c, i) => {
      if (before[name]?.[i] !== c) out.push({ name, day: i + 1 });
    });
  return out;
}

/** 확정본의 fromDay일부터 끝까지(다음 근무표 직전 28일)에서 간호사별 나이트 수와 주말·공휴일 근무 수. */
export function expectedHistory(grid: Grid, period: PeriodRange, holidays: number[], fromDay: number): Record<string, Load> {
  const out: Record<string, Load> = {};
  for (const [name, row] of Object.entries(grid)) {
    const window = row.map((c, i) => ({ c, day: i + 1 })).filter(({ day }) => day >= fromDay);
    out[name] = {
      nights: window.filter(({ c }) => c === "N").length,
      weekends: window.filter(({ c, day }) => c !== "O" && isWeekendDay(period, day, holidays)).length,
    };
  }
  return out;
}

/**
 * /solve 요청의 hard 제약(꺼진 것 제외)과 나이트 전담을 근무표에 대어 위반을 모은다. 솔버와 따로 구현한 검사다.
 * 순서·연속 규칙은 지난 근무 마지막 며칠(carry_over)을 앞에 붙여 근무표 경계도 본다.
 */
export function hardViolations(req: ScheduleRequest, grid: Grid): string[] {
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

/** 근무 칸이 모두 있고 마지막 /solve 요청의 반드시 규칙을 지키는지 본다. */
export async function expectHardRulesHold(page: Page, period: PeriodRange, lastSolve: ScheduleRequest | undefined) {
  const grid = await readGrid(page, period);
  expect(cellCount(grid), "근무 칸 수").toBe(NURSE_COUNT * period.length);
  expect(lastSolve, "마지막 /solve 요청").toBeTruthy();
  expect(lastSolve!.period).toEqual(period);
  expect(hardViolations(lastSolve!, grid), "반드시 규칙 위반").toEqual([]);
}

/** 입력칸에 말을 넣고 [규칙 만들기]/[요청 만들기]를 누른 뒤 응답을 돌려준다. */
export async function interpret(page: Page, inputName: string, submit: string, text: string): Promise<TranslateResponse> {
  await page.getByRole("textbox", { name: inputName }).fill(text);
  const response = page.waitForResponse((r) => r.url().includes("/api/py/translate"), { timeout: 60_000 });
  await page.getByRole("button", { name: submit, exact: true }).click();
  const res = await response;
  expect(res.ok(), `translate ${res.status()}`).toBe(true);
  const body = (await res.json()) as TranslateResponse;
  await expect(page.getByRole("button", { name: "읽는 중…" })).toHaveCount(0);
  test.info().annotations.push({ type: "LLM 해석", description: `${text} → ${JSON.stringify(body)}` });
  return body;
}

export async function interpretOk(page: Page, inputName: string, submit: string, text: string): Promise<ConstraintSpec[]> {
  const body = await interpret(page, inputName, submit, text);
  expect(body.status, `"${text}" 해석 상태`).toBe("ok");
  return body.status === "ok" ? body.constraints : [];
}

/** action이 일으킨 /solve(와 이어지는 /explain)가 끝나 화면이 다시 눌릴 때까지 기다린다. */
export async function solveVia(page: Page, action: () => Promise<void>): Promise<{ status: string; request: ScheduleRequest }> {
  const response = page.waitForResponse((r) => r.url().includes("/api/py/solve"), { timeout: 60_000 });
  await action();
  const res = await response;
  expect(res.ok(), `solve ${res.status()}`).toBe(true);
  const request = res.request().postDataJSON() as ScheduleRequest;
  const body = (await res.json()) as { status: string };
  await expect(idleButton(page)).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByText("원인을 분석하는 중…")).toHaveCount(0, { timeout: 60_000 });
  return { status: body.status, request };
}

export async function deleteAllPending(page: Page) {
  while ((await pendingCards(page).count()) > 0) await pendingCards(page).first().getByRole("button", { name: "삭제" }).click();
}

/** 카드 목록의 순서(제목 + 원문). */
async function cardOrder(page: Page): Promise<string[]> {
  return page
    .locator("article")
    .evaluateAll((els) => els.map((e) => `${e.querySelector("h3")?.textContent} ${e.querySelector("p")?.textContent}`));
}

/** 대기 카드를 모두 적용한다. 2개 이상이면 [모두 적용]을 쓰고, 적용해도 카드 순서가 그대로인지 본다. */
export async function applyAllPending(page: Page) {
  const before = await cardOrder(page);
  const count = await pendingCards(page).count();
  if (count >= 2) await page.getByRole("button", { name: "모두 적용" }).click();
  else if (count === 1) await pendingCards(page).first().getByRole("button", { name: "적용" }).click();
  await expect(pendingCards(page)).toHaveCount(0);
  expect(await cardOrder(page), "적용해도 카드 순서가 그대로").toEqual(before);
}

export async function expectCardChrome(card: Locator, hardness: "반드시" | "가능하면") {
  await expect(card.getByText("적용 대기")).toBeVisible();
  await expect(card.getByRole("button", { name: "삭제" })).toBeVisible();
  await expect(card.getByRole("button", { name: "적용" })).toBeVisible();
  await expect(card.getByRole("group", { name: "반드시/가능하면" }).getByRole("button", { name: hardness })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

/** 근무표 행 끝의 최근 4주 열과 통계 표의 최근 4주 열을 읽고 서로 같은지 확인한다. */
export async function readHistoryColumns(page: Page): Promise<Record<string, Load>> {
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
  expect(stats, "근무표 최근 4주 열 = 통계 최근 4주 열").toEqual(grid);
  return Object.fromEntries(Object.entries(grid).map(([name, [n, w]]) => [name, { nights: Number(n), weekends: Number(w) }]));
}

// 화면에 보이면 안 되는 개발·옛 용어(UI_GUIDE "문구"). LLM이 쓴 문장이 없는 화면에서만 검사한다.
const DEV_TERMS = /\b(hard|soft)\b|해 있음|해 없음|초안|이월|기간|달력 월|생성|재풀이|\bn\d{2}\b/i;

export async function expectNoDevTerms(page: Page, where: string) {
  const hit = DEV_TERMS.exec(await page.locator("body").innerText());
  expect(hit?.[0], `${where}: 화면에 개발 용어`).toBeUndefined();
}
