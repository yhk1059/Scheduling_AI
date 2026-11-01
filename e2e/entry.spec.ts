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

test("S1. 랜딩 → 데모 영상 → 로그인 → 매장 준비", async ({ page }) => {
  const apiCalls: string[] = [];
  const onRequest = (r: { url: () => string }) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.url());
  };
  page.on("request", onRequest);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/말로 설명하면,\s*근무표가 나옵니다/);
  const demoCta = page.getByRole("button", { name: "데모 영상 보기" });
  const ownCta = page.getByRole("link", { name: "내 매장으로 시작하기" });
  // 첫 화면과 CTA 띠에 같은 버튼이 있고, [내 매장으로 시작하기]는 모두 앱으로 간다
  await expect(demoCta).toHaveCount(2);
  for (const link of await ownCta.all()) await expect(link).toHaveAttribute("href", "/app");

  // 데모 영상: 대화상자로 열리고 Esc로 닫힌다. 페이지 이동과 저장이 없다
  await demoCta.first().click();
  const dialog = page.getByRole("dialog", { name: "데모 영상" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("video")).toHaveAttribute("src", "/demo.mp4");
  await expect(dialog.getByRole("button", { name: "닫기" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(demoCta.first()).toBeFocused();
  expect(new URL(page.url()).pathname).toBe("/");
  page.off("request", onRequest);
  expect(apiCalls, "랜딩과 데모 영상은 API를 부르지 않는다").toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("shop-scheduler")), "랜딩은 저장하지 않는다").toBeNull();

  // 로그인하지 않았으면 로그인 화면
  await page.getByRole("link", { name: "내 매장으로 시작하기" }).first().click();
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/app");
  await expectNoDevTerms(page, "로그인 화면");

  await loginAsTestUser(page);
  await expect(setupHeading(page)).toBeVisible();
  await expect(page.getByText("아직 명단이 없어요.")).toBeVisible();

  // 이미 로그인했으니 로그인 화면 없이 들어간다
  await page.goto("/");
  await ownCta.first().click();
  await expect(setupHeading(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toHaveCount(0);
});

test("S1-b. 앱을 로그인 없이 열면 로그인 화면", async ({ page }) => {
  await page.goto("/app");
  const login = page.getByRole("button", { name: "Google로 로그인" });
  await expect(login).toBeVisible();
  await expect(login).toHaveClass(/bg-\[#155E75\]/);
  await expect(page.getByRole("button", { name: "데모 영상 보기" })).toHaveCount(2);
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
