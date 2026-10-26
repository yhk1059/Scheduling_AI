import { describe, expect, it } from "vitest";

import { toScheduleCsv } from "./csv";
import type { Nurse, NurseStats } from "./types.gen";

type Code = "D" | "E" | "N" | "O";

const nurses: Nurse[] = [
  { id: "n01", name: "이영희", years: 12, night_only: false },
  { id: "n02", name: "박민수", years: 3, night_only: false },
];

function stats(row: Code[], weekend: number): NurseStats {
  const count = (c: Code) => row.filter((s) => s === c).length;
  return {
    D: count("D"),
    E: count("E"),
    N: count("N"),
    O: count("O"),
    weekend_holiday_work: weekend,
    max_consecutive_work: 0,
    preference_rate: null,
    deviation: 0,
  };
}

/** 2026-02: 28일, 1일이 일요일. */
function feb(over: { nurses?: Nurse[]; holidays?: number[] } = {}) {
  const a: Code[] = Array.from({ length: 28 }, (_, i) => (["D", "E", "N", "O"] as const)[i % 4]);
  const b: Code[] = Array.from({ length: 28 }, () => "D");
  const list = over.nurses ?? nurses;
  return {
    nurses: list,
    period: { year: 2026, month: 2 },
    holidays: over.holidays ?? [],
    assignments: { [list[0].id]: a, [list[1].id]: b },
    stats: { [list[0].id]: stats(a, 4), [list[1].id]: stats(b, 8) },
  };
}

function rows(csv: string): string[][] {
  return csv.replace(/^﻿/, "").replace(/\r\n$/, "").split("\r\n").map((l) => l.split(","));
}

describe("toScheduleCsv", () => {
  it("UTF-8 BOM으로 시작하고 줄바꿈은 CRLF다", () => {
    const csv = toScheduleCsv(feb());
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("첫 행은 이름·연차·요일·합계 머리글, 둘째 행은 날짜 숫자다", () => {
    const [head, dates] = rows(toScheduleCsv(feb()));
    expect(head.slice(0, 2)).toEqual(["이름", "연차"]);
    expect(head.slice(2, 9)).toEqual(["일", "월", "화", "수", "목", "금", "토"]);
    expect(head.slice(-5)).toEqual(["D", "E", "N", "O", "주말근무"]);
    expect(head).toHaveLength(2 + 28 + 5);
    expect(dates.slice(2, 30)).toEqual(Array.from({ length: 28 }, (_, i) => String(i + 1)));
    expect(dates.slice(0, 2)).toEqual(["", ""]);
  });

  it("공휴일은 요일 옆에 표시한다", () => {
    const [head] = rows(toScheduleCsv(feb({ holidays: [17] })));
    expect(head[2 + 16]).toBe("화(공휴일)");
  });

  it("간호사 행은 이름, 연차, 근무 코드, 합계다", () => {
    const r = rows(toScheduleCsv(feb()));
    expect(r[2].slice(0, 6)).toEqual(["이영희", "12", "D", "E", "N", "O"]);
    expect(r[2].slice(-5)).toEqual(["7", "7", "7", "7", "4"]);
    expect(r[3].slice(0, 2)).toEqual(["박민수", "3"]);
    expect(r[3].slice(-5)).toEqual(["28", "0", "0", "0", "8"]);
  });

  it("하단 3행은 날짜별 D/E/N 합계다", () => {
    const r = rows(toScheduleCsv(feb()));
    expect(r).toHaveLength(2 + 2 + 3);
    const [d, e, n] = r.slice(-3);
    expect(d.slice(0, 5)).toEqual(["D 합계", "", "2", "1", "1"]);
    expect(e.slice(0, 5)).toEqual(["E 합계", "", "0", "1", "0"]);
    expect(n.slice(0, 5)).toEqual(["N 합계", "", "0", "0", "1"]);
    expect(d).toHaveLength(2 + 28 + 5);
  });

  it("31일 달은 31개 날짜 열을 만든다", () => {
    const row: Code[] = Array.from({ length: 31 }, () => "O");
    const csv = toScheduleCsv({
      nurses: [nurses[0]],
      period: { year: 2026, month: 12 },
      holidays: [25],
      assignments: { n01: row },
      stats: { n01: stats(row, 0) },
    });
    const [head, dates, nurse] = rows(csv);
    expect(head).toHaveLength(2 + 31 + 5);
    expect(head[2]).toBe("화"); // 2026-12-01은 화요일
    expect(head[2 + 24]).toBe("금(공휴일)");
    expect(dates[2 + 30]).toBe("31");
    expect(nurse.slice(2, 33)).toEqual(row);
  });

  it("쉼표·따옴표·줄바꿈이 있는 셀은 RFC 4180으로 이스케이프한다", () => {
    const csv = toScheduleCsv(
      feb({
        nurses: [
          { id: "n01", name: '김"별"', years: 1 },
          { id: "n02", name: "이,영\n희", years: 2 },
        ],
      }),
    );
    expect(csv).toContain('\r\n"김""별""",1,');
    expect(csv).toContain('\r\n"이,영\n희",2,');
  });

  it("= + - @로 시작하는 셀은 앞에 '를 붙인다", () => {
    const csv = toScheduleCsv(
      feb({
        nurses: [
          { id: "n01", name: "=HYPERLINK(1)", years: 1 },
          { id: "n02", name: "@SUM", years: 2 },
        ],
      }),
    );
    expect(csv).toContain("\r\n'=HYPERLINK(1),1,");
    expect(csv).toContain("\r\n'@SUM,2,");
    expect(toScheduleCsv(feb({ nurses: [{ id: "n01", name: "+a", years: 1 }, { id: "n02", name: "-b,c", years: 2 }] })))
      .toMatch(/\r\n'\+a,1,[\s\S]*\r\n"'-b,c",2,/);
  });
});
