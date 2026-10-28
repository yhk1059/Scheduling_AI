import { describe, expect, it } from "vitest";

import {
  MAX_PERIOD_DAYS,
  PERIOD_UNITS,
  dateOfDay,
  dayHeader,
  dayOfDate,
  firstPeriodStart,
  formatRange,
  isWeekendDay,
  nextPeriod,
  periodDays,
  periodEnd,
  periodFrom,
  unitLabel,
} from "./period";

// 기준: 2026-11-01 일요일, 2026-11-02 월요일, 2026-10-28 수요일

describe("firstPeriodStart", () => {
  it("주 단위: 오늘이 월요일이면 오늘", () => {
    expect(firstPeriodStart("1w", "2026-11-02")).toBe("2026-11-02");
    expect(firstPeriodStart("2w", "2026-11-02")).toBe("2026-11-02");
  });

  it("주 단위: 오늘이 월요일이 아니면 다음 월요일", () => {
    expect(firstPeriodStart("1w", "2026-10-28")).toBe("2026-11-02");
    expect(firstPeriodStart("4w", "2026-11-01")).toBe("2026-11-02");
  });

  it("달력 월: 오늘이 1일이면 오늘, 아니면 다음 달 1일", () => {
    expect(firstPeriodStart("month", "2026-11-01")).toBe("2026-11-01");
    expect(firstPeriodStart("month", "2026-10-28")).toBe("2026-11-01");
  });

  it("연말에는 다음 해로 넘어간다", () => {
    expect(firstPeriodStart("month", "2026-12-15")).toBe("2027-01-01");
    expect(firstPeriodStart("1w", "2026-12-29")).toBe("2027-01-04");
  });
});

describe("periodFrom", () => {
  it("주 단위 길이는 7·14·28", () => {
    expect(periodFrom("1w", "2026-10-28")).toEqual({ start_date: "2026-11-02", length: 7 });
    expect(periodFrom("2w", "2026-10-28")).toEqual({ start_date: "2026-11-02", length: 14 });
    expect(periodFrom("4w", "2026-10-28")).toEqual({ start_date: "2026-11-02", length: 28 });
  });

  it("달력 월 길이는 그 달의 일수", () => {
    expect(periodFrom("month", "2026-10-28")).toEqual({ start_date: "2026-11-01", length: 30 });
  });

  it("달력 월 기간 뒤에 단위를 1주로 바꾸면 다음 날 이후 첫 월요일에서 시작", () => {
    const nov = { start_date: "2026-11-01", length: 30 };
    const after = dateOfDay(nov, nov.length + 1); // 2026-12-01 화요일
    expect(after).toBe("2026-12-01");
    expect(periodFrom("1w", after)).toEqual({ start_date: "2026-12-07", length: 7 });
  });
});

describe("nextPeriod", () => {
  it("2주 단위가 월 경계를 넘는다", () => {
    const p = { start_date: "2026-11-23", length: 14 };
    expect(periodEnd(p)).toBe("2026-12-06");
    expect(nextPeriod("2w", p)).toEqual({ start_date: "2026-12-07", length: 14 });
  });

  it("달력 월: 2월은 평년 28일, 윤년 29일", () => {
    expect(nextPeriod("month", { start_date: "2027-01-01", length: 31 })).toEqual({
      start_date: "2027-02-01",
      length: 28,
    });
    expect(nextPeriod("month", { start_date: "2028-01-01", length: 31 })).toEqual({
      start_date: "2028-02-01",
      length: 29,
    });
  });

  it("12월 다음은 다음 해 1월", () => {
    expect(nextPeriod("month", { start_date: "2026-12-01", length: 31 })).toEqual({
      start_date: "2027-01-01",
      length: 31,
    });
  });
});

describe("dateOfDay / dayOfDate", () => {
  const p = { start_date: "2026-11-23", length: 14 };

  it("왕복한다", () => {
    for (let d = 1; d <= p.length; d++) expect(dayOfDate(p, dateOfDay(p, d))).toBe(d);
    expect(dateOfDay(p, 1)).toBe("2026-11-23");
    expect(dateOfDay(p, 9)).toBe("2026-12-01");
  });

  it("범위 밖이면 null", () => {
    expect(dayOfDate(p, "2026-11-22")).toBeNull();
    expect(dayOfDate(p, "2026-12-07")).toBeNull();
  });
});

describe("periodDays", () => {
  it("날짜·월·일·요일을 준다", () => {
    const days = periodDays({ start_date: "2026-11-29", length: 4 });
    expect(days).toEqual([
      { day: 1, date: "2026-11-29", month: 11, dom: 29, weekday: 0 },
      { day: 2, date: "2026-11-30", month: 11, dom: 30, weekday: 1 },
      { day: 3, date: "2026-12-01", month: 12, dom: 1, weekday: 2 },
      { day: 4, date: "2026-12-02", month: 12, dom: 2, weekday: 3 },
    ]);
  });
});

describe("dayHeader", () => {
  const p = { start_date: "2026-11-23", length: 14 };

  it("기간 첫날과 달의 1일은 M/D, 그 밖은 D", () => {
    expect(dayHeader(p, 1)).toBe("11/23");
    expect(dayHeader(p, 9)).toBe("12/1");
    expect(dayHeader(p, 2)).toBe("24");
    expect(dayHeader(p, 10)).toBe("2");
  });
});

describe("isWeekendDay", () => {
  const p = { start_date: "2026-11-01", length: 30 };

  it("토·일과 공휴일 인덱스", () => {
    expect(isWeekendDay(p, 1, [])).toBe(true); // 일
    expect(isWeekendDay(p, 7, [])).toBe(true); // 토
    expect(isWeekendDay(p, 2, [])).toBe(false); // 월
    expect(isWeekendDay(p, 18, [])).toBe(false); // 수
    expect(isWeekendDay(p, 18, [18])).toBe(true);
  });
});

describe("formatRange", () => {
  it("같은 해면 끝에 연도를 생략", () => {
    expect(formatRange({ start_date: "2026-11-23", length: 14 })).toBe("2026.11.23 – 12.6");
  });

  it("해가 바뀌면 끝에도 연도", () => {
    expect(formatRange({ start_date: "2026-12-28", length: 14 })).toBe("2026.12.28 – 2027.1.10");
  });
});

describe("단위 표기", () => {
  it("label과 상수", () => {
    expect(PERIOD_UNITS.map((u) => u.label)).toEqual(["1주", "2주", "4주", "달력 월"]);
    expect(unitLabel("2w")).toBe("2주");
    expect(unitLabel("month")).toBe("달력 월");
    expect(MAX_PERIOD_DAYS).toBe(31);
  });
});
