import { describe, expect, it } from "vitest";

import { employeeDays, employeeTotals, weekPages } from "./confirmed-view";
import { DEFAULT_CONFIG } from "./rules";
import type { ConfirmedSchedule } from "./supabase";

const SHIFTS = [...DEFAULT_CONFIG.shifts, { code: "AC", name: "더블", hours: 12, parts: ["A", "C"] }];

function schedule(over: Partial<ConfirmedSchedule> = {}): ConfirmedSchedule {
  return {
    shop_name: "한강 카페",
    period_start: "2026-11-02", // 월요일
    period_length: 7,
    confirmed_at: "2026-10-28T00:00:00+00:00",
    holidays: [],
    shifts: SHIFTS,
    rows: [
      { name: "이영희", codes: ["A", "M", "C", "O", "AC", "A", "O"] },
      { name: "박민수", codes: ["O", "O", "M", "O", "M", "O", "O"] },
    ],
    ...over,
  };
}

describe("employeeDays", () => {
  it("이름이 같은 직원의 기간 전체 날짜와 근무 이름을 돌려준다", () => {
    const days = employeeDays(schedule(), "이영희")!;
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ day: 1, date: "2026-11-02", weekday: 1, code: "A", label: "오픈 09:00~15:00", weekend: false });
    expect(days.map((d) => d.label)).toEqual([
      "오픈 09:00~15:00",
      "미들 12:00~18:00",
      "마감 17:00~23:00",
      "휴무",
      "더블 오픈+마감",
      "오픈 09:00~15:00",
      "휴무",
    ]);
  });

  it("토·일과 공휴일을 주말로 본다", () => {
    const days = employeeDays(schedule({ holidays: [3] }), "박민수")!;
    expect(days.map((d) => d.weekend)).toEqual([false, false, true, false, false, true, true]);
  });

  it("없는 이름이면 null", () => {
    expect(employeeDays(schedule(), "홍길동")).toBeNull();
  });

  it("모르는 코드는 코드 그대로, 시각이 없는 근무조는 이름만", () => {
    const shifts = [...SHIFTS, { code: "P", name: "피크", hours: 3 }];
    const days = employeeDays(schedule({ shifts, rows: [{ name: "김철수", codes: ["X", "P", "O", "O", "O", "O", "O"] }] }), "김철수")!;
    expect(days[0]).toMatchObject({ code: "X", label: "X" });
    expect(days[1]).toMatchObject({ code: "P", label: "피크" });
  });

  it("codes가 짧으면 남은 날은 코드 빈칸·'—'로 둔다", () => {
    const days = employeeDays(schedule({ rows: [{ name: "김철수", codes: ["A", "O"] }] }), "김철수")!;
    expect(days).toHaveLength(7);
    expect(days[1]).toMatchObject({ code: "O", label: "휴무" });
    expect(days[2]).toMatchObject({ code: "", label: "—" });
    expect(days[6]).toMatchObject({ day: 7, date: "2026-11-08", code: "", label: "—", weekend: true });
  });

  it("14일 기간은 월 경계를 넘어도 날짜를 이어서 센다", () => {
    const codes = Array.from({ length: 14 }, (_, i) => (i % 2 ? "O" : "M"));
    const days = employeeDays(
      schedule({ period_start: "2026-11-23", period_length: 14, rows: [{ name: "이영희", codes }] }),
      "이영희",
    )!;
    expect(days).toHaveLength(14);
    expect(days[8]).toMatchObject({ day: 9, date: "2026-12-01", weekday: 2 });
    expect(days[13]).toMatchObject({ date: "2026-12-06", weekend: true });
  });
});

describe("employeeTotals", () => {
  it("근무일 수와 실근무 시간 합(더블은 더블의 시간)", () => {
    const days = employeeDays(schedule(), "이영희")!;
    expect(employeeTotals(days, SHIFTS)).toEqual({ workDays: 5, hours: 6 + 6 + 6 + 12 + 6 });
  });

  it("빠진 날과 휴무는 세지 않는다", () => {
    const days = employeeDays(schedule({ rows: [{ name: "김철수", codes: ["A", "O"] }] }), "김철수")!;
    expect(employeeTotals(days, SHIFTS)).toEqual({ workDays: 1, hours: 6 });
  });
});

describe("weekPages", () => {
  it("7일씩 나눈다", () => {
    const codes = Array.from({ length: 14 }, () => "O");
    const days = employeeDays(schedule({ period_length: 14, rows: [{ name: "이영희", codes }] }), "이영희")!;
    const pages = weekPages(days);
    expect(pages.map((p) => p.length)).toEqual([7, 7]);
    expect(pages[1][0].day).toBe(8);
  });

  it("7의 배수가 아니면 마지막 쪽이 짧다", () => {
    const codes = Array.from({ length: 30 }, () => "O");
    const days = employeeDays(schedule({ period_length: 30, rows: [{ name: "이영희", codes }] }), "이영희")!;
    expect(weekPages(days).map((p) => p.length)).toEqual([7, 7, 7, 7, 2]);
  });
});
