import { describe, expect, it } from "vitest";

import { DEN_CONFIG } from "./test-rules";
import type { Employee, ShopConfig } from "./types.gen";
import { parseCarryOver, parseDelimited } from "./roster-import";

describe("parseDelimited", () => {
  it("탭으로 구분한다", () => {
    expect(parseDelimited("이름\t번호\n이영희\t12")).toEqual([
      ["이름", "번호"],
      ["이영희", "12"],
    ]);
  });

  it("탭이 없으면 쉼표로 구분한다", () => {
    expect(parseDelimited("이름,번호\r\n이영희,12\r\n")).toEqual([
      ["이름", "번호"],
      ["이영희", "12"],
    ]);
  });

  it("탭이 있으면 쉼표는 셀 내용이다", () => {
    expect(parseDelimited("김, 철수\t3")).toEqual([["김, 철수", "3"]]);
  });

  it("따옴표 안의 구분자·줄바꿈·이중 따옴표를 처리한다", () => {
    expect(parseDelimited('이름,메모\n이영희,"a,b\n둘째 줄 ""인용"""\n박민수,x')).toEqual([
      ["이름", "메모"],
      ["이영희", 'a,b\n둘째 줄 "인용"'],
      ["박민수", "x"],
    ]);
  });

  it("셀 앞뒤 공백을 지우고 빈 줄은 버린다", () => {
    expect(parseDelimited("\n 이영희 \t 12 \n\n\t\n")).toEqual([["이영희", "12"]]);
  });
});

describe("parseCarryOver", () => {
  const employees: Employee[] = [
    { id: "e01", name: "이영희" },
    { id: "e02", name: "박민수" },
  ];
  const parse = (text: string, config: ShopConfig = DEN_CONFIG) => parseCarryOver(text, employees, config);

  it("이름으로 employee_id를 찾고 근무 코드 동의어를 정규화한다", () => {
    const text = "이영희\tD\t데이\tE\t이브\t이브닝\tN\t나\n박민수\t나이트\tOFF\t휴\t오프\to\td";
    const { rows, warnings, errors } = parse(text);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(rows).toEqual([
      { employee_id: "e01", shifts: ["D", "D", "E", "E", "E", "N", "N"] },
      { employee_id: "e02", shifts: ["N", "O", "O", "O", "O", "D"] },
    ]);
  });

  it("8일이면 마지막 7일만 쓴다", () => {
    const { rows } = parse("이영희,D,D,E,E,N,N,O,O");
    expect(rows).toEqual([{ employee_id: "e01", shifts: ["D", "E", "E", "N", "N", "O", "O"] }]);
  });

  it("명단에 없는 이름은 무시하고 경고한다", () => {
    const { rows, warnings, errors } = parse("홍길동\tD\n박민수\tO");
    expect(rows).toEqual([{ employee_id: "e02", shifts: ["O"] }]);
    expect(warnings).toEqual([expect.stringContaining("홍길동")]);
    expect(errors).toEqual([]);
  });

  it("헤더 행(이름)은 조용히 건너뛴다", () => {
    const { rows, warnings } = parse("이름\t1\t2\n이영희\tD\tE");
    expect(rows).toEqual([{ employee_id: "e01", shifts: ["D", "E"] }]);
    expect(warnings).toEqual([]);
  });

  it("근무 형태의 코드·이름을 받고, 근무 형태에 없는 코드는 오류다", () => {
    const config = {
      shifts: [...DEN_CONFIG.shifts, { code: "M", name: "미드", hours: 8 }, { code: "DE", name: "더블", hours: 16, parts: ["D", "E"] }],
    } as ShopConfig;
    expect(parse("이영희\tM\t미드\tde\t더블", config).rows).toEqual([{ employee_id: "e01", shifts: ["M", "M", "DE", "DE"] }]);
    expect(parse("이영희\tM").errors).toEqual([{ row: 0, col: 1, message: expect.any(String) }]);
  });

  it("잘못된 코드는 셀 오류이고 그 행은 쓰지 않는다", () => {
    const { rows, errors } = parse("이영희\tD\tX\n박민수\tO");
    expect(rows).toEqual([{ employee_id: "e02", shifts: ["O"] }]);
    expect(errors).toEqual([{ row: 0, col: 2, message: expect.any(String) }]);
  });
});
