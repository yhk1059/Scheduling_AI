import { describe, expect, it } from "vitest";
import { availabilityRules, type AvailabilitySlots } from "./availability";
import { dateOfDay } from "./period";
import { DEFAULT_CONFIG } from "./rules";
import { availabilityShortages, coverageShortages, droppedDays, withoutDays } from "./shortage";
import { ruleShape } from "./rules";
import type { ConstraintSpec } from "./types.gen";
import { count } from "./test-rules";

// 2026-11-23은 월요일. 1=월 … 7=일
const period = { start_date: "2026-11-23", length: 7 };
const employees = [
  { id: "k1", name: "서민호", tags: ["주방", "리더"] },
  { id: "k2", name: "조현우", tags: ["주방", "리더"] },
  { id: "h1", name: "김도현", tags: ["홀", "리더"] },
];
const week = (ranges: AvailabilitySlots[string], skip: number[] = []): AvailabilitySlots =>
  Object.fromEntries([1, 2, 3, 4, 5, 6, 7].filter((d) => !skip.includes(d)).map((d) => [dateOfDay(period, d), ranges]));
const slots = {
  k1: week([["09:00", "23:00"]], [2]), // 화요일은 못 나온다
  k2: week([["09:00", "18:00"]]), // 마감(17~23시)은 못 한다
  h1: week([["09:00", "23:00"]]),
};
const avail = availabilityRules(employees, DEFAULT_CONFIG, period, slots, []);
// 마감에 주방 리더(홀 제외 리더) 1명 이상
const LEAD_PEOPLE = { tags: ["리더"], exclude_tags: ["홀"] };
const kitchenLead = (min: number, days?: { kind: "weekend" }) =>
  count({ people: { tags: ["리더"], exclude_tags: ["홀"] }, days, shifts: { in: ["C"] }, per: "day", min }, { id: "lead" });

describe("coverageShortages", () => {
  it("충돌한 인원 규칙마다 가능 시간으로 채울 수 없는 날과 들어올 수 있는 사람을 찾는다", () => {
    const rule = kitchenLead(1);
    expect(coverageShortages(["lead"], [rule, ...avail], employees, DEFAULT_CONFIG, period, [])).toEqual([
      { constraintId: "lead", day: 2, code: "C", need: 1, names: [], people: LEAD_PEOPLE },
    ]);
  });

  it("필요 인원보다 적게 들어올 수 있는 날은 그 사람들 이름을 함께 준다", () => {
    const rule = kitchenLead(2);
    const days = coverageShortages(["lead"], [rule, ...avail], employees, DEFAULT_CONFIG, period, []);
    expect(days.map((s) => s.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days[0]).toEqual({ constraintId: "lead", day: 1, code: "C", need: 2, names: ["서민호"], people: LEAD_PEOPLE });
    expect(days[1].names).toEqual([]);
  });

  it("규칙의 날짜 고르기를 따른다(주말만이면 토·일만 본다)", () => {
    const rule = kitchenLead(2, { kind: "weekend" });
    expect(coverageShortages(["lead"], [rule, ...avail], employees, DEFAULT_CONFIG, period, []).map((s) => s.day)).toEqual([6, 7]);
  });

  it("충돌에 없는 규칙, 인원 모양이 아닌 규칙은 보지 않는다", () => {
    const rule = kitchenLead(1);
    const notCount = count({ shifts: { in: ["O"] }, per: "person", min: 2 }, { id: "off" });
    expect(coverageShortages([], [rule, ...avail], employees, DEFAULT_CONFIG, period, [])).toEqual([]);
    expect(coverageShortages(["off"], [notCount, ...avail], employees, DEFAULT_CONFIG, period, [])).toEqual([]);
  });

  it("가능 시간으로 모두 채울 수 있으면 빈 배열이다(다른 규칙과 겹쳐서 막힌 경우)", () => {
    const rule = count({ people: { tags: ["홀"] }, shifts: { in: ["C"] }, per: "day", min: 1 }, { id: "hall" });
    expect(coverageShortages(["hall"], [rule, ...avail], employees, DEFAULT_CONFIG, period, [])).toEqual([]);
  });
});

describe("availabilityShortages", () => {
  it("만들기 전에 반드시 인원 규칙 모두를 가능 시간으로 센다", () => {
    expect(availabilityShortages([kitchenLead(1), ...avail], employees, DEFAULT_CONFIG, period, [])).toEqual([
      { constraintId: "lead", day: 2, code: "C", need: 1, names: [], people: LEAD_PEOPLE },
    ]);
  });

  it("아직 내지 않은 직원(pending)은 언제든 나올 수 있다고 센다", () => {
    // 아무도 내지 않으면 가능 시간 규칙은 모두를 막는다
    const none = availabilityRules(employees, DEFAULT_CONFIG, period, {}, []);
    expect(availabilityShortages([kitchenLead(1), ...none], employees, DEFAULT_CONFIG, period, [])).toHaveLength(7);
    expect(availabilityShortages([kitchenLead(1), ...none], employees, DEFAULT_CONFIG, period, [], ["k1", "k2", "h1"])).toEqual([]);
    // 서민호만 냈고(화요일 불가) 조현우는 아직이면, 화요일에 조현우만 들어올 수 있다고 본다
    const partial = availabilityRules(employees, DEFAULT_CONFIG, period, { k1: slots.k1 }, []);
    const out = availabilityShortages([kitchenLead(2), ...partial], employees, DEFAULT_CONFIG, period, [], ["k2", "h1"]);
    expect(out.map((s) => [s.day, s.names])).toEqual([[2, ["조현우"]]]);
  });

  it("가능하면 규칙은 모자라도 경고하지 않는다", () => {
    const soft = { ...kitchenLead(1), hardness: "soft" } as ConstraintSpec;
    expect(availabilityShortages([soft, ...avail], employees, DEFAULT_CONFIG, period, [])).toEqual([]);
  });
});

const daysOf = (c: ConstraintSpec) => {
  const s = ruleShape(c);
  return s?.kind === "count" ? s.days : undefined;
};

describe("withoutDays", () => {
  it("규칙이 고르던 날에서 뺀 날만 남긴다(주말만이면 토·일 중에서)", () => {
    const out = withoutDays(kitchenLead(1), [2], period, []);
    expect(daysOf(out)?.days).toEqual([1, 3, 4, 5, 6, 7]);
    const weekend = withoutDays(kitchenLead(1, { kind: "weekend" }), [7], period, []);
    expect(daysOf(weekend)).toMatchObject({ kind: "weekend", days: [6] });
  });

  it("뺀 날은 더 이상 모자란 날로 잡히지 않고, 원본은 그대로다", () => {
    const rule = kitchenLead(1);
    const out = withoutDays(rule, [2], period, []);
    expect(coverageShortages(["lead"], [out, ...avail], employees, DEFAULT_CONFIG, period, [])).toEqual([]);
    expect(daysOf(rule)?.days).toBeUndefined();
  });
});

describe("droppedDays", () => {
  it("withoutDays로 뺀 날을 원본과 비교해 찾는다(주말만이면 토·일 중에서)", () => {
    const rule = kitchenLead(1);
    expect(droppedDays(rule, withoutDays(rule, [2, 5], period, []), period, [])).toEqual([2, 5]);
    const weekend = kitchenLead(1, { kind: "weekend" });
    expect(droppedDays(weekend, withoutDays(weekend, [7], period, []), period, [])).toEqual([7]);
  });

  it("날을 빼지 않은 수정본이나 날마다 세는 규칙이 아니면 빈 배열이다", () => {
    const rule = kitchenLead(1);
    expect(droppedDays(rule, { ...rule, hardness: "soft" } as ConstraintSpec, period, [])).toEqual([]);
    const notCount = count({ shifts: { in: ["O"] }, per: "person", min: 2 }, { id: "off" });
    expect(droppedDays(notCount, notCount, period, [])).toEqual([]);
  });
});
