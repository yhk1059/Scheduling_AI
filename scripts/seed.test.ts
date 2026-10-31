import { describe, expect, it } from "vitest";

import { buildScenario } from "../lib/seed-scenarios";
import { authStorageKey, linkRows, parseSeedArgs } from "./seed";

describe("parseSeedArgs", () => {
  it("버전과 --no-open을 읽는다", () => {
    expect(parseSeedArgs(["partial"])).toEqual({ scenario: "partial", open: true });
    expect(parseSeedArgs(["--no-open", "tight"])).toEqual({ scenario: "tight", open: false });
  });

  it("없거나 모르는 버전이면 고를 수 있는 목록을 알려 준다", () => {
    expect(() => parseSeedArgs([])).toThrow("relaxed (여유)");
    expect(() => parseSeedArgs(["nope"])).toThrow("partial (미제출)");
  });
});

describe("linkRows", () => {
  it("제출한 직원은 칸과 제출 시각이 있고 미제출 직원은 비어 있다", () => {
    const { doc, slots } = buildScenario("partial", "2026-10-28");
    const rows = linkRows(doc, slots, "shop-1", "2026-10-28T00:00:00.000Z");
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.shop_id === "shop-1" && r.period_start === "2026-11-02" && r.period_length === 7)).toBe(true);
    expect(rows.find((r) => r.employee_name === "이영희")).toMatchObject({ submitted_at: "2026-10-28T00:00:00.000Z" });
    expect(rows.find((r) => r.employee_name === "신도윤")).toMatchObject({ slots: {}, submitted_at: null });
  });
});

describe("authStorageKey", () => {
  it("Supabase 프로젝트 ref로 세션 저장 키를 만든다", () => {
    expect(authStorageKey("https://abc123.supabase.co")).toBe("sb-abc123-auth-token");
  });
});
