import { describe, expect, it } from "vitest";

import { scheduleSvg } from "./schedule-image";
import { DEN_CONFIG } from "./test-rules";

// 2026-11-23은 월요일. 1=월 … 7=일
const input = (over: { names?: [string, string]; holidays?: number[] } = {}) => {
  const [a, b] = over.names ?? ["이영희", "박민수"];
  return {
    title: "11/23~11/29 근무표",
    employees: [
      { id: "e01", name: a },
      { id: "e02", name: b },
    ],
    period: { start_date: "2026-11-23", length: 7 },
    holidays: over.holidays ?? [],
    assignments: { e01: ["D", "E", "N", "O", "D", "E", "N"], e02: ["O", "O", "D", "D", "D", "O", "O"] },
    config: DEN_CONFIG,
  };
};

/** <text …>내용</text>의 내용만 순서대로 */
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
/** 내용이 같은 첫 <text>의 fill */
const fillOf = (svg: string, content: string) => svg.match(new RegExp(`<text[^>]*fill="([^"]+)"[^>]*>${content}</text>`))?.[1];

describe("scheduleSvg", () => {
  it("SVG 문서이고 크기는 날짜·직원 수에 맞춘다", () => {
    const svg = scheduleSvg(input());
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    const width = Number(svg.match(/width="(\d+)"/)?.[1]);
    const long = scheduleSvg({ ...input(), period: { start_date: "2026-11-23", length: 14 }, assignments: { e01: Array(14).fill("D"), e02: Array(14).fill("O") } });
    expect(Number(long.match(/width="(\d+)"/)?.[1])).toBeGreaterThan(width);
  });

  it("제목, 요일·날짜 머리글, 직원 이름과 근무 코드를 적는다. 휴무는 '휴'다", () => {
    const t = texts(scheduleSvg(input()));
    expect(t[0]).toBe("11/23~11/29 근무표");
    expect(t).toEqual(expect.arrayContaining(["월", "11/23", "일", "11/29", "이영희", "박민수"]));
    const row = t.slice(t.indexOf("이영희") + 1, t.indexOf("이영희") + 8);
    expect(row).toEqual(["D", "E", "N", "휴", "D", "E", "N"]);
  });

  it("주말·공휴일 머리글은 빨간 글씨다", () => {
    const svg = scheduleSvg(input({ holidays: [3] }));
    expect(fillOf(svg, "11/28")).toBe("#B42318"); // 토
    expect(fillOf(svg, "11/25")).toBe("#B42318"); // 공휴일(수)
    expect(fillOf(svg, "11/24")).not.toBe("#B42318");
  });

  it("아래에 근무 코드 설명(이름과 시간)을 붙인다. 휴무는 뺀다", () => {
    const t = texts(scheduleSvg(input()));
    expect(t).toEqual(expect.arrayContaining(["D 주간 07:00~15:00", "E 저녁 15:00~23:00", "N 야간 16:00~24:00"]));
    expect(t.some((x) => x.startsWith("O "))).toBe(false);
  });

  it("이름 속 특수 문자는 XML로 이스케이프한다", () => {
    const svg = scheduleSvg(input({ names: ["A&B", "<김>"] }));
    expect(svg).toContain("A&amp;B");
    expect(svg).toContain("&lt;김&gt;");
    expect(svg).not.toContain("<김>");
  });
});
