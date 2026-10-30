// e2e 공통 도우미. 시나리오는 docs/BROWSER_TEST_SCENARIOS.md. LLM은 mock하지 않는다(ADR-013).
import { isDeepStrictEqual } from "node:util";

import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AvailabilitySlots } from "../lib/availability";
import { dateOfDay, isWeekendDay, type PeriodRange, periodDays } from "../lib/period";
import type { Shop, WorkPeriod } from "../lib/store";
import { DEFAULT_CONFIG, ruleShape } from "../lib/rules";
import type { ConstraintSpec, Days, People, ScheduleRequest, ScheduleResult, Shifts, TranslateResponse } from "../lib/types.gen";

/** 근무 코드. 기본은 A/M/C/O이고 매장이 더한 코드(P, AC 등)도 온다. */
export type Code = "A" | "M" | "C" | "O" | (string & {});
export type Grid = Record<string, Code[]>;
export type Load = { closings: number; weekends: number };
type StoredState = { shop: Shop; periods: WorkPeriod[]; view: { screen: string; periodId?: string } };
type StoredDoc = { version: number; state: StoredState };

export const T0 = new Date("2026-10-28T09:00:00+09:00");
export const EMPLOYEE_COUNT = 12;
export const CARRY_OVER_DAYS = 7;
const STORAGE_KEY = "shop-scheduler";
/** [이름, 태그] (BROWSER_TEST_SCENARIOS D1) */
export const ROSTER: [string, string | null][] = [
  ["이영희", "리더"],
  ["박민수", null],
  ["김철수", null],
  ["정유진", null],
  ["최지훈", null],
  ["강서연", "리더"],
  ["윤지민", "리더"],
  ["임하늘", null],
  ["한소율", null],
  ["오민준", null],
  ["서예린", "신입"],
  ["신도윤", "신입"],
];

// ── 계정과 저장 상태: 테스트 계정으로 로그인한 supabase-js(RLS)와 anon만 쓴다. service role 키는 쓰지 않는다 ──
const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`.env.local에 ${name}이 필요해요`);
  return v;
};
const newClient = () =>
  createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const anon = newClient();
let owner: Promise<{ db: SupabaseClient; userId: string }> | null = null;

function account() {
  owner ??= (async () => {
    const db = newClient();
    const { data, error } = await db.auth.signInWithPassword({ email: env("E2E_TEST_EMAIL"), password: env("E2E_TEST_PASSWORD") });
    if (error) throw new Error(`테스트 계정 로그인 실패: ${error.message}`);
    return { db, userId: data.user.id };
  })();
  return owner;
}

export const testEmail = () => env("E2E_TEST_EMAIL");

/** 테스트 계정의 shops 행을 지운다. availability_links 행은 함께 지워진다(on delete cascade). */
export async function clearAccount() {
  const { db, userId } = await account();
  const { error } = await db.from("shops").delete().eq("owner_id", userId);
  if (error) throw new Error(error.message);
}

export function fullDaySlots(period: PeriodRange): AvailabilitySlots {
  return Object.fromEntries(periodDays(period).map((d) => [d.date, [["09:00", "23:00"]]])) as AvailabilitySlots;
}

/** 저장 문서를 넣는다. 근무표마다 직원 수만큼 링크 행을 만들고 토큰은 DB가 새로 정한다. 전일 제출 상태이고 확정 근무표의 행은 잠근다. */
export async function seedShop(doc: StoredDoc) {
  const { db, userId } = await account();
  const { data, error } = await db.from("shops").insert({ owner_id: userId, data: doc }).select("id").single();
  if (error) throw new Error(error.message);
  const { shop, periods } = doc.state;
  const rows = periods.flatMap((p) =>
    shop.employees.map((n) => ({
      shop_id: data.id,
      period_start: p.start_date,
      period_length: p.length,
      employee_id: n.id,
      employee_name: n.name,
      shop_name: shop.name,
      slots: fullDaySlots(p),
      submitted_at: T0.toISOString(),
      locked_at: p.status === "confirmed" ? T0.toISOString() : null,
    })),
  );
  const { error: linkError } = await db.from("availability_links").insert(rows);
  if (linkError) throw new Error(linkError.message);
}

export interface LinkRow {
  token: string;
  employee_id: string;
  employee_name: string;
  slots: AvailabilitySlots;
  submitted_at: string | null;
  locked_at: string | null;
}

export async function linkRows(periodStart: string): Promise<LinkRow[]> {
  const { db } = await account();
  const { data, error } = await db
    .from("availability_links")
    .select("token, employee_id, employee_name, slots, submitted_at, locked_at")
    .eq("period_start", periodStart);
  if (error) throw new Error(error.message);
  return data as LinkRow[];
}

export async function savedDoc(): Promise<StoredDoc | null> {
  const { db } = await account();
  const { data, error } = await db.from("shops").select("data").maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.data as StoredDoc | undefined) ?? null;
}

/** 직원 화면을 거치지 않는 제출. 로그인 없는 anon으로 토큰 DB 함수를 부른다. */
export const submitAvailability = (token: string, slots: AvailabilitySlots) =>
  anon.rpc("submit_availability", { p_token: token, p_slots: slots });
export const getAvailability = (token: string) => anon.rpc("get_availability", { p_token: token });

/** 화면이 링크 행을 만들 때까지 기다린 뒤, 그 근무표의 직원들에게 전일 가능 시간을 제출한다. exclude는 빼고. */
export async function submitFullDay(period: PeriodRange, count: number, exclude: string[] = []) {
  await expect.poll(async () => (await linkRows(period.start_date)).length, { message: "링크 행", timeout: 15_000 }).toBe(count);
  for (const row of await linkRows(period.start_date)) {
    if (exclude.includes(row.employee_name)) continue;
    const { error } = await submitAvailability(row.token, fullDaySlots(period));
    expect(error, `${row.employee_name} 제출`).toBeNull();
  }
}

/** 지금 화면의 상태가 서버 문서까지 저장될 때까지 기다린다. 새로고침 전에 부른다. */
export async function expectSaved(page: Page) {
  await expect
    .poll(
      async () => {
        const local = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), STORAGE_KEY);
        const saved = await savedDoc();
        return isDeepStrictEqual(local?.state, saved?.state);
      },
      { message: "서버 저장", timeout: 15_000 },
    )
    .toBe(true);
}

/**
 * 테스트 로그인 경로로 세션을 만든다. 경로는 NEXT_PUBLIC_E2E_LOGIN=1로 띄운 서버에만 있다(playwright.config.ts).
 * 이미 떠 있던 개발 서버를 재사용하면 이 값이 없어 여기서 실패한다.
 */
export async function loginAsTestUser(page: Page) {
  if (!new URL(page.url()).pathname.startsWith("/app")) await page.goto("/app");
  await page.waitForFunction(() => "__e2eSignIn" in window, undefined, { timeout: 30_000 });
  await page.evaluate(
    ([email, password]) => (window as unknown as { __e2eSignIn: (e: string, p: string) => Promise<void> }).__e2eSignIn(email, password),
    [env("E2E_TEST_EMAIL"), env("E2E_TEST_PASSWORD")],
  );
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toHaveCount(0);
  await expect(page.getByText("불러오는 중…")).toHaveCount(0);
}

// ── 흐름 공통 ──
const CONTEXT = { locale: "ko-KR", timezoneId: "Asia/Seoul" };

/** 콘솔 error와 /api/* 실패를 모은다(모든 시나리오 공통 검증). */
export function trackProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/") && !r.ok()) problems.push(`api ${r.status()} ${r.url()}`);
  });
  return problems;
}

/** 시계를 고정한 새 컨텍스트와 페이지. 앞 시나리오의 상태를 잇는 흐름은 이 페이지 하나를 공유한다. */
export async function openFlow(browser: Browser, viewport = { width: 1440, height: 1000 }): Promise<{ context: BrowserContext; page: Page; problems: string[] }> {
  const context = await browser.newContext({ ...CONTEXT, viewport });
  const page = await context.newPage();
  await page.clock.setFixedTime(T0);
  return { context, page, problems: trackProblems(page) };
}

/** 공통 검증: 오류 알림([다시 시도] 포함)과 콘솔 오류·API 실패가 없다. 끝나면 목록을 비운다. */
export async function expectNoProblems(page: Page, problems: string[]) {
  // Next 개발 서버의 route announcer도 role=alert라 [다시 시도]로 구분한다
  await expect(page.getByRole("alert").filter({ hasText: "다시 시도" })).toHaveCount(0);
  expect(problems.splice(0), "콘솔 오류·API 실패").toEqual([]);
}

/** 명단 표 맨 아래 줄에 적고 이름 칸에서 Enter. 적다 만 태그도 함께 들어간다. */
export async function addRoster(page: Page, roster: [string, string | null][]) {
  const name = page.getByRole("textbox", { name: "새 직원 이름" });
  const tag = page.getByRole("combobox", { name: "새 직원 태그" });
  for (const [n, t] of roster) {
    await name.fill(n);
    if (t) await tag.fill(t);
    await name.press("Enter");
    await expect(name).toHaveValue("");
    await expect(name).toBeFocused();
  }
}

export const pendingCards = (page: Page) => page.locator("article").filter({ hasText: "적용 대기" });
export const appliedCards = (page: Page) => page.locator("article").filter({ hasText: "적용됨" });
export const scheduleTitle = (page: Page) => page.getByRole("heading", { name: "근무표", exact: true }).first();
/** 진행 중이면 비활성이 되는 버튼. 근무표가 없으면 [근무표 만들기], 있으면 [CSV 받기]다. */
const idleButton = (page: Page) => page.getByRole("button", { name: /^(근무표 만들기|CSV 받기)$/ });
/** 누를 수 있는 Primary 버튼. 펼친 입력 바의 빈 [요청 만들기]는 비활성이라 세지 않는다. */
export const primaryButtons = (page: Page) => page.locator('main button[class*="bg-[#155E75]"]:not(:disabled)');

export async function readState(page: Page): Promise<StoredState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("shop-scheduler")!).state);
}

export async function employeeId(page: Page, name: string): Promise<string> {
  const n = (await readState(page)).shop.employees.find((x) => x.name === name);
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
  const { shop, periods } = await readState(page);
  const assignments = periods.find((x) => x.start_date === start)!.versions.at(-1)!.assignments;
  return Object.fromEntries(shop.employees.map((n) => [n.name, assignments[n.id] as Code[]]));
}

/** 근무 칸 aria-label 끝의 근무 코드(대문자·숫자 1~3자). */
const CODE = "[A-Z0-9]{1,3}";

/** 근무 칸 버튼의 aria-label("{이름} {M}월 {D}일 {코드}")로 근무표를 읽는다. */
export async function readGrid(page: Page, period: PeriodRange): Promise<Grid> {
  const index = Object.fromEntries(periodDays(period).map((d) => [`${d.month}-${d.dom}`, d.day]));
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label") ?? ""),
  );
  const grid: Grid = {};
  for (const label of labels) {
    const m = new RegExp(`^(.+) (\\d+)월 (\\d+)일 (${CODE})$`).exec(label);
    const day = m && index[`${m[2]}-${m[3]}`];
    if (m && day) (grid[m[1]] ??= [])[day - 1] = m[4] as Code;
  }
  return grid;
}

/** ① 준비의 지난 근무 마지막 며칠 칸(`<div aria-label="{이름} {M}/{D} {코드}">`)을 읽는다. 지난 근무표 끝이 월을 넘을 수 있다. */
export async function readCarryOver(page: Page, prev: PeriodRange): Promise<Grid> {
  const index = new Map(periodDays(prev).slice(-CARRY_OVER_DAYS).map((d, i) => [`${d.month}/${d.dom}`, i]));
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("div[aria-label]")].map((d) => d.getAttribute("aria-label") ?? ""),
  );
  const carry: Grid = {};
  for (const label of labels) {
    const m = new RegExp(`^(.+) (\\d+/\\d+) (${CODE})$`).exec(label);
    const i = m ? index.get(m[2]) : undefined;
    if (m && i !== undefined) (carry[m[1]] ??= [])[i] = m[3] as Code;
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

/** 직전 28일 확정본에서 직원별 마감 수와 주말·공휴일 근무 수. */
export function expectedHistory(grid: Grid, period: PeriodRange, holidays: number[]): Record<string, Load> {
  const out: Record<string, Load> = {};
  for (const [name, row] of Object.entries(grid)) {
    out[name] = {
      closings: row.filter((c) => c === "C").length,
      weekends: row.filter((c, i) => c !== "O" && isWeekendDay(period, i + 1, holidays)).length,
    };
  }
  return out;
}

/** 휴가 모양 규칙(고른 사람 × 날짜에 근무 없음)이면 사람마다 { employee_id, days }. 아니면 빈 목록. */
export function leavesOf(c: ConstraintSpec): { employee_id: string; days: number[] }[] {
  const p = ruleShape(c);
  if (p?.kind !== "count") return [];
  const ids = p.people.ids;
  if (p.per !== "person" || p.max?.n !== 0 || !p.shifts.not_in?.includes("O") || !ids?.length || !p.days.days) return [];
  return ids.map((employee_id) => ({ employee_id, days: p.days.days! }));
}

/** 한 사람의 휴가 모양 블록이면 { employee_id, days }. */
export function leaveOf(c: ConstraintSpec): { employee_id: string; days: number[] } | null {
  const list = leavesOf(c);
  return list.length === 1 ? list[0] : null;
}

/**
 * /solve 요청의 hard 제약(꺼진 것 제외)을 근무표에 대어 위반을 모은다. 솔버와 따로 구현한 검사다.
 * 식 규칙은 변환표의 블록 모양(ruleShape)으로 읽어 세기(날마다·사람마다, 개수), 순서(금지 패턴·최대 연속·끝난 뒤 휴무)와
 * 칸 고정만 본다. 그 밖의 모양(조건부·짝 등)은 검사하지 않는다.
 * 순서 규칙은 지난 근무 마지막 며칠(carry_over)을 앞에 붙여 근무표 경계도 본다.
 */
export function hardViolations(req: ScheduleRequest, grid: Grid): string[] {
  const out: string[] = [];
  const { employees, period, holidays = [], constraints = [], carry_over = [] } = req;
  const config = req.config ?? DEFAULT_CONFIG;
  const days = period.length;
  const pdays = periodDays(period);
  const isWeekend = (d: number) => isWeekendDay(period, d, holidays);
  const rows = new Map<string, Code[]>();
  const extended = new Map<string, { row: Code[]; offset: number }>();
  for (const n of employees) {
    const row = grid[n.name];
    if (!row || row.length !== days || row.some((c) => !c)) {
      out.push(`${n.name}: 근무표 행이 없거나 ${days}칸이 아님`);
      continue;
    }
    rows.set(n.id, row);
    const carry = (carry_over.find((r) => r.employee_id === n.id)?.shifts ?? []) as Code[];
    extended.set(n.id, { row: [...carry, ...row], offset: carry.length });
  }
  const name = (id: string) => employees.find((n) => n.id === id)?.name ?? id;
  const covers = (code: string) => [code, ...(config.shifts.find((s) => s.code === code)?.parts ?? [])];
  const matches = (code: string, sel: Shifts) =>
    sel.in ? covers(code).some((c) => sel.in!.includes(c)) : !covers(code).some((c) => sel.not_in!.includes(c));
  const people = (p: People | undefined) =>
    employees
      .filter(
        (n) =>
          (!p?.ids || p.ids.includes(n.id)) &&
          (!p?.tags || p.tags.some((t) => n.tags?.includes(t))) &&
          !(p?.exclude_tags ?? []).some((t) => n.tags?.includes(t)),
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
    const balance = c.type === "rule" && c.body.kind === "balance";
    if (c.enabled === false || (c.hardness ?? (balance ? "soft" : "hard")) !== "hard") continue;
    const tag = `${c.type} "${c.source_text}"`;
    if (c.type === "fixed_assignment") {
      if (rows.get(c.params.employee_id)?.[c.params.day - 1] !== c.params.shift)
        out.push(`${tag}: ${name(c.params.employee_id)} ${c.params.day}일`);
      continue;
    }
    const p = ruleShape(c);
    switch (p?.kind) {
      case "count": {
        if (p.measure !== "count") break;
        const ids = people(p.people);
        const dayList = pdays.map((x) => x.day).filter((d) => dayOk(d, p.days));
        const hit = (id: string, d: number) => matches(rows.get(id)?.[d - 1] ?? "O", p.shifts);
        if (p.per === "day") {
          for (const d of dayList) {
            const count = ids.filter((id) => hit(id, d)).length;
            if (outOfRange(count, p.min?.n, p.max?.n)) out.push(`${tag}: ${d}일 ${count}명`);
          }
        } else if (p.per === "person") {
          for (const id of ids) {
            const count = dayList.filter((d) => hit(id, d)).length;
            if (outOfRange(count, p.min?.n, p.max?.n)) out.push(`${tag}: ${name(id)} ${count}일`);
          }
        }
        break;
      }
      case "forbid":
      case "max_run":
      case "off_after": {
        for (const id of people(p.people)) {
          const ext = extended.get(id);
          if (!ext) continue;
          const { row: r, offset } = ext;
          if (p.kind === "forbid") {
            const pattern = p.pattern;
            for (let i = Math.max(0, offset - pattern.length + 1); i + pattern.length <= r.length; i++)
              if (pattern.every((sel, k) => matches(r[i + k], sel))) out.push(`${tag}: ${name(id)} ${i - offset + 1}일부터`);
          }
          if (p.kind === "max_run") {
            let cur = 0;
            for (const code of r) {
              cur = matches(code, p.run) ? cur + 1 : 0;
              if (cur > p.max_len.n) {
                out.push(`${tag}: ${name(id)}`);
                break;
              }
            }
          }
          if (p.kind === "off_after") {
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
    }
  }
  return out;
}

/**
 * 식 규칙 평가(backend solver/evaluate)로 근무표의 반드시 규칙 위반을 모은다. 조건부·짝처럼 hardViolations가 읽지 못하는 모양도 본다.
 * 모든 칸을 고정 근무로 걸고 반드시 식 규칙을 가능하면으로 바꿔 /api/py/solve에 보내면, 응답의 soft_violations가 그 규칙들의
 * evaluate_rule 결과다. 반드시 고르게(balance)는 가능하면의 기준이 달라 그대로 두고, 해가 없으면 위반으로 본다.
 * 칸 고정은 hardViolations가 보므로 빼고, 가능하면 규칙은 판정과 관계없어 뺀다.
 */
export async function evaluatedViolations(page: Page, req: ScheduleRequest, grid: Grid): Promise<string[]> {
  const hard = new Set<string>();
  const constraints: ConstraintSpec[] = [];
  for (const c of req.constraints ?? []) {
    if (c.type !== "rule" || c.enabled === false) continue;
    const balance = c.body.kind === "balance";
    if ((c.hardness ?? (balance ? "soft" : "hard")) !== "hard") continue;
    if (balance) constraints.push(c);
    else {
      hard.add(c.id);
      constraints.push({ ...c, hardness: "soft" });
    }
  }
  for (const n of req.employees)
    (grid[n.name] ?? []).forEach((shift, i) =>
      constraints.push({
        id: `e2e-${n.id}-${i + 1}`,
        type: "fixed_assignment",
        scope: "period",
        source_text: "e2e",
        params: { employee_id: n.id, day: i + 1, shift },
      }),
    );
  const res = await page.request.post("/api/py/solve", { data: { ...req, previous: null, constraints }, timeout: 60_000 });
  expect(res.ok(), `평가용 solve ${res.status()}`).toBe(true);
  const body = await res.json();
  if (body.status !== "ok") return [`반드시 고르게 규칙 위반 또는 ${body.status}: ${JSON.stringify(body.conflicts ?? [])}`];
  const result = body.result as ScheduleResult;
  return result.soft_violations.filter((v) => hard.has(v.constraint_id)).map((v) => `${v.constraint_id}: ${v.detail}`);
}

/** H9: 휴무가 아닌 칸의 근무조 시작~끝 시각 전체가 그 직원의 그날 가능 시간 안에 있는지. 칸 고정은 빼고 본다. lib/availability와 따로 구현한 검사다. */
export function availabilityViolations(req: ScheduleRequest, grid: Grid, rows: LinkRow[]): string[] {
  const out: string[] = [];
  const shifts = (req.config ?? DEFAULT_CONFIG).shifts;
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const fixed = new Set(
    (req.constraints ?? []).flatMap((c) => (c.type === "fixed_assignment" && c.enabled !== false ? [`${c.params.employee_id}@${c.params.day}`] : [])),
  );
  for (const n of req.employees) {
    const slots = rows.find((r) => r.employee_id === n.id)?.slots ?? {};
    (grid[n.name] ?? []).forEach((code, i) => {
      if (code === "O" || fixed.has(`${n.id}@${i + 1}`)) return;
      const def = shifts.find((s) => s.code === code);
      const parts = def?.parts?.length ? def.parts.map((p) => shifts.find((s) => s.code === p)) : [def];
      const open = new Set<number>();
      for (const [from, to] of slots[dateOfDay(req.period, i + 1)] ?? []) for (let t = minutes(from); t < minutes(to); t += 30) open.add(t);
      for (const part of parts) {
        for (let t = minutes(part?.start ?? "00:00"); t < minutes(part?.end ?? "00:00"); t += 30) {
          if (!open.has(t)) {
            out.push(`${n.name} ${i + 1}번째 날 ${code}`);
            return;
          }
        }
      }
    });
  }
  return out;
}

/** 근무 칸이 모두 있고 마지막 /solve 요청의 반드시 규칙을 지키는지 본다(따로 구현한 검사 + 식 규칙 평가 + 가능 시간). */
export async function expectHardRulesHold(page: Page, period: PeriodRange, lastSolve: ScheduleRequest | undefined) {
  const grid = await readGrid(page, period);
  expect(lastSolve, "마지막 /solve 요청").toBeTruthy();
  expect(cellCount(grid), "근무 칸 수").toBe(lastSolve!.employees.length * period.length);
  expect(lastSolve!.period).toEqual(period);
  expect(hardViolations(lastSolve!, grid), "반드시 규칙 위반").toEqual([]);
  expect(await evaluatedViolations(page, lastSolve!, grid), "반드시 규칙 위반(식 규칙 평가)").toEqual([]);
  expect(availabilityViolations(lastSolve!, grid, await linkRows(period.start_date)), "가능 시간 위반").toEqual([]);
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

/** 대기 카드의 배지·버튼과 반드시/가능하면 토글. 휴가 카드는 토글이 없다(null). */
export async function expectCardChrome(card: Locator, hardness: "반드시" | "가능하면" | null) {
  await expect(card.getByText("적용 대기")).toBeVisible();
  await expect(card.getByRole("button", { name: "삭제" })).toBeVisible();
  await expect(card.getByRole("button", { name: "적용" })).toBeVisible();
  const toggle = card.getByRole("group", { name: "반드시/가능하면" });
  if (hardness === null) await expect(toggle).toHaveCount(0);
  else await expect(toggle.getByRole("button", { name: hardness })).toHaveAttribute("aria-pressed", "true");
}

/** 근무표 행 끝의 최근 4주 열과 통계 표의 최근 4주 열을 읽고 서로 같은지 확인한다. */
export async function readHistoryColumns(page: Page): Promise<Record<string, Load>> {
  const { grid, stats } = await page.evaluate(() => {
    const grid: Record<string, [string, string]> = {};
    for (const b of document.querySelectorAll("button[aria-label]")) {
      const m = /^(.+) \d+월 \d+일 [A-Z0-9]{1,3}$/.exec(b.getAttribute("aria-label") ?? "");
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
  return Object.fromEntries(Object.entries(grid).map(([name, [n, w]]) => [name, { closings: Number(n), weekends: Number(w) }]));
}

// 화면에 보이면 안 되는 개발·옛 용어(UI_GUIDE "문구"). LLM이 쓴 문장이 없는 화면에서만 검사한다.
const DEV_TERMS = /\b(hard|soft)\b|해 있음|해 없음|초안|이월|기간|달력 월|생성|재풀이|availability|토큰|\be\d{2}\b/i;

export async function expectNoDevTerms(page: Page, where: string) {
  const hit = DEV_TERMS.exec(await page.locator("body").innerText());
  expect(hit?.[0], `${where}: 화면에 개발 용어`).toBeUndefined();
}

/** 칸 가운데를 누르고 같은 열의 끝 칸까지 옮긴 뒤 놓는다. */
export async function dragCells(page: Page, from: string, to: string) {
  const center = async (name: string) => {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box, name).toBeTruthy();
    return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  };
  const a = await center(from);
  const b = await center(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

/** 표에 보이는 직원 링크(`/a/{토큰}`). */
export const shownLinks = (page: Page) =>
  page.locator("td").filter({ hasText: "/a/" }).allInnerTexts();
