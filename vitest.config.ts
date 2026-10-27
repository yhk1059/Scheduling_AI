import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/는 Playwright가 돌린다
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
