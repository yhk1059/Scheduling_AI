// e2e 공통 도우미. 시나리오는 docs/BROWSER_TEST_SCENARIOS.md. LLM은 mock하지 않는다(ADR-013).
import { expect, type Locator, type Page, test } from "@playwright/test";

import { isWeekendDay, type PeriodRange, periodDays } from "../lib/period";
import type { Ward, WorkPeriod } from "../lib/store";
import { DEFAULT_CONFIG } from "../lib/migrate";
import type { ConstraintSpec, Days, People, ScheduleRequest, Shifts, TranslateResponse } from "../lib/types.gen";

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

/** 휴가 모양 블록(한 사람 × 날짜에 근무 없음)이면 { nurse_id, days }. */
export function leaveOf(c: ConstraintSpec): { nurse_id: string; days: number[] } | null {
  if (c.type !== "count") return null;
  const p = c.params;
  const ids = p.people?.ids;
  if (p.per !== "person" || p.max !== 0 || !p.shifts.not_in?.includes("O") || ids?.length !== 1 || !p.days?.days) return null;
  return { nurse_id: ids[0], days: p.days.days };
}

/**
 * /solve 요청의 hard 제약(꺼진 것 제외)을 근무표에 대어 위반을 모은다. 솔버와 따로 구현한 검사다.
 * 블록은 세기(날마다·사람마다, 개수), 순서(금지 패턴·최대 연속·끝난 뒤 휴무), 칸 고정만 본다. 그 밖의 모양은 검사하지 않는다.
 * 순서 규칙은 지난 근무 마지막 며칠(carry_over)을 앞에 붙여 근무표 경계도 본다.
 */
export function hardViolations(req: ScheduleRequest, grid: Grid): string[] {
  const out: string[] = [];
  const { nurses, period, holidays = [], constraints = [], carry_over = [] } = req;
  const config = req.config ?? DEFAULT_CONFIG;
  const days = period.length;
  const pdays = periodDays(period);
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
  }
  const name = (id: string) => nurses.find((n) => n.id === id)?.name ?? id;
  const covers = (code: string) => [code, ...(config.shifts.find((s) => s.code === code)?.parts ?? [])];
  const matches = (code: string, sel: Shifts) =>
    sel.in ? covers(code).some((c) => sel.in!.includes(c)) : !covers(code).some((c) => sel.not_in!.includes(c));
  const people = (p: People | undefined) =>
    nurses
      .filter(
        (n) =>
          (!p?.ids || p.ids.includes(n.id)) &&
          (!p?.tags || p.tags.some((t) => n.tags?.includes(t))) &&
          !(p?.exclude_tags ?? []).some((t) => n.tags?.includes(t)) &&
          (p?.min_years == null || n.years >= p.min_years) &&
          (p?.max_years == null || n.years <= p.max_years),
      )
      .map((n) => n.id);
  const dayOk = (d: number, sel: Days | undefined) => {
    const kind = sel?.kind ?? "all";
    const kindOk =
      kind === "all" || (kind === "weekend" ? isWeekend(d) : kind === "weekday" ? !isWeekend(d) : holidays.includes(d));
    const mon0 = (pdays[d - 1].weekday + 6) % 7; // 0=월
    return kindOk && (!sel?.weekdays || sel.weekdays.includes(mon0)) && (!sel?.days || sel.days.includes(d));
  };
  const outOfRange = (v: number, min?: number | null, max?: number | null) => (min != null && v < min) || (max != null && v > max);

  for (const c of constraints) {
    if (c.enabled === false || (c.hardness ?? (c.type === "balance" ? "soft" : "hard")) !== "hard") continue;
    const tag = `${c.type} "${c.source_text}"`;
    switch (c.type) {
      case "count": {
        const p = c.params;
        if ((p.measure ?? "count") !== "count") break;
        const ids = people(p.people);
        const dayList = pdays.map((x) => x.day).filter((d) => dayOk(d, p.days));
        const hit = (id: string, d: number) => matches(rows.get(id)?.[d - 1] ?? "O", p.shifts);
        if (p.per === "day") {
          for (const d of dayList) {
            const count = ids.filter((id) => hit(id, d)).length;
            if (outOfRange(count, p.min, p.max)) out.push(`${tag}: ${d}일 ${count}명`);
          }
        } else if (p.per === "person") {
          for (const id of ids) {
            const count = dayList.filter((d) => hit(id, d)).length;
            if (outOfRange(count, p.min, p.max)) out.push(`${tag}: ${name(id)} ${count}일`);
          }
        }
        break;
      }
      case "sequence": {
        const p = c.params;
        for (const id of people(p.people)) {
          const ext = extended.get(id);
          if (!ext) continue;
          const { row: r, offset } = ext;
          for (const pattern of p.forbid ?? []) {
            for (let i = Math.max(0, offset - pattern.length + 1); i + pattern.length <= r.length; i++)
              if (pattern.every((sel, k) => matches(r[i + k], sel))) out.push(`${tag}: ${name(id)} ${i - offset + 1}일부터`);
          }
          if (p.run && p.max_len != null) {
            let cur = 0;
            for (const code of r) {
              cur = matches(code, p.run) ? cur + 1 : 0;
              if (cur > p.max_len) {
                out.push(`${tag}: ${name(id)}`);
                break;
              }
            }
          }
          if (p.after && p.then_off != null) {
            for (let i = 0; i + 1 < r.length; i++) {
              if (!matches(r[i], p.after) || matches(r[i + 1], p.after)) continue;
              for (let k = 1; k <= p.then_off && i + k < r.length; k++)
                if (i + k >= offset && r[i + k] !== "O")
                  out.push(`${tag}: ${name(id)} ${i - offset + 1}일 뒤 ${i + k - offset + 1}일 ${r[i + k]}`);
            }
          }
        }
        break;
      }
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
