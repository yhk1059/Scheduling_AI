import { describe, expect, it } from "vitest";

import type { Nurse } from "./types.gen";
import { buildRoster, mapHeaders, parseCarryOver, parseDelimited } from "./roster-import";

describe("parseDelimited", () => {
  it("탭으로 구분한다", () => {
    expect(parseDelimited("이름\t연차\n이영희\t12")).toEqual([
      ["이름", "연차"],
      ["이영희", "12"],
    ]);
  });

  it("탭이 없으면 쉼표로 구분한다", () => {
    expect(parseDelimited("이름,연차\r\n이영희,12\r\n")).toEqual([
      ["이름", "연차"],
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

describe("mapHeaders", () => {
  it("동의어를 매핑한다", () => {
    expect(mapHeaders(["성명", "경력", "N전담", "비고"])).toEqual({
      mapping: { name: 0, years: 1, night_only: 2 },
      unmatched: ["비고"],
    });
    expect(mapHeaders(["간호사", "년차", "나이트 전담"]).mapping).toEqual({
      name: 0,
      years: 1,
      night_only: 2,
    });
    expect(mapHeaders(["이름", "연차", "나이트"]).mapping).toEqual({
      name: 0,
      years: 1,
      night_only: 2,
    });
  });

  it("헤더가 없으면(데이터 행) 아무것도 매핑하지 않는다", () => {
    expect(mapHeaders(["이영희", "12", "N"])).toEqual({
      mapping: {},
      unmatched: ["이영희", "12", "N"],
    });
  });
});

describe("buildRoster", () => {
  const mapping = { name: 0, years: 1, night_only: 2 };

  it("헤더 행을 건너뛰고 id를 n01부터 부여한다", () => {
    const rows = [
      ["이름", "연차", "나이트전담"],
      ["이영희", "12", ""],
      ["박민수", "3", "Y"],
    ];
    expect(buildRoster(rows, mapping, false)).toEqual({
      nurses: [
        { id: "n01", name: "이영희", years: 12, night_only: false },
        { id: "n02", name: "박민수", years: 3, night_only: true },
      ],
      errors: [],
    });
  });

  it("헤더가 없으면 첫 행도 데이터로 쓴다", () => {
    const { nurses, errors } = buildRoster([["이영희", "12"]], { name: 0, years: 1 }, true);
    expect(errors).toEqual([]);
    expect(nurses).toEqual([{ id: "n01", name: "이영희", years: 12, night_only: false }]);
  });

  it("'3년차', '3년'은 숫자만 추출하고 실패하면 셀 오류다", () => {
    const rows = [
      ["김철수", "3년차"],
      ["정유진", "5년"],
      ["최지훈", "신규"],
    ];
    const { nurses, errors } = buildRoster(rows, { name: 0, years: 1 }, true);
    expect(nurses.map((n) => n.years)).toEqual([3, 5]);
    expect(errors).toEqual([{ row: 2, col: 1, message: expect.any(String) }]);
  });

  it("나이트 전담 값을 정규화하고 알 수 없는 값은 셀 오류다", () => {
    const values = ["Y", "n", "O", "x", "예", "아니오", "TRUE", "false", "", "몰라"];
    const rows = values.map((v, i) => [`간호사${i}`, "1", v]);
    const { nurses, errors } = buildRoster(rows, mapping, true);
    expect(nurses.map((n) => n.night_only)).toEqual([
      true, false, true, false, true, false, true, false, false,
    ]);
    expect(errors).toEqual([{ row: 9, col: 2, message: expect.any(String) }]);
  });

  it("동명이인은 행 오류다", () => {
    const rows = [
      ["이영희", "12"],
      ["박민수", "3"],
      ["이영희", "5"],
    ];
    const { nurses, errors } = buildRoster(rows, { name: 0, years: 1 }, true);
    expect(nurses.map((n) => n.name)).toEqual(["박민수"]);
    expect(errors.map((e) => [e.row, e.col])).toEqual([
      [0, null],
      [2, null],
    ]);
  });

  it("이름이 비면 셀 오류다", () => {
    const { errors } = buildRoster([["", "3"], ["박민수", "3"]], { name: 0, years: 1 }, true);
    expect(errors).toEqual([{ row: 0, col: 0, message: expect.any(String) }]);
  });

  it("이름·연차 열이 지정되지 않으면 표 오류다", () => {
    const { nurses, errors } = buildRoster([["이영희", "12"]], { name: 0 }, true);
    expect(nurses).toEqual([]);
    expect(errors).toEqual([{ row: null, col: null, message: expect.any(String) }]);
  });

  it("0명이면 오류다", () => {
    const { nurses, errors } = buildRoster([["이름", "연차"]], { name: 0, years: 1 }, false);
    expect(nurses).toEqual([]);
    expect(errors).toEqual([{ row: null, col: null, message: expect.any(String) }]);
  });

  it("41명이면 오류다", () => {
    const rows = Array.from({ length: 41 }, (_, i) => [`간호사${i}`, "1"]);
    const { errors } = buildRoster(rows, { name: 0, years: 1 }, true);
    expect(errors).toEqual([{ row: null, col: null, message: expect.stringContaining("40") }]);
    const ok = buildRoster(rows.slice(0, 40), { name: 0, years: 1 }, true);
    expect(ok.errors).toEqual([]);
    expect(ok.nurses.at(-1)?.id).toBe("n40");
  });
});

describe("parseCarryOver", () => {
  const nurses: Nurse[] = [
    { id: "n01", name: "이영희", years: 12, night_only: false },
    { id: "n02", name: "박민수", years: 9, night_only: false },
  ];

  it("이름으로 nurse_id를 찾고 근무 코드 동의어를 정규화한다", () => {
    const text = "이영희\tD\t데이\tE\t이브\t이브닝\tN\t나\n박민수\t나이트\tOFF\t휴\t오프\to\td";
    const { rows, warnings, errors } = parseCarryOver(text, nurses);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(rows).toEqual([
      { nurse_id: "n01", shifts: ["D", "D", "E", "E", "E", "N", "N"] },
      { nurse_id: "n02", shifts: ["N", "O", "O", "O", "O", "D"] },
    ]);
  });

  it("8일이면 마지막 7일만 쓴다", () => {
    const { rows } = parseCarryOver("이영희,D,D,E,E,N,N,O,O", nurses);
    expect(rows).toEqual([{ nurse_id: "n01", shifts: ["D", "E", "E", "N", "N", "O", "O"] }]);
  });

  it("명단에 없는 이름은 무시하고 경고한다", () => {
    const { rows, warnings, errors } = parseCarryOver("홍길동\tD\n박민수\tO", nurses);
    expect(rows).toEqual([{ nurse_id: "n02", shifts: ["O"] }]);
    expect(warnings).toEqual([expect.stringContaining("홍길동")]);
    expect(errors).toEqual([]);
  });

  it("헤더 행(이름)은 조용히 건너뛴다", () => {
    const { rows, warnings } = parseCarryOver("이름\t1\t2\n이영희\tD\tE", nurses);
    expect(rows).toEqual([{ nurse_id: "n01", shifts: ["D", "E"] }]);
    expect(warnings).toEqual([]);
  });

  it("잘못된 코드는 셀 오류이고 그 행은 쓰지 않는다", () => {
    const { rows, errors } = parseCarryOver("이영희\tD\tX\n박민수\tO", nurses);
    expect(rows).toEqual([{ nurse_id: "n02", shifts: ["O"] }]);
    expect(errors).toEqual([{ row: 0, col: 2, message: expect.any(String) }]);
  });
});
