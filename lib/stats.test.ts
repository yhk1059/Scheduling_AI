import { describe, expect, it } from "vitest";

import { DEN_CONFIG } from "./test-rules";
import { closingSpread, statsFromAssignments } from "./stats";
import type { ShopConfig } from "./types.gen";

// 2026-11-01 일요일. 7일: 일 월 화 수 목 금 토
const WEEK = { start_date: "2026-11-01", length: 7 };
const row = (s: string) => s.split("");

describe("statsFromAssignments", () => {
  it("코드별 수, 근무 시간, 주말·공휴일 근무, 최대 연속 근무, 편차(근무일 - 평균)", () => {
    const stats = statsFromAssignments({ e01: row("DDENOON"), e02: row("OOOOOOD") }, DEN_CONFIG, WEEK, [3]);
    expect(stats.e01).toEqual({
      counts: { D: 2, E: 1, N: 2, O: 2 },
      hours: 40,
      weekend_holiday_work: 3, // 1일(일) D, 3일(공휴일) E, 7일(토) N
      max_consecutive_work: 4,
      preference_rate: null,
      deviation: 2,
    });
    expect(stats.e02).toMatchObject({ counts: { D: 1, E: 0, N: 0, O: 6 }, hours: 8, weekend_holiday_work: 1, max_consecutive_work: 1, deviation: -2 });
  });

  it("꺼진 코드는 배정에 있을 때만 세고, 복합 코드 시간은 그 코드의 시간이다", () => {
    const config: ShopConfig = {
      shifts: [
        ...DEN_CONFIG.shifts,
        { code: "M", name: "미드", hours: 8, active: false },
        { code: "DE", name: "더블", hours: 16, parts: ["D", "E"] },
      ],
    } as ShopConfig;
    const stats = statsFromAssignments({ e01: row("OOOOOOO"), e02: ["DE", "M", "O", "O", "O", "O", "O"] }, config, WEEK, []);
    expect(stats.e01.counts).toEqual({ D: 0, E: 0, N: 0, O: 7, DE: 0 });
    expect(stats.e02.counts).toEqual({ D: 0, E: 0, N: 0, O: 5, M: 1, DE: 1 });
    expect(stats.e02.hours).toBe(24);
    expect(stats.e02.max_consecutive_work).toBe(2);
  });

  it("평균이 정수가 아니면 소수 둘째 자리로 반올림한다", () => {
    const stats = statsFromAssignments({ a: row("DOOOOOO"), b: row("OOOOOOO"), c: row("OOOOOOO") }, DEN_CONFIG, WEEK, []);
    expect(stats.a.deviation).toBe(0.67);
    expect(stats.b.deviation).toBe(-0.33);
  });
});

describe("closingSpread", () => {
  const SHOP: ShopConfig = {
    shifts: [
      { code: "A", name: "오픈", hours: 6 },
      { code: "C", name: "마감", hours: 6 },
      { code: "O", name: "휴무", hours: 0 },
      { code: "AC", name: "더블", hours: 12, parts: ["A", "C"] },
      { code: "AM", name: "오픈미들", hours: 12, parts: ["A", "M"] },
    ],
  } as ShopConfig;

  it("직원마다 마감 수의 가장 적음과 가장 많음을 센다", () => {
    expect(closingSpread({ a: ["C", "C", "O"], b: ["A", "C", "O"], c: ["A", "A", "O"] }, SHOP, ["a", "b", "c"])).toEqual({ min: 0, max: 2 });
  });

  it("복합 코드는 마감을 셀 때만 더한다", () => {
    expect(closingSpread({ a: ["AC", "C"], b: ["AM", "AC"] }, SHOP, ["a", "b"])).toEqual({ min: 1, max: 2 });
  });

  it("활성 직원만 센다. 배정 행이 없는 직원은 뺀다", () => {
    expect(closingSpread({ a: ["C", "C"], gone: ["O", "O"] }, SHOP, ["a", "new"])).toEqual({ min: 2, max: 2 });
  });

  it("활성 직원이 없으면 null", () => {
    expect(closingSpread({ a: ["C"] }, SHOP, [])).toBeNull();
  });
});
