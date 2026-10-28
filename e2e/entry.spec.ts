// docs/BROWSER_TEST_SCENARIOS.md S1, S2. 테스트마다 새 브라우저 컨텍스트라 localStorage가 비어 있다.
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-28T09:00:00+09:00"));
});

test("S1. 랜딩에서 앱으로 진입", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.url());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("한 달 근무표를 짭니다");
  const cta = page.getByRole("link", { name: "근무표 만들기" });
  await expect(cta).toHaveAttribute("href", "/app");
  expect(apiCalls, "랜딩은 API를 부르지 않는다").toEqual([]);

  await cta.click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "시작 방법" })).toBeVisible();
  await expect(page.getByRole("button", { name: "이어서 하기" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "샘플로 체험하기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "내 병동으로 시작하기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "홈", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "병동 설정", exact: true })).toHaveCount(0);
});

test("S2. 시작 화면과 입력 삭제 확인", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "샘플로 체험하기" }).click();
  await expect(page.getByRole("heading", { name: "샘플 병동", level: 1 })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("샘플 병동 · 달력 월");
  await expect(page.getByRole("banner")).toContainText("이 브라우저에만 저장");
  await expect(page.getByRole("button", { name: "홈", exact: true })).toHaveAttribute("aria-current", "page");
  const next = page.locator("section").filter({ has: page.getByRole("heading", { name: "다음 기간" }) });
  await expect(next).toContainText("2026.11.1 – 11.30");
  await expect(next.getByText("초안", { exact: true })).toBeVisible();
  await expect(next.getByRole("button", { name: "이어서 작성" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("활성 15명");

  await page.reload();
  await expect(page.getByRole("button", { name: "이어서 하기" })).toBeVisible();
  await expect(page.getByText("병동 홈 · 명단 15명")).toBeVisible();

  const dialog = page.getByRole("dialog", { name: "지금 입력을 지우고 새로 시작할까요?" });
  await page.getByRole("button", { name: "내 병동으로 시작하기" }).click();
  await expect(dialog).toContainText("이 브라우저에 저장된 명단, 규칙, 요청, 근무표가 지워져요. 되돌릴 수 없어요.");
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "시작 방법" })).toBeVisible();

  await page.getByRole("button", { name: "내 병동으로 시작하기" }).click();
  await dialog.getByRole("button", { name: "지우고 시작" }).click();
  await expect(page.getByRole("heading", { name: "병동 설정" })).toBeVisible();
  await expect(page.getByText("아직 명단이 없어요.")).toBeVisible();
  await expect(page.getByLabel("엑셀에서 복사한 명단 붙여넣기 (이름, 연차, 나이트 전담)")).toHaveValue("");
  await expect(page.getByRole("banner")).toContainText("이름 없는 병동 · 달력 월");
});
