// docs/BROWSER_TEST_SCENARIOS.md S20. 로그인하지 않은 컨텍스트로 /demo를 연다. Supabase와 LLM을 부르지 않고 /solve만 실제로 부른다.
import { expect, test } from "@playwright/test";

import { applyAllPending, expectNoDevTerms, expectNoProblems, pendingCards, T0, trackProblems } from "./test-helpers";

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(T0);
  problems = trackProblems(page);
});

test.afterEach(async ({ page }) => {
  await expectNoProblems(page, problems);
});

test("S20. 체험 저니", async ({ page }) => {
  const apiPaths: string[] = [];
  const supabaseCalls: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/")) apiPaths.push(url.pathname);
    if (url.hostname.endsWith(".supabase.co")) supabaseCalls.push(url.pathname);
  });

  await page.goto("/demo");
  const banner = page.getByRole("banner");
  await expect(banner).toContainText("체험 중");
  await expect(banner).toContainText("저장되지 않아요");
  await expect(banner).toContainText("한강 다이닝");
  await expect(page.getByRole("status").filter({ hasText: "샘플 매장 한강 다이닝을 눌러 보고 있어요" })).toBeVisible();

  // ② 매장 조건: 입력 바 대신 안내, 대기 카드가 있다
  const steps = page.getByRole("list", { name: "근무표 작성 단계" });
  await expect(steps.locator('[aria-current="step"]')).toContainText("매장 조건");
  await expect(page.getByText("체험에서는 말로 적을 수 없어요")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "매장 조건 입력" })).toHaveCount(0);
  const pending = await pendingCards(page).count();
  expect(pending, "대기 카드").toBeGreaterThan(0);
  await expectNoDevTerms(page, "체험 ② 매장 조건");
  await applyAllPending(page);

  // ③ 근무표 없음 → 저장된 설명과 제안이 바로 보인다
  await page.getByRole("button", { name: "다음" }).click();
  await expect(steps.locator('[aria-current="step"]')).toContainText("근무표");
  await page.getByRole("button", { name: "근무표 만들기" }).click();
  const panel = page.locator("section").filter({ hasText: "이 조건으로는 근무표를 만들 수 없어요" });
  await expect(panel.first()).toBeVisible();
  await expect(page.getByText("원인을 분석하는 중…")).toHaveCount(0);
  const proposals = panel.locator("article").filter({ hasText: "검증됨" });
  await expect(proposals.first()).toBeVisible();
  // 저장된 설명(LLM 문장)이 보이는 화면이라 개발 용어 검사는 하지 않는다
  await proposals.first().getByRole("button", { name: "수락" }).click();
  await expect(page.getByText("반드시 규칙을 모두 지켰어요", { exact: true })).toBeVisible();

  // [확정]은 체험 안내로
  await page.getByRole("button", { name: "확정", exact: true }).click();
  const gate = page.getByRole("dialog", { name: "확정은 내 매장에서 할 수 있어요" });
  await expect(gate).toBeVisible();
  await expect(gate.getByRole("button", { name: "내 매장으로 시작하기" })).toBeVisible();
  await gate.getByRole("button", { name: "닫기" }).click();
  await expect(gate).toHaveCount(0);

  // ① 가능 시간: 모두 제출한 상태, 링크 없음
  await steps.getByRole("button", { name: "가능 시간" }).click();
  await expect(page.getByText(/20\s*명 중\s*20\s*명 제출/)).toBeVisible();
  await expect(page.getByRole("region", { name: "서민호 가능 시간" })).toBeVisible();
  await expect(page.getByRole("button", { name: "링크 복사" })).toHaveCount(0);
  await expectNoDevTerms(page, "체험 ① 가능 시간");

  expect(apiPaths.filter((p) => p !== "/api/py/solve"), "체험은 /solve만 부른다").toEqual([]);
  expect(apiPaths.length, "/solve 호출").toBeGreaterThan(0);
  expect(supabaseCalls, "체험은 Supabase를 부르지 않는다").toEqual([]);

  // [나가기] → 랜딩. 다시 열면 처음 상태(저장되지 않음)
  await page.getByRole("button", { name: "나가기" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/demo");
  await expect(page.getByText("체험에서는 말로 적을 수 없어요")).toBeVisible();
  await expect(pendingCards(page)).toHaveCount(pending);
  const stored = await page.evaluate(() => localStorage.getItem("shop-scheduler"));
  expect(stored ?? "", "체험은 저장하지 않는다").not.toContain("한강 다이닝");
});
