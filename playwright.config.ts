import { defineConfig, devices } from "@playwright/test";

// 브라우저 e2e. 시나리오는 docs/BROWSER_TEST_SCENARIOS.md. 실제 Anthropic API와 테스트 Supabase를 쓰므로 .env.local의 키가 필요하다.
process.loadEnvFile(".env.local");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // LLM 해석·설명과 솔버 재풀이가 여러 번 들어가는 시나리오가 있다
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    // 테스트 로그인 경로는 여기서만 켠다(lib/supabase.ts). .env.local에 두면 로컬 프로덕션 빌드에도 들어간다
    { command: "npm run next-dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000, env: { NEXT_PUBLIC_E2E_LOGIN: "1" } },
    {
      command: "npm run fastapi-dev",
      url: "http://127.0.0.1:8000/api/py/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
