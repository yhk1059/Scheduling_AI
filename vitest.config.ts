import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/는 Playwright가 돌린다. .claude/worktrees/에는 다른 세션의 작업 사본이 있다
    exclude: [...configDefaults.exclude, "e2e/**", ".claude/**"],
  },
});
