// docs/BROWSER_TEST_SCENARIOS.md S1, S1-b, S2. 테스트마다 새 브라우저 컨텍스트라 로그인하지 않은 상태로 시작한다.
import { expect, type Page, test } from "@playwright/test";

import { clearAccount, expectNoDevTerms, expectNoProblems, expectSaved, loginAsTestUser, savedDoc, T0, testEmail, trackProblems } from "./test-helpers";

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  await clearAccount();
  await page.clock.setFixedTime(T0);
  problems = trackProblems(page);
});

test.afterEach(async ({ page }) => {
  await expectNoProblems(page, problems);
});

const setupHeading = (page: Page) => page.getByRole("heading", { name: "매장 준비" });

test("S1. 랜딩 → 샘플 데모 → 로그인 → 매장 준비", async ({ page }) => {
  const apiCalls: string[] = [];
  const onRequest = (r: { url: () => string }) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.url());
  };
  page.on("request", onRequest);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/말로 설명한 규칙으로\s*근무표를 짭니다/);
  const sampleCta = page.getByRole("link", { name: "샘플로 체험하기" });
  const ownCta = page.getByRole("link", { name: "내 매장으로 시작하기" });
  await expect(sampleCta).toHaveAttribute("href", "/demo");
  await expect(ownCta).toHaveAttribute("href", "/app");

  // 샘플 데모: 보기 전용, 저장하지 않음
  await sampleCta.click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { name: "샘플 매장", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "매장 조건", level: 2 })).toBeVisible();
  // 랜딩 조각도 같은 샘플 규칙을 보여 주고, 지나온 랜딩은 숨겨진 채 DOM에 남을 수 있어 main 안에서 찾는다
  await expect(page.getByRole("main").getByText("“마감 다음 날 오픈은 안 되게”")).toBeVisible();
  for (const name of ["이영희", "강서연", "신도윤"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${name} 11월 2일 [AMCO]$`) })).toBeVisible();
  }
  page.off("request", onRequest);
  expect(apiCalls, "랜딩과 데모는 API를 부르지 않는다").toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("shop-scheduler")), "데모는 저장하지 않는다").toBeNull();
  await expectNoDevTerms(page, "샘플 데모");

  // 로그인하지 않았으면 로그인 화면
  await page.getByRole("link", { name: "내 매장으로 시작하기" }).click();
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/app");
  await expectNoDevTerms(page, "로그인 화면");

  await loginAsTestUser(page);
  await expect(setupHeading(page)).toBeVisible();
  await expect(page.getByText("아직 명단이 없어요.")).toBeVisible();

  // 이미 로그인했으니 로그인 화면 없이 들어간다
  await page.goto("/");
  await ownCta.click();
  await expect(setupHeading(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toHaveCount(0);
});

test("S1-b. 앱을 로그인 없이 열면 로그인 화면", async ({ page }) => {
  await page.goto("/app");
  const login = page.getByRole("button", { name: "Google로 로그인" });
  await expect(login).toBeVisible();
  await expect(login).toHaveClass(/bg-\[#155E75\]/);
  await expect(page.getByRole("link", { name: "샘플로 체험하기" })).toHaveAttribute("href", "/demo");
  await expect(page.getByRole("link", { name: "개인정보처리방침" })).toBeVisible();
  await expect(page.getByRole("button", { name: "근무표", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "매장 설정", exact: true })).toHaveCount(0);
  await expectNoDevTerms(page, "로그인 화면");
});

test("S2. 매장 준비: 저장과 다시 로그인", async ({ page }) => {
  await page.goto("/app");
  await loginAsTestUser(page);

  await expect(setupHeading(page)).toBeVisible();
  await expect(page.getByRole("list", { name: "근무표 작성 단계" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "근무표", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "매장 설정", exact: true })).toHaveCount(0);
  const banner = page.getByRole("banner");
  await expect(banner).toContainText("이름 없는 매장 · 1주 단위");
  await expect(banner).toContainText(testEmail());
  await expect(page.getByRole("button", { name: "첫 근무표 시작하기" })).toBeDisabled();
  await expect(page.getByText("명단에 직원을 1명 이상 넣으면 시작할 수 있어요")).toBeVisible();

  const shopName = page.getByRole("textbox", { name: "매장 이름" });
  await shopName.fill("한강 카페");
  await expect(banner).toContainText("한강 카페 · 1주 단위");
  await expectSaved(page);
  await expect(banner).toContainText(/저장됨\s*\d{2}:\d{2}/);

  await page.reload();
  await expect(setupHeading(page)).toBeVisible();
  await expect(shopName).toHaveValue("한강 카페");
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toHaveCount(0);

  await page.getByRole("button", { name: "계정 메뉴" }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible();
  await expect(page.getByText("한강 카페")).toHaveCount(0);

  await loginAsTestUser(page);
  await expect(setupHeading(page)).toBeVisible();
  await expect(shopName).toHaveValue("한강 카페"); // 서버에서 불러온다

  expect((await savedDoc())?.state.shop.name).toBe("한강 카페");
  await expect(page.getByRole("textbox", { name: "1행 이름", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "새 직원 이름" })).toHaveValue("");
  await expectNoDevTerms(page, "매장 준비");
});
