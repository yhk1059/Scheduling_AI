import { describe, expect, it } from "vitest";

import { type AvailabilitySlots, coversShift } from "./availability";
import { dateOfDay, isWeekendDay } from "./period";
import { buildScenario, SEED_SCENARIOS, type SeedScenario } from "./seed-scenarios";
import type { Rule } from "./types.gen";

const TODAY = "2026-10-28"; // 수요일

function closers(name: SeedScenario, day: number): string[] {
  const { doc, slots } = buildScenario(name, TODAY);
  const period = doc.state.periods[0];
  const closing = doc.state.shop.config.shifts.find((s) => s.code === "C")!;
  return Object.entries(slots)
    .filter(([, s]) => coversShift(s[dateOfDay(period, day)] ?? [], closing, doc.state.shop.config))
    .map(([id]) => id);
}

const minOf = (name: SeedScenario, id: string) =>
  (buildScenario(name, TODAY).doc.state.shop.rules.find((r) => r.id === id) as Rule | undefined)?.values?.min?.value;

describe("buildScenario", () => {
  it("다섯 버전을 제공한다", () => {
    expect(SEED_SCENARIOS).toEqual(["relaxed", "realistic", "tight", "impossible", "partial"]);
  });

  it.each(SEED_SCENARIOS)("%s: 직원 10명, 다음 월요일부터 1주 작성 중 근무표로 시작한다", (name) => {
    const { doc } = buildScenario(name, TODAY);
    const { shop, periods } = doc.state;
    expect(shop.employees).toHaveLength(10);
    expect(new Set(shop.employees.map((e) => e.id)).size).toBe(10);
    expect(shop.employees.every((e) => e.active)).toBe(true);
    expect(shop.nextEmployeeNo).toBe(11);
    expect(shop.unit).toBe("1w");
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ start_date: "2026-11-02", length: 7, status: "draft", result: null });
  });

  it.each(SEED_SCENARIOS)("%s: 필요 인원을 10명 매장에 맞게 줄이고 문구도 값과 같다", (name) => {
    expect(minOf(name, "cov-weekday-C")).toBe(2);
    expect(minOf(name, "cov-weekend-M")).toBe(1);
    expect(minOf(name, "cov-weekend-C")).toBe(2);
    const rules = buildScenario(name, TODAY).doc.state.shop.rules;
    expect(rules.find((r) => r.id === "cov-weekday-C")?.source_text).toBe("평일 마감은 2명");
    expect(rules.find((r) => r.id === "cov-weekend-M")?.source_text).toBe("주말 미들은 1명");
  });

  it("여유: 전원이 7일 모두 근무조 전체를 덮는다", () => {
    for (let day = 1; day <= 7; day++) expect(closers("relaxed", day)).toHaveLength(10);
  });

  it("현실: 사람마다 가능 시간이 다르고, 모든 날에 마감 가능 인원이 필요 인원 이상이다", () => {
    const { slots } = buildScenario("realistic", TODAY);
    const distinct = new Set(Object.values(slots).map((s: AvailabilitySlots) => JSON.stringify(s)));
    expect(distinct.size).toBeGreaterThanOrEqual(8);
    for (let day = 1; day <= 7; day++) expect(closers("realistic", day).length).toBeGreaterThanOrEqual(2);
  });

  it("빠듯: 마감 가능한 사람이 3명뿐이다", () => {
    for (let day = 1; day <= 7; day++) expect(closers("tight", day)).toHaveLength(3);
  });

  it("불가능: 토요일 마감 가능 인원이 필요 인원보다 적다", () => {
    const { doc } = buildScenario("impossible", TODAY);
    const saturday = 6;
    expect(isWeekendDay(doc.state.periods[0], saturday, [])).toBe(true);
    expect(closers("impossible", saturday)).toHaveLength(1);
    expect(closers("impossible", 5)).toHaveLength(10);
  });

  it("미제출: 7명만 제출하고 리더는 모두 제출한다", () => {
    const { doc, slots } = buildScenario("partial", TODAY);
    expect(Object.keys(slots)).toHaveLength(7);
    const missing = doc.state.shop.employees.filter((e) => !(e.id in slots));
    expect(missing).toHaveLength(3);
    expect(missing.some((e) => e.tags.includes("리더"))).toBe(false);
  });
});
