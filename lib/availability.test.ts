import { describe, expect, it } from "vitest";

import { availabilityRules, coversShift, type AvailabilitySlots } from "./availability";
import { DEFAULT_CONFIG } from "./rules";
import type { Rule, ShopConfig } from "./types.gen";

const CONFIG: ShopConfig = {
  shifts: [...DEFAULT_CONFIG.shifts, { code: "AC", name: "더블", hours: 12, parts: ["A", "C"] }],
};
const shift = (code: string) => CONFIG.shifts.find((s) => s.code === code)!;
const PERIOD = { start_date: "2026-11-02", length: 3 };
const LEE = { id: "e01", name: "이영희" };
const PARK = { id: "e02", name: "박민수" };
const FULL = [["09:00", "23:00"]] as [string, string][];

/** 규칙이 금지하는 날짜 인덱스. */
const forbiddenDays = (rules: Rule[], id: string) => {
  const body = rules.find((r) => r.id === id)?.body;
  return body?.kind === "require" ? body.for_each.days?.days : undefined;
};

describe("coversShift", () => {
  it("근무조 시각을 완전히 덮어야 한다", () => {
    expect(coversShift([["09:00", "15:00"]], shift("A"), CONFIG)).toBe(true);
    expect(coversShift([["08:00", "16:00"]], shift("A"), CONFIG)).toBe(true);
    expect(coversShift([["09:30", "15:00"]], shift("A"), CONFIG)).toBe(false);
    expect(coversShift([["09:00", "14:30"]], shift("A"), CONFIG)).toBe(false);
    expect(coversShift([], shift("A"), CONFIG)).toBe(false);
  });

  it("이어진 구간은 합쳐서 판단한다(순서 무관)", () => {
    expect(coversShift([["12:00", "15:00"], ["09:00", "12:00"]], shift("A"), CONFIG)).toBe(true);
    expect(coversShift([["09:00", "12:30"], ["12:00", "15:00"]], shift("A"), CONFIG)).toBe(true);
    expect(coversShift([["09:00", "12:00"], ["12:30", "15:00"]], shift("A"), CONFIG)).toBe(false);
  });

  it("24:00까지 덮는 구간도 판단한다", () => {
    const late = { code: "L", name: "늦은 마감", hours: 6, start: "18:00", end: "24:00" };
    expect(coversShift([["18:00", "24:00"]], late, CONFIG)).toBe(true);
    expect(coversShift([["18:00", "23:30"]], late, CONFIG)).toBe(false);
  });

  it("복합 코드는 parts가 모두 덮여야 한다", () => {
    expect(coversShift([["09:00", "15:00"], ["17:00", "23:00"]], shift("AC"), CONFIG)).toBe(true);
    expect(coversShift([["09:00", "15:00"]], shift("AC"), CONFIG)).toBe(false);
  });

  it("휴무는 시각이 없어 언제나 덮인다", () => {
    expect(coversShift([], shift("O"), CONFIG)).toBe(true);
  });
});

describe("availabilityRules", () => {
  it("직원 × 코드마다 덮지 못하는 날을 금지하는 반드시 규칙을 만든다", () => {
    const slots: AvailabilitySlots = { "2026-11-02": FULL, "2026-11-03": [["12:00", "18:00"]] };
    const rules = availabilityRules([LEE], CONFIG, PERIOD, { e01: slots }, []);
    expect(rules.map((r) => r.id)).toEqual(["avail-e01-A", "avail-e01-M", "avail-e01-C", "avail-e01-AC"]);
    expect(forbiddenDays(rules, "avail-e01-A")).toEqual([2, 3]);
    expect(forbiddenDays(rules, "avail-e01-M")).toEqual([3]);
    expect(forbiddenDays(rules, "avail-e01-C")).toEqual([2, 3]);
    expect(forbiddenDays(rules, "avail-e01-AC")).toEqual([2, 3]);
    expect(rules[0]).toMatchObject({
      type: "rule",
      hardness: "hard",
      enabled: true,
      scope: "period",
      source_text: "이영희 가능 시간",
      body: {
        kind: "require",
        for_each: { per: "person", people: { ids: ["e01"] } },
        then: { left: { shifts: { in: ["A"] } }, op: "eq", right: 0 },
      },
    });
  });

  it("다 덮는 코드는 규칙이 없고, 휴무 규칙은 만들지 않는다", () => {
    const allDays: AvailabilitySlots = { "2026-11-02": FULL, "2026-11-03": FULL, "2026-11-04": FULL };
    expect(availabilityRules([LEE], CONFIG, PERIOD, { e01: allDays }, [])).toEqual([]);
  });

  it("가능 시간이 없는 직원은 휴무 말고 모두 금지다", () => {
    const rules = availabilityRules([LEE, PARK], CONFIG, PERIOD, { e01: {} }, []);
    expect(rules.map((r) => r.id)).toEqual([
      ...["A", "M", "C", "AC"].map((c) => `avail-e01-${c}`),
      ...["A", "M", "C", "AC"].map((c) => `avail-e02-${c}`),
    ]);
    expect(forbiddenDays(rules, "avail-e02-M")).toEqual([1, 2, 3]);
    expect(rules.find((r) => r.id === "avail-e02-M")?.source_text).toBe("박민수 가능 시간");
  });

  it("고정 칸은 그 직원의 모든 코드에서 뺀다", () => {
    const fixed = [{ employee_id: "e01", day: 2 }, { employee_id: "e02", day: 1 }];
    const rules = availabilityRules([LEE], CONFIG, PERIOD, { e01: {} }, fixed);
    expect(forbiddenDays(rules, "avail-e01-A")).toEqual([1, 3]);
    expect(forbiddenDays(rules, "avail-e01-AC")).toEqual([1, 3]);
  });

  it("모든 날이 고정이면 규칙이 없다", () => {
    const fixed = [1, 2, 3].map((day) => ({ employee_id: "e01", day }));
    expect(availabilityRules([LEE], CONFIG, PERIOD, { e01: {} }, fixed)).toEqual([]);
  });

  it("꺼진 코드는 배정되지 않으므로 규칙을 만들지 않는다", () => {
    const config = { shifts: CONFIG.shifts.map((s) => (s.code === "M" ? { ...s, active: false } : s)) } as ShopConfig;
    expect(availabilityRules([LEE], config, PERIOD, { e01: {} }, []).map((r) => r.id)).toEqual([
      "avail-e01-A",
      "avail-e01-C",
      "avail-e01-AC",
    ]);
  });
});
