// docs/BROWSER_TEST_SCENARIOS.md S3, S4. 운영 중인 매장(D3, 오늘 2026-10-28 기준: 10/5~11/1 운영 중 + 11/2~11/29 작성 중)을 이어 쓰는 흐름이라
// 페이지 하나를 공유하며 순서대로 돈다. LLM은 mock하지 않는다(ADR-013).
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import shopOct from "./fixtures/shop-oct.json";

import type { PeriodRange } from "../lib/period";
import { historyLoadFor, type HistoryLoad } from "../lib/continuity";
import type { Shop } from "../lib/store";
import type { ScheduleRequest } from "../lib/types.gen";
import {
  appliedCards,
  CARRY_OVER_DAYS,
  clearAccount,
  confirmedGrid,
  EMPLOYEE_COUNT,
  expectedHistory,
  expectHardRulesHold,
  expectNoDevTerms,
  expectNoProblems,
  type Grid,
  gridDiff,
  interpretOk,
  leaveOf,
  linkRows,
  loginAsTestUser,
  openFlow,
  pendingCards,
  periodByStart,
  primaryButtons,
  readCarryOver,
  readGrid,
  readHistoryColumns,
  readState,
  scheduleTitle,
  seedShop,
  solveVia,
  openStats,
} from "./test-helpers";

const OCT: PeriodRange = { start_date: "2026-10-05", length: 28 };
const NOV: PeriodRange = { start_date: "2026-11-02", length: 28 };
const OCT_NAME = "10/5~11/1 근무표";
const NOV_NAME = "11/2~11/29 근무표";
const TODAY = 24; // 10/28은 10/5부터 24번째 날
const LEE = 2; // 이영희 10/7의 인덱스

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let problems: string[] = [];
let lastSolve: ScheduleRequest | undefined;
let octGrid: Grid;

const sectionWith = (heading: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

test.beforeAll(async ({ browser }) => {
  ({ context, page, problems } = await openFlow(browser));
});

test.afterAll(async () => {
  await context.close();
});

test.afterEach(async () => {
  await expectNoProblems(page, problems);
});

async function solve(action: () => Promise<void>) {
  const { status, request } = await solveVia(page, action);
  lastSolve = request;
  return status;
}

test("S3. 운영 중인 매장: 다음 근무표 작성과 확정", async () => {
  await clearAccount();
  await seedShop(shopOct as never);

  // S3-a. 매장 홈
  const apiCalls: string[] = [];
  const onRequest = (r: { url: () => string }) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.url());
  };
  page.on("request", onRequest);
  await page.goto("/app");
  await loginAsTestUser(page);
  await expect(page.getByRole("heading", { name: "성수 카페", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("직원 12명 · 매장 조건 7개 · 4주 단위");
  const operating = sectionWith(OCT_NAME);
  await expect(operating.getByText("운영 중", { exact: true })).toBeVisible();
  await expect(operating).toContainText("2026.10.5 – 11.1");
  await expect(operating).toContainText("마지막 확정 10/2 18:00");
  await expect(operating.getByRole("button", { name: "변경 입력" })).toBeVisible();
  const task = sectionWith(NOV_NAME);
  await expect(task).toContainText("2026.11.2 – 11.29");
  await expect(task).toContainText("직원 링크를 공유하고 조건을 확인하세요");
  await expect(task).toContainText("아직 근무표를 만들지 않았어요");
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("이어서 하기");
  await expect(page.getByText("확정한 근무표가 여기에 쌓여요.")).toBeVisible();
  page.off("request", onRequest);
  expect(apiCalls, "매장 홈을 열 때 API를 부르지 않는다").toEqual([]);
  await expectNoDevTerms(page, "매장 홈");
  octGrid = await confirmedGrid(page, OCT.start_date);

  // S3-b. ① 가능 시간: 접힌 준비 요약 → [바꾸기]로 지난 근무 확인
  await task.getByRole("button", { name: "이어서 하기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOV_NAME);
  await expect(page.getByText("작성 중", { exact: true })).toBeVisible();
  const stepper = page.getByRole("list", { name: "근무표 작성 단계" });
  await expect(stepper.locator('[aria-current="step"]')).toContainText("가능 시간");
  await expect(page.getByRole("main")).toContainText("2026.11.2 – 11.29 · 공휴일 없음 · 직원 12명 · 지난 근무표에서 이어져요");
  const prepare = page.getByRole("button", { name: "바꾸기" });
  await expect(prepare).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: "명단 확인" })).toHaveCount(0);
  await prepare.click();
  await expect(sectionWith("명단 확인")).toContainText("직원 12명 · 지난 근무표와 명단이 같아요");
  await expect(page.getByRole("heading", { name: "지난 근무 마지막 며칠", exact: true })).toBeVisible();
  const carry = await readCarryOver(page, OCT);
  for (const [name, row] of Object.entries(octGrid)) expect(carry[name], `${name} 지난 근무`).toEqual(row.slice(-CARRY_OVER_DAYS));
  await expectNoDevTerms(page, "① 가능 시간(준비 펼침)");
  await page.getByRole("button", { name: "접기" }).first().click();
  await expect(page.getByRole("button", { name: "링크 복사" })).toHaveCount(1);

  // ② 매장 조건: 요약표(D2)와 적용된 규칙 카드 7장, 그 아래 펼쳐진 예외 패널에 요청 3개
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(stepper.locator('[aria-current="step"]')).toContainText("매장 조건");
  await expect(page.getByRole("heading", { name: "매장 조건", exact: true })).toBeVisible();
  const openRow = page.getByRole("row").filter({ hasText: "오픈" }).first();
  await expect(openRow).toContainText("09:00~15:00");
  await expect(page.getByRole("textbox", { name: "예외 입력" })).toBeVisible();
  await expect(pendingCards(page)).toHaveCount(0);
  await expect(appliedCards(page)).toHaveCount(7 + 3);
  for (const summary of ["이영희 · 11/10~11/12 · 휴무", "박민수 · 주말·공휴일 · 마감 피하기", "정유진 · 11/20 · 오픈 희망"]) {
    await expect(appliedCards(page).filter({ hasText: summary })).toHaveCount(1);
  }
  await expectNoDevTerms(page, "② 매장 조건과 예외 입력");

  // ③ 근무표: 예외 입력 없이 바로 근무표 만들기
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(stepper.locator('[aria-current="step"]')).toContainText("근무표");
  await expect(scheduleTitle(page)).toBeVisible();
  await expect(page.getByText("가능 시간과 매장 조건으로 근무표를 만들어요")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "예외 입력" })).toHaveCount(0);

  // S3-c. 근무표 만들기: 최근 4주 열과 근거 한 줄
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("ok");
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expect(page.getByText("희망 반영", { exact: true })).toBeVisible();
  await expect(page.getByText("못 지킨 가능하면 규칙", { exact: true })).toBeVisible();
  await openStats(page);
  const stats = sectionWith("개인별 통계");
  await expect(stats.locator("tbody tr")).toHaveCount(EMPLOYEE_COUNT);
  for (const h of ["최근 4주 마감", "최근 4주 주말", "평균보다 많은 근무일"]) {
    await expect(stats.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
  }

  const { shop } = await readState(page);
  const idOf = (name: string) => shop.employees.find((n) => n.name === name)!.id;
  const expected = expectedHistory(octGrid, OCT, []);
  expect(await readHistoryColumns(page), "최근 4주 열").toEqual(expected);
  const byId = (list: HistoryLoad[]) => [...list].sort((a, b) => a.employee_id.localeCompare(b.employee_id));
  expect(Object.fromEntries(Object.entries(lastSolve!.history?.rows ?? {})), "요청의 history 원본").toEqual(
    Object.fromEntries(Object.entries(octGrid).map(([name, row]) => [idOf(name), row])),
  );
  expect(byId(historyLoadFor(lastSolve!.history ?? null, shop.config)), "history에서 센 최근 4주").toEqual(
    byId(
      Object.entries(expected)
        .filter(([, v]) => v.closings > 0 || v.weekends > 0)
        .map(([name, v]) => ({ employee_id: idOf(name), closings: v.closings, weekends: v.weekends })),
    ),
  );
  expect(Object.fromEntries((lastSolve!.carry_over ?? []).map((r) => [r.employee_id, r.shifts])), "요청의 carry_over").toEqual(
    Object.fromEntries(Object.entries(octGrid).map(([name, row]) => [idOf(name), row.slice(-CARRY_OVER_DAYS)])),
  );
  const availIds = (lastSolve!.constraints ?? []).map((c) => c.id).filter((id) => id.startsWith("avail-"));
  // 모두 전일이면 금지할 칸이 없어 규칙이 비어도 맞다. 저장된 매장 조건에는 없어야 한다
  test.info().annotations.push({ type: "가능 시간 규칙 수", description: String(availIds.length) });
  expect(shop.rules.filter((r) => r.id.startsWith("avail-")), "저장된 매장 조건에 가능 시간 규칙 없음").toEqual([]);
  const evidence = page.getByText(/최근 4주 마감 \d+회 → 이번 근무표 \d+회|최근 4주 마감이 많았던 \d+명은 이번 근무표에서 마감을 줄였어요/);
  await expect(evidence).toBeVisible();
  test.info().annotations.push({ type: "최근 4주 근거", description: await evidence.innerText() });
  await expectHardRulesHold(page, NOV, lastSolve);
  const grid = await readGrid(page, NOV);
  expect(grid["이영희"].slice(8, 11)).toEqual(["O", "O", "O"]);
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("확정");
  await expectNoDevTerms(page, "③ 근무표");

  // [확정] → 확정 근무표
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "CSV 받기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "확정", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("확정");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(stepper).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "변경 입력" })).toBeVisible();
  const nov = await periodByStart(page, NOV.start_date);
  expect(nov.versions).toHaveLength(1);
  expect((await readState(page)).view).toEqual({ screen: "confirmed", periodId: nov.id });
  const novLinks = await linkRows(NOV.start_date);
  expect(novLinks).toHaveLength(EMPLOYEE_COUNT);
  expect(novLinks.every((l) => l.locked_at), "확정하면 링크가 잠긴다").toBe(true);
  await expectNoDevTerms(page, "확정 근무표");

  await page.getByRole("button", { name: "← 근무표 목록" }).click();
  await expect(task).toContainText("확정했어요 · 10/28 09:00");
  await expect(task.getByRole("button", { name: "열기" })).toBeVisible();
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("11/30~12/27 근무표 만들기");
  await expectNoDevTerms(page, "매장 홈(확정 후)");
});

test("S4. 확정 근무표: 변경 입력 → 최소 변경 → 다시 확정 · 변경 취소", async () => {
  await sectionWith(OCT_NAME).getByRole("button", { name: "변경 입력" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(OCT_NAME);
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("운영 중");
  await expect(page.getByRole("textbox", { name: "변경 입력" })).toBeFocused();
  await expect(page.getByRole("list", { name: "근무표 작성 단계" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "요청 만들기" })).toHaveClass(/bg-\[#155E75\]/);
  await expect(page.getByRole("button", { name: "CSV 받기" })).toHaveClass(/bg-white/);
  await openStats(page);
  await expect(sectionWith("개인별 통계").locator("tbody tr")).toHaveCount(EMPLOYEE_COUNT);

  // 지난 날짜(10/5~10/27) 잠금
  const lockState = await page.evaluate(() =>
    [...document.querySelectorAll("button[aria-label]")].flatMap((b) => {
      const m = /^(.+) (\d+)월 (\d+)일 [A-Z0-9]{1,3}$/.exec(b.getAttribute("aria-label") ?? "");
      return m ? [{ month: Number(m[2]), dom: Number(m[3]), disabled: b.getAttribute("aria-disabled") === "true", lock: b.querySelector("svg") !== null }] : [];
    }),
  );
  const past = lockState.filter((c) => c.month === 10 && c.dom < 28);
  expect(past).toHaveLength(EMPLOYEE_COUNT * (TODAY - 1));
  expect(past.every((c) => c.disabled && c.lock), "지난 날짜는 잠김").toBe(true);
  expect(lockState.filter((c) => c.month === 10 && c.dom === 28).some((c) => c.disabled), "오늘은 잠기지 않음").toBe(false);
  await page.getByRole("button", { name: `이영희 10월 7일 ${octGrid["이영희"][LEE]}` }).click({ force: true });
  await expect(page.getByRole("button", { name: "A로 고정" })).toHaveCount(0);

  // 병가 입력 → 최소 변경
  const { shop } = await readState(page);
  const idOf = (name: string) => (shop as Shop).employees.find((n) => n.name === name)!.id;
  const choi = idOf("최지훈");
  const cards = await interpretOk(page, "변경 입력", "요청 만들기", "최지훈 10월 28일부터 30일까지 병가");
  const sick = cards.flatMap((c) => (leaveOf(c)?.employee_id === choi ? [leaveOf(c)!] : []));
  expect(sick, "최지훈 병가 카드").toHaveLength(1);
  expect(sick[0].days).toEqual([24, 25, 26]);
  const sickCard = pendingCards(page).filter({ hasText: "최지훈 · 10/28~10/30 · 휴무" });
  await expect(sickCard).toHaveCount(1);
  await expect(sickCard.getByRole("heading", { name: "휴가" })).toBeVisible();
  for (let guard = 0; (await pendingCards(page).count()) > 0; guard++) {
    expect(guard, "대기 카드 적용 반복").toBeLessThan(10);
    expect(await solve(() => pendingCards(page).first().getByRole("button", { name: "적용" }).click())).toBe("ok");
  }

  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expect(page.getByText("작성 중", { exact: true })).toBeVisible();
  await expect(page.getByText("확정본에서 바뀐 칸", { exact: true })).toBeVisible();
  const locks = (lastSolve!.constraints ?? []).filter((c) => c.id.startsWith("lock-"));
  expect(locks, "지난 날짜 잠금이 요청에 들어감").toHaveLength(EMPLOYEE_COUNT * (TODAY - 1));
  const banner = page.getByRole("status").filter({ hasText: "주황 테두리 칸이 바뀐 곳이에요." });
  await expect(banner).toBeVisible();
  const m = /(\d+)\s*명,\s*(\d+)\s*칸 변경/.exec(await banner.innerText());
  expect(m, "변경 요약 문구").toBeTruthy();
  const [changedEmployees, changedCells] = [Number(m![1]), Number(m![2])];

  const after = await readGrid(page, OCT);
  expect(after["최지훈"].slice(TODAY - 1, TODAY + 2)).toEqual(["O", "O", "O"]);
  const diff = gridDiff(octGrid, after);
  test.info().annotations.push({ type: "운영 중 변경 diff", description: JSON.stringify(diff) });
  expect(diff.length).toBe(changedCells);
  expect(new Set(diff.map((d) => d.name)).size).toBe(changedEmployees);
  expect(diff.filter((d) => d.day < TODAY), "지난 날짜는 바뀌지 않음").toEqual([]);
  expect(diff.length, "최소 변경(전체의 10% 이하)").toBeLessThanOrEqual(Math.floor((EMPLOYEE_COUNT * OCT.length) / 10));
  const highlighted = await page.evaluate(() => {
    const re = /^(.+) (\d+)월 (\d+)일 [A-Z0-9]{1,3}$/;
    return [...document.querySelectorAll("button[aria-label]")]
      .filter((b) => re.test(b.getAttribute("aria-label") ?? "") && b.className.includes("inset_0_0_0_2px"))
      .map((b) => {
        const [, name, month, dom] = re.exec(b.getAttribute("aria-label")!)!;
        return { name, month: Number(month), dom: Number(dom) };
      });
  });
  // 10/5가 1일째. 11/1은 28일째
  const key = (name: string, day: number) => `${name}-${day}`;
  expect(highlighted.map((c) => key(c.name, c.month === 10 ? c.dom - 4 : 28)).sort(), "하이라이트 칸 = 바뀐 칸").toEqual(
    diff.map((d) => key(d.name, d.day)).sort(),
  );
  await expectHardRulesHold(page, OCT, lastSolve);
  await expectNoDevTerms(page, "확정 근무표(변경 후)");

  // [다시 확정]
  await expect(page.getByRole("button", { name: "변경 취소" })).toBeVisible();
  await expect(primaryButtons(page).filter({ hasText: "다시 확정" })).toHaveCount(1);
  await page.getByRole("button", { name: "다시 확정" }).click();
  await expect(page.getByRole("button", { name: "다시 확정" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "변경 취소" })).toHaveCount(0);
  const { versions } = await periodByStart(page, OCT.start_date);
  expect(versions).toHaveLength(2);
  expect(versions[1].changed).toHaveLength(changedCells);
  const octFinal = await confirmedGrid(page, OCT.start_date);

  // 다음 근무표(확정): 지난 근무표가 바뀌었다는 배너 → [다시 만들기]로 새 지난 근무 반영
  await page.getByRole("button", { name: "← 근무표 목록" }).click();
  await sectionWith(NOV_NAME).getByRole("button", { name: "열기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOV_NAME);
  const changed = page.getByRole("status").filter({ hasText: "지난 근무표가 바뀌어 이어지는 근무가 달라졌어요. 다시 만들면 반영돼요" });
  await expect(changed).toBeVisible();
  expect(await solve(() => changed.getByRole("button", { name: "다시 만들기" }).click())).toBe("ok");
  await expect(changed).toHaveCount(0);
  const newCarry = Object.fromEntries(Object.entries(octFinal).map(([name, row]) => [idOf(name), row.slice(-CARRY_OVER_DAYS)]));
  expect(Object.fromEntries((lastSolve!.carry_over ?? []).map((r) => [r.employee_id, r.shifts])), "새 carry_over").toEqual(newCarry);
  await expectHardRulesHold(page, NOV, lastSolve);

  // 바뀐 칸이 있으면 [변경 취소]로 마지막 확정본에 돌아가 배너가 다시 뜨고, 다시 만들어 [다시 확정]한다
  const novConfirmed = await confirmedGrid(page, NOV.start_date);
  if (gridDiff(novConfirmed, await readGrid(page, NOV)).length > 0) {
    await expect(page.getByRole("button", { name: "다시 확정" })).toBeVisible();
    await page.getByRole("button", { name: "변경 취소" }).click();
    await expect(page.getByRole("button", { name: "다시 확정" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "변경 취소" })).toHaveCount(0);
    await expect(changed).toBeVisible();
    expect(await readGrid(page, NOV), "변경 취소 → 마지막 확정본").toEqual(novConfirmed);
    expect(await solve(() => changed.getByRole("button", { name: "다시 만들기" }).click())).toBe("ok");
    await page.getByRole("button", { name: "다시 확정" }).click();
    await expect(page.getByRole("button", { name: "다시 확정" })).toHaveCount(0);
    expect((await periodByStart(page, NOV.start_date)).versions).toHaveLength(2);
  } else {
    test.info().annotations.push({ type: "기록", description: "다시 만들기에서 바뀐 칸이 없어 [변경 취소]를 건너뜀" });
  }
  await expectHardRulesHold(page, NOV, lastSolve);
});
