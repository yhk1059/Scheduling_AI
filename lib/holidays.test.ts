import { describe, expect, it } from "vitest";

import { KR_HOLIDAYS, holidayDays, holidayName } from "./holidays";

describe("holidayDays", () => {
  it("12/15부터 31일: 성탄절과 신정", () => {
    expect(holidayDays({ start_date: "2026-12-15", length: 31 })).toEqual([11, 18]);
  });

  it("공휴일이 없는 기간은 빈 배열", () => {
    expect(holidayDays({ start_date: "2026-11-02", length: 7 })).toEqual([]);
  });

  it("상수에 없는 연도는 넣지 않는다", () => {
    expect(holidayDays({ start_date: "2025-12-20", length: 7 })).toEqual([]);
    expect(holidayDays({ start_date: "2028-01-01", length: 7 })).toEqual([]);
  });

  it("연도 경계를 넘는 기간: 두 해의 공휴일을 함께, 상수에 없는 해는 뺀다", () => {
    expect(holidayDays({ start_date: "2026-12-28", length: 7 })).toEqual([5]);
    expect(holidayDays({ start_date: "2027-12-20", length: 14 })).toEqual([6, 8]);
    expect(holidayDays({ start_date: "2025-12-29", length: 7 })).toEqual([4]);
  });

  it("설 연휴 3일과 대체공휴일이 모두 들어간다", () => {
    expect(holidayDays({ start_date: "2026-02-16", length: 7 })).toEqual([1, 2, 3]);
    expect(holidayDays({ start_date: "2027-02-01", length: 14 })).toEqual([6, 7, 8, 9]);
  });
});

describe("holidayName", () => {
  it("공휴일이면 이름", () => {
    expect(holidayName("2026-03-02")).toBe("대체공휴일(삼일절)");
    expect(holidayName("2027-09-15")).toBe("추석");
  });

  it("아니면 null", () => {
    expect(holidayName("2026-11-04")).toBeNull();
    expect(holidayName("2025-12-25")).toBeNull();
  });
});

describe("KR_HOLIDAYS", () => {
  it("2026·2027년을 담는다", () => {
    expect(Object.keys(KR_HOLIDAYS).map(Number)).toEqual([2026, 2027]);
  });

  it("연도마다 날짜 오름차순이고 중복이 없으며, 모두 그 연도의 날짜다", () => {
    for (const [year, list] of Object.entries(KR_HOLIDAYS)) {
      const dates = list.map((h) => h.date);
      expect(dates).toEqual([...dates].sort());
      expect(new Set(dates).size).toBe(dates.length);
      for (const d of dates) {
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(d.slice(0, 4)).toBe(year);
      }
    }
  });
});
