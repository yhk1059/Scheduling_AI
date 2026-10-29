// docs/BROWSER_TEST_SCENARIOS.md S1, S1-b, S2. 테스트마다 새 브라우저 컨텍스트라 localStorage가 비어 있다.
import { expect, test } from "@playwright/test";

import { expectNoDevTerms, T0 } from "./test-helpers";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(T0);
});

test("S1. 랜딩 → 샘플 데모 → 내 병동", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.url());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/말로 설명한 규칙으로\s*근무표를 짭니다/);
  const sampleCta = page.getByRole("link", { name: "샘플로 체험하기" });
  const ownCta = page.getByRole("link", { name: "내 병동으로 시작하기" });
  await expect(sampleCta).toHaveAttribute("href", "/demo");
  await expect(ownCta).toHaveAttribute("href", "/app?start=new");
  expect(apiCalls, "랜딩은 API를 부르지 않는다").toEqual([]);

  // 샘플 데모: 보기 전용, 저장하지 않음
  await sampleCta.click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { name: "샘플 병동", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "병동 규칙", level: 2 })).toBeVisible();
  await expect(page.getByText("“나이트 끝나면 다음 날은 무조건 쉬게”")).toBeVisible();
  for (const name of ["이영희", "문가람", "배수아"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${name} 11월 1일 [DENO]$`) })).toBeVisible();
  }
  expect(apiCalls, "데모는 API를 부르지 않는다").toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("nurse-scheduler")), "데모는 저장하지 않는다").toBeNull();
  await expectNoDevTerms(page, "샘플 데모");

  // 데모의 [내 병동으로 시작하기] → 처음 설정 ①
  await page.getByRole("link", { name: "내 병동으로 시작하기" }).click();
  await expect(page.getByRole("heading", { name: "처음 설정" })).toBeVisible();
  await expect(page.getByText("아직 명단이 없어요.")).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);

  // 이미 내 병동이 있으면 그대로 들어간다
  await page.goto("/");
  await ownCta.click();
  await expect(page.getByRole("heading", { name: "처음 설정" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("S1-b. 앱을 바로 열면 시작 화면", async ({ page }) => {
  await page.goto("/app");
  const main = page.getByRole("main");
  await expect(page.getByRole("heading", { name: "시작 방법" })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2 })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "이어서 하기" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "샘플로 체험하기" })).toHaveAttribute("href", "/demo");
  await expect(page.getByRole("button", { name: "내 병동으로 시작하기" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Google로 로그인" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "근무표", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "병동 설정", exact: true })).toHaveCount(0);
  await expectNoDevTerms(page, "시작 화면");
});

test("S2. 시작 화면과 입력 삭제 확인", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "내 병동으로 시작하기" }).click();
  await expect(page.getByRole("heading", { name: "처음 설정" })).toBeVisible();
  // 처음 설정 중에는 탭 줄의 [근무표] [병동 설정]을 숨긴다
  await expect(page.getByRole("button", { name: "근무표", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "병동 설정", exact: true })).toHaveCount(0);
  await expect(page.getByRole("banner")).toContainText("이름 없는 병동 · 한 달 단위");
  await expect(page.getByRole("banner")).toContainText("이 브라우저에만 저장");
  await page.getByLabel("병동 이름").fill("내과 병동");

  // 게스트 입력이 있으면 시작 화면 없이 바로 들어간다
  await page.reload();
  await expect(page.getByRole("heading", { name: "처음 설정" })).toBeVisible();
  await page.getByRole("button", { name: "시작 화면" }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "이어서 하기" })).toBeVisible();
  await expect(page.getByText("이 브라우저에 저장된 입력으로 돌아가요. 처음 설정")).toBeVisible();
  await expect(page.getByRole("link", { name: "샘플로 체험하기" })).toHaveAttribute("href", "/demo");
  await expect(main.getByRole("button", { name: "Google로 로그인" })).toHaveCount(0);

  const dialog = page.getByRole("dialog", { name: "지금 입력을 지우고 새로 시작할까요?" });
  await page.getByRole("button", { name: "내 병동으로 시작하기" }).click();
  await expect(dialog).toContainText("이 브라우저에 저장된 명단, 규칙, 요청, 근무표가 지워져요. 되돌릴 수 없어요.");
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "시작 방법" })).toBeVisible();

  await page.getByRole("button", { name: "내 병동으로 시작하기" }).click();
  await dialog.getByRole("button", { name: "지우고 시작" }).click();
  await expect(page.getByRole("heading", { name: "처음 설정" })).toBeVisible();
  await expect(page.getByText("아직 명단이 없어요.")).toBeVisible();
  await expect(page.getByLabel("엑셀에서 복사한 명단 붙여넣기 (이름, 연차, 나이트 전담)")).toHaveValue("");
  await expect(page.getByRole("banner")).toContainText("이름 없는 병동 · 한 달 단위");
  await expectNoDevTerms(page, "처음 설정 ①");

  // 근무표를 만들지 않은 병동은 새로 열어도 처음 설정의 못 끝낸 첫 단계(①)부터 연다
  await page.reload();
  await expect(page.getByRole("heading", { name: "처음 설정" })).toBeVisible();
  await expect(page.getByRole("list", { name: "처음 설정 단계" }).locator('[aria-current="step"]')).toContainText("병동·명단");
});
