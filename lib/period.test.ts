import { describe, expect, it } from "vitest";

import {
  MAX_PERIOD_DAYS,
  PERIOD_UNITS,
  dateOfDay,
  dayHeader,
  dayOfDate,
  firstPeriodStart,
  formatRange,
  localDate,
  isWeekendDay,
  monthDay,
  nextPeriod,
  periodDays,
  periodEnd,
  periodFrom,
  unitLabel,
  validStart,
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
  it("주 단위는 아무 날에서 시작하고 길이는 7·14·28", () => {
    expect(periodFrom("1w", "2026-10-28")).toEqual({ start_date: "2026-10-28", length: 7 });
    expect(periodFrom("2w", "2026-11-02")).toEqual({ start_date: "2026-11-02", length: 14 });
    expect(periodFrom("4w", "2026-10-28")).toEqual({ start_date: "2026-10-28", length: 28 });
  });

  it("달력 월: 1일이면 그 달 전체", () => {
    expect(periodFrom("month", "2026-11-01")).toEqual({ start_date: "2026-11-01", length: 30 });
    expect(periodFrom("month", "2027-02-01")).toEqual({ start_date: "2027-02-01", length: 28 });
  });

  it("달력 월: 1일이 아니면 다음 달 같은 날 전날까지", () => {
    const p = periodFrom("month", "2026-11-15");
    expect(p).toEqual({ start_date: "2026-11-15", length: 30 });
    expect(periodEnd(p)).toBe("2026-12-14");
    expect(periodEnd(periodFrom("month", "2027-01-28"))).toBe("2027-02-27");
    expect(periodEnd(periodFrom("month", "2026-12-20"))).toBe("2027-01-19");
  });
});

describe("validStart", () => {
  it("달력 월은 1~28일만, 주 단위는 아무 날", () => {
    expect(validStart("month", "2026-11-01")).toBe(true);
    expect(validStart("month", "2026-11-28")).toBe(true);
    expect(validStart("month", "2026-11-29")).toBe(false);
    expect(validStart("month", "2026-12-31")).toBe(false);
    expect(validStart("1w", "2026-11-29")).toBe(true);
    expect(validStart("2w", "2026-12-31")).toBe(true);
  });
});

describe("localDate", () => {
  it("브라우저 시간대의 날짜", () => {
    expect(localDate(new Date(2026, 9, 28, 23, 59))).toBe("2026-10-28");
    expect(localDate(new Date(2027, 0, 5, 0, 0))).toBe("2027-01-05");
  });
});

describe("nextPeriod", () => {
  it("직전 기간 다음 날에 시작한다(단위를 바꿔도 맞추지 않는다)", () => {
    const nov = { start_date: "2026-11-01", length: 30 };
    expect(dateOfDay(nov, nov.length + 1)).toBe("2026-12-01"); // 화요일
    expect(nextPeriod("1w", nov)).toEqual({ start_date: "2026-12-01", length: 7 });
    expect(nextPeriod("month", { start_date: "2026-11-15", length: 30 })).toEqual({ start_date: "2026-12-15", length: 31 });
  });

  it("달력 월인데 다음 날이 29~31일이면 다음 달 1일에서 시작한다", () => {
    expect(nextPeriod("month", { start_date: "2026-12-02", length: 28 })).toEqual({ start_date: "2027-01-01", length: 31 });
  });

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

describe("monthDay", () => {
  it("인덱스를 실제 날짜 M/D로 쓴다", () => {
    const p = { start_date: "2026-11-23", length: 14 };
    expect(monthDay(p, 1)).toBe("11/23");
    expect(monthDay(p, 2)).toBe("11/24");
    expect(monthDay(p, 9)).toBe("12/1");
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
