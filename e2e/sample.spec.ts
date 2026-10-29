// docs/BROWSER_TEST_SCENARIOS.md S3, S4. 샘플 병동(오늘 2026-10-28 기준: 10월 운영 중 + 11월 작성 중)을 이어 쓰는 흐름이라
// 페이지 하나를 공유하며 순서대로 돈다. 게스트 모드만 다룬다(ADR-014). LLM은 mock하지 않는다(ADR-013).
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import type { PeriodRange } from "../lib/period";
import type { HistoryLoad, ScheduleRequest } from "../lib/types.gen";
import {
  CARRY_OVER_DAYS,
  confirmedGrid,
  expectedHistory,
  expectHardRulesHold,
  expectNoDevTerms,
  type Grid,
  gridDiff,
  interpretOk,
  NURSE_COUNT,
  pendingCards,
  periodByStart,
  primaryButtons,
  readCarryOver,
  readGrid,
  readHistoryColumns,
  readState,
  scheduleTitle,
  solveVia,
  T0,
  appliedCards,
} from "./test-helpers";

const OCT: PeriodRange = { start_date: "2026-10-01", length: 31 };
const NOV: PeriodRange = { start_date: "2026-11-01", length: 30 };
const TODAY = 28; // 10/28
const HISTORY_FROM = 4; // 11/1 직전 28일 = 10/4~10/31

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let problems: string[] = [];
let lastSolve: ScheduleRequest | undefined;
let octGrid: Grid;

const sectionWith = (heading: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

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

async function solve(action: () => Promise<void>) {
  const { status, request } = await solveVia(page, action);
  lastSolve = request;
  return status;
}

test("S3. 샘플 체험: 다음 근무표 만들기와 게스트 확정", async () => {
  const apiCalls: string[] = [];
  const onRequest = (r: { url: () => string }) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.url());
  };
  page.on("request", onRequest);
  await page.goto("/app");
  await page.getByRole("button", { name: "샘플로 체험하기" }).click();

  // 병동 홈
  await expect(page.getByRole("heading", { name: "샘플 병동", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("간호사 15명 · 병동 규칙 6개 · 한 달 단위");
  const operating = sectionWith("10월 근무표");
  await expect(operating.getByText("운영 중", { exact: true })).toBeVisible();
  await expect(operating).toContainText("2026.10.1 – 10.31");
  await expect(operating).toContainText("마지막 확정 9/30 18:00");
  await expect(operating.getByRole("button", { name: "열기" })).toBeVisible();
  const task = sectionWith("11월 근무표");
  await expect(task).toContainText("2026.11.1 – 11.30");
  await expect(task).toContainText("요청 3개를 넣었어요. 아직 근무표를 만들지 않았어요");
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("이어서 하기");
  await expect(page.getByText("확정한 근무표가 여기에 쌓여요.")).toBeVisible();
  page.off("request", onRequest);
  expect(apiCalls, "샘플을 열 때 API를 부르지 않는다").toEqual([]);
  await expectNoDevTerms(page, "샘플 병동 홈");
  octGrid = await confirmedGrid(page, OCT.start_date);

  // ① 준비: 지난 근무 마지막 며칠(10월 확정본에서)
  await task.getByRole("button", { name: "이어서 하기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("11월 근무표");
  await expect(page.getByText("작성 중", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "준비", exact: true })).toBeVisible();
  await expect(sectionWith("명단 확인")).toContainText("간호사 15명 · 지난 근무표와 명단이 같아요");
  await expect(page.getByRole("heading", { name: "지난 근무 마지막 며칠", exact: true })).toBeVisible();
  const carry = await readCarryOver(page, OCT);
  for (const [name, row] of Object.entries(octGrid)) expect(carry[name], `${name} 지난 근무`).toEqual(row.slice(-CARRY_OVER_DAYS));
  await expectNoDevTerms(page, "① 준비");

  // ② 요청: 샘플 요청 3개가 적용된 상태
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "요청", exact: true })).toBeVisible();
  await expect(pendingCards(page)).toHaveCount(0);
  await expect(appliedCards(page)).toHaveCount(3);
  for (const summary of ["이영희 · 11/10~11/12 · 휴무", "박민수 · 주말·공휴일 · 나이트 피하기", "정유진 · 11/20 · 데이 희망"]) {
    await expect(appliedCards(page).filter({ hasText: summary })).toHaveCount(1);
  }
  await expect(page.getByRole("heading", { name: "이 근무표에 적용되는 병동 규칙" })).toBeVisible();
  await expectNoDevTerms(page, "② 요청");

  // ③ 근무표 만들기: 최근 4주 열과 근거 한 줄
  await page.getByRole("button", { name: "다음" }).click();
  await expect(scheduleTitle(page)).toBeVisible();
  await expect(page.getByText("적용한 규칙과 요청으로 근무표를 만들어요.")).toBeVisible();
  expect(await solve(() => page.getByRole("button", { name: "근무표 만들기" }).click())).toBe("ok");
  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expect(page.getByText("희망 반영", { exact: true })).toBeVisible();
  await expect(page.getByText("못 지킨 규칙", { exact: true })).toBeVisible();
  const stats = sectionWith("개인별 통계");
  await expect(stats.locator("tbody tr")).toHaveCount(NURSE_COUNT);
  for (const h of ["최근 4주 나이트", "최근 4주 주말", "평균보다 많은 근무일"]) {
    await expect(stats.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
  }

  const { ward } = await readState(page);
  const idOf = (name: string) => ward.nurses.find((n) => n.name === name)!.id;
  const expected = expectedHistory(octGrid, OCT, [], HISTORY_FROM);
  expect(await readHistoryColumns(page), "최근 4주 열").toEqual(expected);
  const byId = (list: HistoryLoad[]) => [...list].sort((a, b) => a.nurse_id.localeCompare(b.nurse_id));
  expect(byId(lastSolve!.history_load ?? []), "요청의 history_load").toEqual(
    byId(
      Object.entries(expected)
        .filter(([, v]) => v.nights > 0 || v.weekends > 0)
        .map(([name, v]) => ({ nurse_id: idOf(name), ...v })),
    ),
  );
  expect(Object.fromEntries((lastSolve!.carry_over ?? []).map((r) => [r.nurse_id, r.shifts])), "요청의 carry_over").toEqual(
    Object.fromEntries(Object.entries(octGrid).map(([name, row]) => [idOf(name), row.slice(-CARRY_OVER_DAYS)])),
  );
  const evidence = page.getByText(
    /최근 4주 나이트 \d+회 → 이번 근무표 \d+회|최근 4주 나이트가 많았던 \d+명은 이번 근무표에서 나이트를 줄였어요/,
  );
  await expect(evidence).toBeVisible();
  test.info().annotations.push({ type: "최근 4주 근거", description: await evidence.innerText() });
  await expectHardRulesHold(page, NOV, lastSolve);
  const grid = await readGrid(page, NOV);
  expect(grid["이영희"].slice(9, 12)).toEqual(["O", "O", "O"]);
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("확정");
  await expectNoDevTerms(page, "③ 근무표(작성 중)");

  // [확정](게스트) → 저장 안내 배너
  await page.getByRole("button", { name: "확정", exact: true }).click();
  const banner = page.getByRole("status").filter({ hasText: "확정했어요. 이 브라우저에만 저장돼 있어요" });
  await expect(banner).toBeVisible();
  expect(await banner.getByRole("button").count(), "배너 버튼은 최대 하나").toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "확정", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "CSV 받기" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("확정");
  await expect(page.getByRole("textbox", { name: "운영 중 변경 입력" })).toBeVisible();
  expect((await periodByStart(page, NOV.start_date)).versions).toHaveLength(1);
  await expectNoDevTerms(page, "③ 근무표(확정)");

  // 홈: [12월 근무표 만들기]가 유일한 Primary
  await page.getByRole("button", { name: "← 근무표 목록" }).click();
  await expect(task).toContainText("확정했어요 · 10/28 09:00");
  await expect(task.getByRole("button", { name: "열기" })).toBeVisible();
  await expect(primaryButtons(page)).toHaveCount(1);
  await expect(primaryButtons(page)).toHaveText("12월 근무표 만들기");
  await expect(sectionWith("10월 근무표")).toBeVisible();
  await expectNoDevTerms(page, "샘플 병동 홈(11월 확정 후)");
});

test("S4. 샘플 운영 중 변경 → 최소 변경 → 다시 확정 → 다음 근무표 배너", async () => {
  await sectionWith("10월 근무표").getByRole("button", { name: "열기" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("10월 근무표");
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("운영 중");
  await expect(scheduleTitle(page)).toBeVisible();
  await expect(primaryButtons(page)).toHaveCount(1); // [요청 만들기]만. [CSV 받기]는 Secondary
  await expect(page.getByRole("button", { name: "CSV 받기" })).toBeVisible();

  // 지난 날짜(10/1~10/27) 잠금
  const lockState = await page.evaluate(() =>
    [...document.querySelectorAll("button[aria-label]")].flatMap((b) => {
      const m = /^(.+) 10월 (\d+)일 [DENO]$/.exec(b.getAttribute("aria-label") ?? "");
      return m ? [{ day: Number(m[2]), disabled: b.getAttribute("aria-disabled") === "true", lock: b.querySelector("svg") !== null }] : [];
    }),
  );
  const past = lockState.filter((c) => c.day < TODAY);
  expect(past).toHaveLength(NURSE_COUNT * (TODAY - 1));
  expect(past.every((c) => c.disabled && c.lock), "지난 날짜는 잠김").toBe(true);
  expect(lockState.filter((c) => c.day === TODAY).some((c) => c.disabled), "오늘(10/28)은 잠기지 않음").toBe(false);
  await page.getByRole("button", { name: `이영희 10월 3일 ${octGrid["이영희"][2]}` }).click({ force: true });
  await expect(page.getByRole("button", { name: "D로 고정" })).toHaveCount(0);

  // 병가 입력 → 최소 변경
  const { ward } = await readState(page);
  const choi = ward.nurses.find((n) => n.name === "최지훈")!.id;
  const cards = await interpretOk(page, "운영 중 변경 입력", "요청 만들기", "최지훈 10월 28일부터 30일까지 병가");
  const sick = cards.filter((c) => c.type === "leave" && c.params.nurse_id === choi);
  expect(sick, "최지훈 병가 카드").toHaveLength(1);
  if (sick[0].type === "leave") expect(sick[0].params.days).toEqual([28, 29, 30]);
  await expect(pendingCards(page).filter({ hasText: "최지훈 · 10/28~10/30 · 휴무" })).toHaveCount(1);
  for (let guard = 0; (await pendingCards(page).count()) > 0; guard++) {
    expect(guard, "대기 카드 적용 반복").toBeLessThan(10);
    expect(await solve(() => pendingCards(page).first().getByRole("button", { name: "적용" }).click())).toBe("ok");
  }

  await expect(page.getByText("규칙을 모두 지켰어요", { exact: true })).toBeVisible();
  await expect(page.getByText("작성 중", { exact: true })).toBeVisible();
  await expect(page.getByText("확정본에서 바뀐 칸", { exact: true })).toBeVisible();
  const locks = (lastSolve!.constraints ?? []).filter((c) => c.id.startsWith("lock-"));
  expect(locks, "지난 날짜 잠금이 요청에 들어감").toHaveLength(NURSE_COUNT * (TODAY - 1));
  const banner = page.getByRole("status").filter({ hasText: "확정본 대비" });
  await expect(banner).toContainText("주황 테두리 칸이 바뀐 곳이에요.");
  const m = /확정본 대비\s*(\d+)\s*명,\s*(\d+)\s*칸 변경/.exec(await banner.innerText());
  expect(m, "변경 요약 문구").toBeTruthy();
  const [changedNurses, changedCells] = [Number(m![1]), Number(m![2])];

  const after = await readGrid(page, OCT);
  expect(after["최지훈"].slice(TODAY - 1, TODAY + 2)).toEqual(["O", "O", "O"]);
  const diff = gridDiff(octGrid, after);
  test.info().annotations.push({ type: "운영 중 변경 diff", description: JSON.stringify(diff) });
  expect(diff.length).toBe(changedCells);
  expect(new Set(diff.map((d) => d.name)).size).toBe(changedNurses);
  expect(diff.filter((d) => d.day < TODAY), "지난 날짜는 바뀌지 않음").toEqual([]);
  expect(diff.length, "최소 변경(전체의 10% 이하)").toBeLessThanOrEqual((NURSE_COUNT * OCT.length) / 10);
  const highlighted = await page.evaluate(() => {
    const re = /^(.+) 10월 (\d+)일 [DENO]$/;
    return [...document.querySelectorAll("button[aria-label]")]
      .filter((b) => re.test(b.getAttribute("aria-label") ?? "") && b.className.includes("inset_0_0_0_2px"))
      .map((b) => {
        const [, name, day] = re.exec(b.getAttribute("aria-label")!)!;
        return { name, day: Number(day) };
      });
  });
  const key = (c: { name: string; day: number }) => `${c.name}-${c.day}`;
  expect(highlighted.map(key).sort(), "하이라이트 칸 = 바뀐 칸").toEqual(diff.map(key).sort());
  await expectHardRulesHold(page, OCT, lastSolve);
  await expectNoDevTerms(page, "③ 운영 중 변경 후");

  // [다시 확정]
  await expect(primaryButtons(page).filter({ hasText: "다시 확정" })).toHaveCount(1);
  await page.getByRole("button", { name: "다시 확정" }).click();
  await expect(page.getByRole("button", { name: "다시 확정" })).toHaveCount(0);
  const { versions } = await periodByStart(page, OCT.start_date);
  expect(versions).toHaveLength(2);
  expect(versions[1].changed).toHaveLength(changedCells);
  const octFinal = await confirmedGrid(page, OCT.start_date);

  // 11월: 지난 근무표가 바뀌었다는 배너 → 다시 만들면 새 지난 근무로 반영
  await page.getByRole("button", { name: "← 근무표 목록" }).click();
  await sectionWith("11월 근무표").getByRole("button", { name: "열기" }).click();
  const changed = page.getByRole("status").filter({ hasText: "지난 근무표가 바뀌어 이어지는 근무가 달라졌어요. 다시 만들면 반영돼요" });
  await expect(changed).toBeVisible();
  const stepper = page.getByRole("list", { name: "기간 작업 단계" });
  await stepper.getByRole("button", { name: "준비", exact: true }).click();
  await expect(changed).toBeVisible();
  const carry = await readCarryOver(page, OCT);
  for (const [name, row] of Object.entries(octFinal)) expect(carry[name], `${name} 지난 근무`).toEqual(row.slice(-CARRY_OVER_DAYS));
  await stepper.getByRole("button", { name: "근무표", exact: true }).click();
  expect(await solve(() => changed.getByRole("button", { name: "다시 만들기" }).click())).toBe("ok");
  await expect(changed).toHaveCount(0);
  const idOf = (name: string) => ward.nurses.find((n) => n.name === name)!.id;
  expect(Object.fromEntries((lastSolve!.carry_over ?? []).map((r) => [r.nurse_id, r.shifts])), "새 carry_over").toEqual(
    Object.fromEntries(Object.entries(octFinal).map(([name, row]) => [idOf(name), row.slice(-CARRY_OVER_DAYS)])),
  );
  await expectHardRulesHold(page, NOV, lastSolve);
});
