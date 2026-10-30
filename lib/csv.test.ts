import { describe, expect, it } from "vitest";

import { toScheduleCsv } from "./csv";
import { DEFAULT_CONFIG } from "./rules";
import type { Nurse, WardConfig } from "./types.gen";

type Code = string;
const config = DEFAULT_CONFIG;

const nurses: Nurse[] = [
  { id: "n01", name: "이영희" },
  { id: "n02", name: "박민수" },
];

/** 2026-02: 28일, 1일이 일요일. */
function feb(over: { nurses?: Nurse[]; holidays?: number[] } = {}) {
  const a: Code[] = Array.from({ length: 28 }, (_, i) => (["D", "E", "N", "O"] as const)[i % 4]);
  const b: Code[] = Array.from({ length: 28 }, () => "D");
  const list = over.nurses ?? nurses;
  return {
    nurses: list,
    period: { start_date: "2026-02-01", length: 28 },
    holidays: over.holidays ?? [],
    assignments: { [list[0].id]: a, [list[1].id]: b },
    config,
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

  it("첫 행은 이름·요일·합계 머리글, 둘째 행은 날짜 숫자다", () => {
    const [head, dates] = rows(toScheduleCsv(feb()));
    expect(head[0]).toBe("이름");
    expect(head.slice(1, 8)).toEqual(["일", "월", "화", "수", "목", "금", "토"]);
    expect(head.slice(-5)).toEqual(["D", "E", "N", "O", "주말근무"]);
    expect(head).toHaveLength(1 + 28 + 5);
    expect(dates.slice(1, 29)).toEqual(Array.from({ length: 28 }, (_, i) => String(i + 1)));
    expect(dates[0]).toBe("");
  });

  it("공휴일은 요일 옆에 표시한다", () => {
    const [head] = rows(toScheduleCsv(feb({ holidays: [17] })));
    expect(head[1 + 16]).toBe("화(공휴일)");
  });

  it("간호사 행은 이름, 근무 코드, 합계다", () => {
    const r = rows(toScheduleCsv(feb()));
    expect(r[2].slice(0, 5)).toEqual(["이영희", "D", "E", "N", "O"]);
    expect(r[2].slice(-5)).toEqual(["7", "7", "7", "7", "6"]); // 주말 1·7·8·14·15·21·22·28일 중 휴무가 아닌 날
    expect(r[3][0]).toBe("박민수");
    expect(r[3].slice(-5)).toEqual(["28", "0", "0", "0", "8"]);
  });

  it("하단 3행은 날짜별 D/E/N 합계다", () => {
    const r = rows(toScheduleCsv(feb()));
    expect(r).toHaveLength(2 + 2 + 3);
    const [d, e, n] = r.slice(-3);
    expect(d.slice(0, 4)).toEqual(["D 합계", "2", "1", "1"]);
    expect(e.slice(0, 4)).toEqual(["E 합계", "0", "1", "0"]);
    expect(n.slice(0, 4)).toEqual(["N 합계", "0", "0", "1"]);
    expect(d).toHaveLength(1 + 28 + 5);
  });

  it("31일 달은 31개 날짜 열을 만든다", () => {
    const row: Code[] = Array.from({ length: 31 }, () => "O");
    const csv = toScheduleCsv({
      nurses: [nurses[0]],
      period: { start_date: "2026-12-01", length: 31 },
      holidays: [25],
      assignments: { n01: row },
      config,
    });
    const [head, dates, nurse] = rows(csv);
    expect(head).toHaveLength(1 + 31 + 5);
    expect(head[1]).toBe("화"); // 2026-12-01은 화요일
    expect(head[1 + 24]).toBe("금(공휴일)");
    expect(dates[1 + 30]).toBe("31");
    expect(nurse.slice(1, 32)).toEqual(row);
  });

  it("합계 열은 활성 코드, 하단 합계는 근무조별이고 복합 코드는 세는 근무조마다 더한다", () => {
    const withDouble = {
      shifts: [
        ...DEFAULT_CONFIG.shifts,
        { code: "M", name: "미드", hours: 8, active: false },
        { code: "DE", name: "더블", hours: 16, parts: ["D", "E"] },
      ],
    } as WardConfig;
    const csv = toScheduleCsv({
      nurses,
      period: { start_date: "2026-11-02", length: 3 },
      holidays: [],
      assignments: { n01: ["DE", "D", "M"], n02: ["E", "O", "DE"] },
      config: withDouble,
    });
    const r = rows(csv);
    expect(r[0].slice(-6)).toEqual(["D", "E", "N", "O", "DE", "주말근무"]);
    expect(r[2].slice(-6)).toEqual(["1", "0", "0", "0", "1", "0"]);
    expect(r.slice(-3).map((x) => x.slice(0, 4))).toEqual([
      ["D 합계", "1", "1", "1"],
      ["E 합계", "2", "0", "1"],
      ["N 합계", "0", "0", "0"],
    ]);
  });

  it("월을 넘는 기간은 날짜 행에 실제 일(日)을 쓰고 요일도 날짜마다 계산한다", () => {
    const row: Code[] = Array.from({ length: 14 }, () => "O");
    const csv = toScheduleCsv({
      nurses: [nurses[0]],
      period: { start_date: "2026-11-23", length: 14 },
      holidays: [],
      assignments: { n01: row },
      config,
    });
    const [head, dates] = rows(csv);
    expect(head.slice(1, 8)).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
    expect(dates.slice(1, 15)).toEqual(["23", "24", "25", "26", "27", "28", "29", "30", "1", "2", "3", "4", "5", "6"]);
  });

  it("쉼표·따옴표·줄바꿈이 있는 셀은 RFC 4180으로 이스케이프한다", () => {
    const csv = toScheduleCsv(
      feb({
        nurses: [
          { id: "n01", name: '김"별"' },
          { id: "n02", name: "이,영\n희" },
        ],
      }),
    );
    expect(csv).toContain('\r\n"김""별""",D,');
    expect(csv).toContain('\r\n"이,영\n희",D,');
  });

  it("= + - @로 시작하는 셀은 앞에 '를 붙인다", () => {
    const csv = toScheduleCsv(
      feb({
        nurses: [
          { id: "n01", name: "=HYPERLINK(1)" },
          { id: "n02", name: "@SUM" },
        ],
      }),
    );
    expect(csv).toContain("\r\n'=HYPERLINK(1),D,");
    expect(csv).toContain("\r\n'@SUM,D,");
    expect(toScheduleCsv(feb({ nurses: [{ id: "n01", name: "+a" }, { id: "n02", name: "-b,c" }] })))
      .toMatch(/\r\n'\+a,D,[\s\S]*\r\n"'-b,c",D,/);
  });
});
