// docs/BROWSER_TEST_SCENARIOS.md S20. 로그인하지 않은 컨텍스트로 /demo를 연다. Supabase와 LLM을 부르지 않고 /solve만 실제로 부른다.
import { expect, test } from "@playwright/test";

import { appliedRuleRows, applyAllPending, expectNoDevTerms, expectNoProblems, pendingRuleRows, T0, trackProblems } from "./test-helpers";

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
  const pending = await pendingRuleRows(page).count();
  expect(pending, "대기 카드").toBeGreaterThan(0);
  await expectNoDevTerms(page, "체험 ② 매장 조건");
  await applyAllPending(page);

  // ③ 근무표 없음 → 저장된 설명과 제안이 바로 보인다
  await page.getByRole("button", { name: /^다음/ }).click();
  await expect(steps.locator('[aria-current="step"]')).toContainText("근무표");
  await page.getByRole("button", { name: "근무표 만들기" }).click();
  const panel = page.locator("section").filter({ hasText: "이 조건으로는 근무표를 만들 수 없어요" });
  await expect(panel.first()).toBeVisible();
  await expect(page.getByText("원인을 분석하는 중…")).toHaveCount(0);
  const proposals = panel.locator("article").filter({ hasText: "이대로 바꾸면 근무표가 나와요" });
  await expect(proposals.first()).toBeVisible();
  // 저장된 설명(LLM 문장)이 보이는 화면이라 개발 용어 검사는 하지 않는다
  await proposals.first().getByRole("button", { name: "수락" }).click();
  await expect(page.getByText("필수 규칙 모두 지킴", { exact: true })).toBeVisible();

  // ① 가능 시간: 모두 제출한 상태, 링크 없음
  await steps.getByRole("button", { name: "가능 시간" }).click();
  await expect(page.getByText(/20\s*명 중\s*20\s*명 제출/)).toBeVisible();
  await page.getByRole("table", { name: "직원별 가능 시간", exact: true }).getByRole("rowheader", { name: /^서민호/ }).getByRole("button").press("Enter");
  await expect(page.getByRole("region", { name: "서민호 가능 시간" })).toBeVisible();
  await expect(page.getByRole("button", { name: "링크 복사" })).toHaveCount(0);
  await expectNoDevTerms(page, "체험 ① 가능 시간");

  // 좁은 화면에서는 패널이 표 아래에 놓이고 가로 넘침은 표 내부에만 생긴다.
  await page.setViewportSize({ width: 375, height: 812 });
  const expectNoPageOverflow = () => expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  await expectNoPageOverflow();
  await steps.getByRole("button", { name: "매장 조건" }).click();
  // 좁은 화면에서는 옆 칸 없이, 누른 카드 바로 아래에 상세가 펼쳐지고 다시 누르면 접힌다
  await expect(page.getByRole("complementary", { name: "규칙 상세" })).toHaveCount(0);
  const ruleRow = appliedRuleRows(page).filter({ hasText: "2일 이상 쉬어요" });
  await ruleRow.click();
  const inlineDetail = page.getByRole("region", { name: "규칙 상세" });
  await expect(inlineDetail).toBeVisible();
  await expectNoPageOverflow();
  await ruleRow.click();
  await expect(inlineDetail).toHaveCount(0);
  await steps.getByRole("button", { name: "근무표" }).click();
  await expect(page.getByRole("complementary", { name: "근무표 확인 패널" })).toBeVisible();
  await expectNoPageOverflow();
  await page.getByRole("navigation").getByRole("button", { name: "매장 설정" }).click();
  await expect(page.getByRole("complementary", { name: "하루 타임라인" })).toBeVisible();
  await expectNoPageOverflow();
  await page.setViewportSize({ width: 1280, height: 800 });

  // 확정 → 예시 병가 → 최소 변경으로 다시 만들기 → 다시 확정 (이 브라우저 안에서만)
  await page.getByRole("navigation").getByRole("button", { name: "근무표" }).click();
  await page.getByRole("button", { name: "근무표 확인하기" }).click();
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await expect(page.getByText("체험이라 직원 링크는 잠그지 않았어요")).toBeVisible();
  await page.getByRole("button", { name: /^예시 넣기/ }).click();
  await expect(page.getByRole("button", { name: "예시 병가를 넣었어요" })).toBeDisabled();
  await page.getByRole("button", { name: "적용", exact: true }).click();
  await expect(page.getByText(/\d+명, \d+칸 변경/)).toBeVisible();
  await page.getByRole("button", { name: "다시 확정" }).click();
  await expect(page.getByText(/바뀐 칸 \d+칸/)).toBeVisible();

  expect(apiPaths.filter((p) => p !== "/api/py/solve"), "체험은 /solve만 부른다").toEqual([]);
  expect(apiPaths.length, "/solve 호출").toBeGreaterThan(0);
  expect(supabaseCalls, "체험은 Supabase를 부르지 않는다").toEqual([]);

  // [나가기] → 랜딩. 다시 열면 처음 상태(저장되지 않음)
  await page.getByRole("button", { name: "나가기" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/demo");
  await expect(page.getByText("체험에서는 말로 적을 수 없어요")).toBeVisible();
  await expect(pendingRuleRows(page)).toHaveCount(pending);
  const stored = await page.evaluate(() => localStorage.getItem("shop-scheduler"));
  expect(stored ?? "", "체험은 저장하지 않는다").not.toContain("한강 다이닝");
});
