// docs/BROWSER_TEST_SCENARIOS.md S1, S2. 테스트마다 새 브라우저 컨텍스트라 localStorage가 비어 있다.
import { expect, test } from "@playwright/test";

const OVERWRITE_MESSAGE = "지금까지 입력한 명단, 규칙, 요청, 근무표가 지워져요. 계속할까요?";

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
  await expect(page.getByRole("button", { name: "샘플 불러오기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "새로 시작" })).toBeVisible();
});

test("S2. 시작 방법과 입력 삭제 확인", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "샘플 불러오기" }).click();
  await expect(page.getByRole("heading", { name: "병동 준비" })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("로테이션 15명");

  await page.reload();
  await expect(page.getByRole("button", { name: "이어서 하기" })).toBeVisible();
  await expect(page.getByText("병동 단계 · 명단 15명")).toBeVisible();

  const messages: string[] = [];
  page.once("dialog", (d) => {
    messages.push(d.message());
    void d.dismiss();
  });
  await page.getByRole("button", { name: "새로 시작" }).click();
  await expect(page.getByRole("heading", { name: "시작 방법" })).toBeVisible();

  page.once("dialog", (d) => {
    messages.push(d.message());
    void d.accept();
  });
  await page.getByRole("button", { name: "새로 시작" }).click();
  await expect(page.getByRole("heading", { name: "병동 준비" })).toBeVisible();

  expect(messages).toEqual([OVERWRITE_MESSAGE, OVERWRITE_MESSAGE]);
  await expect(page.getByRole("banner")).not.toContainText("로테이션");
  await expect(page.getByLabel("엑셀에서 복사한 명단 붙여넣기 (이름, 연차, 나이트 전담)")).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "이름 열" })).toHaveCount(0);
});
