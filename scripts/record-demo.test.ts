import { describe, expect, it } from "vitest";

import { buildScenario } from "../lib/seed-scenarios";
import { demoSeed, leaveText, TYPED_RULE } from "./record-demo";

describe("demoSeed", () => {
  it("매장 이름을 바꾸고 영상에서 말로 적을 규칙만 뺀다", () => {
    const { doc } = buildScenario("realistic", "2026-10-28");
    const before = doc.state.shop.rules.length;
    const seeded = demoSeed(doc);
    const { shop } = seeded.state;
    expect(shop.name).toBe("한강 카페");
    expect(shop.rules.map((r) => r.id)).not.toContain(TYPED_RULE.id);
    expect(shop.rules).toHaveLength(before - 1);
    expect(shop.employees).toHaveLength(10);
    expect(seeded.state.periods[0].start_date).toBe("2026-11-02");
  });
});

describe("leaveText", () => {
  it("근무표 둘째·셋째 날 휴가를 말로 적는다", () => {
    expect(leaveText({ start_date: "2026-11-02", length: 7 })).toBe("김철수 11월 3~4일 휴가");
    expect(leaveText({ start_date: "2026-11-30", length: 7 })).toBe("김철수 12월 1~2일 휴가");
  });
});
