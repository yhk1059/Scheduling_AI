import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "./rules";
import { balance, count, fixedCell, forbid, maxRun, minRun, OFF, offAfter, WORK } from "./test-rules";
import { isLeaveRule, type Shop, type WorkPeriod } from "./store";
import type { ConstraintSpec, Employee, Rule, Shifts, ShopConfig } from "./types.gen";
import {
  describeRule,
  describeShiftChange,
  formatDeviation,
  hardnessLabel,
  nextTask,
  presetName,
  scheduleName,
  coverageText,
  TASK_STEPS,
  taskDoneSteps,
  unitName,
  unitShort,
  shopRuleCount,
} from "./wording";

const NOV = { start_date: "2026-11-01", length: 30 };
const EMPLOYEES: Employee[] = [
  { id: "e01", name: "이영희" },
  { id: "e02", name: "박민수" },
  { id: "e03", name: "정유진" },
  { id: "e04", name: "최지훈" },
];
const CONFIG: ShopConfig = {
  shifts: [
    ...DEFAULT_CONFIG.shifts.slice(0, 3),
    { code: "P", name: "피크", hours: 3 },
    { code: "AC", name: "더블", hours: 12, parts: ["A", "C"] },
    DEFAULT_CONFIG.shifts[3],
  ],
} as unknown as ShopConfig;

const text = (c: ConstraintSpec, config: ShopConfig = DEFAULT_CONFIG) => describeRule(c, config, EMPLOYEES, NOV).text;

const A: Shifts = { in: ["A"] };
const M: Shifts = { in: ["M"] };
const C: Shifts = { in: ["C"] };
const person = { people: { ids: ["e02"] }, per: "person" as const };
type CountSpec = Parameters<typeof count>[0];
const hard = { hardness: "hard" } as const;
const soft = { hardness: "soft" } as const;

describe("scheduleName", () => {
  it("달력 월은 'M월 근무표'", () => {
    expect(scheduleName(NOV, "month")).toBe("11월 근무표");
  });
  it("주 단위는 'P/A~P/A 근무표'", () => {
    expect(scheduleName({ start_date: "2026-11-02", length: 14 }, "2w")).toBe("11/2~11/15 근무표");
  });
  it("달력 월이 1일에 시작하지 않으면 날짜로 이름을 붙인다", () => {
    expect(scheduleName({ start_date: "2026-11-15", length: 30 }, "month")).toBe("11/15~12/14 근무표");
    expect(scheduleName({ start_date: "2026-12-28", length: 31 }, "month")).toBe("12/28~1/27 근무표");
  });
  it("월 경계를 넘는 주 단위", () => {
    expect(scheduleName({ start_date: "2026-11-23", length: 14 }, "2w")).toBe("11/23~12/6 근무표");
    expect(scheduleName({ start_date: "2026-12-28", length: 7 }, "1w")).toBe("12/28~1/3 근무표");
  });
});

describe("describeShiftChange", () => {
  it("추가: 코드 · 이름 · 시간", () => {
    expect(describeShiftChange({ action: "add", shift: { code: "P", name: "피크", hours: 3 } }, DEFAULT_CONFIG)).toBe(
      "근무 코드 추가 · P 피크 · 3시간",
    );
  });
  it("시각이 있으면 함께 쓴다", () => {
    expect(
      describeShiftChange({ action: "add", shift: { code: "P", name: "피크", hours: 3, start: "11:00", end: "14:00" } }, DEFAULT_CONFIG),
    ).toBe("근무 코드 추가 · P 피크 · 11:00~14:00 · 3시간");
  });
  it("더블은 세는 근무조 이름을 붙인다", () => {
    expect(
      describeShiftChange({ action: "add", shift: { code: "AC", name: "더블", hours: 12, parts: ["A", "C"] } }, DEFAULT_CONFIG),
    ).toBe("근무 코드 추가 · AC 더블 · 12시간 · 오픈과 마감으로 세요");
  });
  it("수정", () => {
    expect(describeShiftChange({ action: "update", shift: { code: "M", name: "미들", hours: 9 } }, DEFAULT_CONFIG)).toBe(
      "근무 코드 수정 · M 미들 · 9시간",
    );
  });
});

describe("unitName / unitShort", () => {
  it("근무표 주기 select 레이블", () => {
    expect(unitName("month")).toBe("한 달(1일~말일)");
    expect(unitName("1w")).toBe("1주");
    expect(unitName("2w")).toBe("2주");
    expect(unitName("4w")).toBe("4주");
  });
  it("짧은 이름", () => {
    expect(unitShort("month")).toBe("한 달 단위");
    expect(unitShort("2w")).toBe("2주 단위");
  });
});

describe("hardnessLabel", () => {
  it("반드시 / 가능하면", () => {
    expect(hardnessLabel("hard")).toBe("반드시");
    expect(hardnessLabel("soft")).toBe("가능하면");
  });
});

describe("presetName / describeRule: 프리셋 모양", () => {
  const CASES: [string, ConstraintSpec, string, string][] = [
    ["평일 필요 인원", count({ days: { kind: "weekday" }, shifts: A, per: "day", min: 3, max: 4 }), "필요 인원", "평일마다 오픈 3~4명"],
    ["주말 필요 인원", count({ days: { kind: "weekend" }, shifts: C, per: "day", min: 2, max: 2 }), "필요 인원", "주말·공휴일마다 마감 2명"],
    ["최소만", count({ shifts: A, per: "day", min: 3 }), "필요 인원", "매일 오픈 3명 이상"],
    ["최대만", count({ days: { kind: "weekend" }, shifts: M, per: "day", max: 4 }), "필요 인원", "주말·공휴일마다 미들 4명까지"],
    ["정확히", count({ shifts: C, per: "day", min: 2, max: 2 }), "필요 인원", "매일 마감 2명"],
    ["기본 필요 인원", count({ shifts: A, per: "day", min: 3, max: 3 }, { id: "cov-A", default: true }), "필요 인원", "매일 오픈 3명"],
    ["하루 근무 시간", count({ shifts: WORK, per: "day", measure: "hours", max: 80 }), "세는 규칙", "매일 근무 시간 80시간 이하"],
    ["금지 순서", forbid([C, A]), "금지 순서", "마감 다음 날 오픈 금지"],
    ["금지 순서 다른 쌍", forbid([C, M]), "금지 순서", "마감 다음 날 미들 금지"],
    ["금지 순서 3일", forbid([C, OFF, A], { tags: ["신입"] }), "금지 순서", "신입 태그 마감 → 휴무 → 오픈 금지"],
    ["최대 연속 근무", maxRun(WORK, 5), "최대 연속 근무", "연속 근무 5일까지"],
    ["최대 연속 마감", maxRun(C, 3), "최대 연속 마감", "마감 연속 3일까지"],
    ["블록 길이", minRun(C, 2), "최소 연속 마감", "마감은 2일 이상씩 이어서"],
    ["최소 휴무", count({ shifts: OFF, per: "person", min: 8 }), "최소 휴무 일수", "모든 사람 근무표마다 휴무 8일 이상"],
    ["꺼진 규칙", count({ shifts: OFF, per: "person", min: 8 }, { enabled: false }), "최소 휴무 일수", "모든 사람 근무표마다 휴무 8일 이상"],
    ["마감 다음 휴무 1일", offAfter(C, 1), "마감 다음 휴무", "마감 다음 날은 휴무 1일"],
    ["마감 다음 휴무 2일", offAfter(C, 2), "마감 다음 휴무", "마감 다음 날은 휴무 2일"],
    ["주 근무 시간", count({ shifts: WORK, per: "person_week", measure: "hours", max: 52 }), "근무 시간", "모든 사람 주마다 근무 시간 52시간 이하"],
    ["휴무 간격", count({ people: { exclude_tags: ["신입"] }, shifts: OFF, per: "person_window", window: 7, min: 1 }), "휴무 간격", "신입 빼고 7일마다 휴무 1일 이상"],
    ["휴가", count({ people: { ids: ["e01"] }, days: { days: [3, 4, 5] }, shifts: WORK, per: "person", max: 0 }, hard), "휴가", "이영희 · 11/3~11/5 · 휴무"],
    ["명단에 없는 휴가", count({ people: { ids: ["n1"] }, days: { days: [3, 4, 5] }, shifts: WORK, per: "person", max: 0 }, hard), "휴가", "(명단에 없는 직원) · 11/3~11/5 · 휴무"],
    ["고정 근무", fixedCell("e01", 2, "M"), "고정 근무", "이영희 · 11/2 · 미들 고정"],
    ["명단에 없는 고정", fixedCell("n1", 2, "M"), "고정 근무", "(명단에 없는 직원) · 11/2 · 미들 고정"],
    ["희망 전체", count({ ...person, shifts: OFF, min: 14 }, soft), "희망·기피 근무", "박민수 · 근무표 전체 · 휴무 희망"],
    ["희망 주말", count({ ...person, days: { kind: "weekend" }, shifts: OFF, min: 5 }, soft), "희망·기피 근무", "박민수 · 주말·공휴일 · 휴무 희망"],
    ["희망 날짜", count({ ...person, days: { days: [2, 3, 7] }, shifts: A, min: 3 }, soft), "희망·기피 근무", "박민수 · 11/2~11/3, 11/7 · 오픈 희망"],
    ["희망 날짜 중 주말", count({ ...person, days: { kind: "weekend", days: [2, 3, 7] }, shifts: A, min: 2 }, soft), "희망·기피 근무", "박민수 · 11/2~11/3, 11/7 중 주말·공휴일 · 오픈 희망"],
    ["기피 전체", count({ ...person, shifts: C, max: 0 }, soft), "희망·기피 근무", "박민수 · 근무표 전체 · 마감 피하기"],
    ["기피 주말", count({ ...person, days: { kind: "weekend" }, shifts: C, max: 0 }, soft), "희망·기피 근무", "박민수 · 주말·공휴일 · 마감 피하기"],
    ["기피 날짜", count({ ...person, days: { days: [5, 6] }, shifts: M, max: 0 }, soft), "희망·기피 근무", "박민수 · 11/5~11/6 · 미들 피하기"],
    ["중요도 높은 기피", count({ ...person, shifts: C, max: 0 }, { ...soft, priority: "high" }), "희망·기피 근무", "박민수 · 근무표 전체 · 마감 피하기"],
    ["명단에 없는 기피", count({ people: { ids: ["n1"] }, per: "person", days: { kind: "weekend" }, shifts: C, max: 0 }, soft), "희망·기피 근무", "(명단에 없는 직원) · 주말·공휴일 · 마감 피하기"],
    ["마감 고르게", balance({ people: { exclude_tags: ["신입"] }, shifts: C }), "마감 고르게", "신입 빼고 마감 수를 고르게(최근 4주 포함)"],
    ["마감 고르게 반드시", balance({ people: { exclude_tags: ["신입"] }, shifts: C }, hard), "마감 고르게", "신입 빼고 마감 수를 고르게(최근 4주 포함) · 차이 1 이하"],
    ["차이 0", balance({ shifts: C, max_gap: 0 }, hard), "마감 고르게", "마감 수를 고르게(최근 4주 포함) · 차이 0 이하"],
    ["주말 고르게", balance({ days: { kind: "weekend" }, shifts: WORK }), "주말·공휴일 고르게", "주말·공휴일 근무 수를 고르게(최근 4주 포함)"],
    ["주말 고르게 반드시", balance({ days: { kind: "weekend" }, shifts: WORK }, hard), "주말·공휴일 고르게", "주말·공휴일 근무 수를 고르게(최근 4주 포함) · 차이 1 이하"],
    ["시간 고르게(최근 4주 뺌)", balance({ days: { kind: "weekend" }, shifts: WORK, measure: "hours", with_history: false }), "고르게 규칙", "주말·공휴일 근무 시간을 고르게"],
  ];

  for (const [name, r, preset, sentence] of CASES) {
    it(name, () => {
      expect([presetName(r), text(r)]).toEqual([preset, sentence]);
    });
  }

  it("내부 id·코드만 있는 표기를 쓰지 않는다", () => {
    for (const [name, r] of CASES) expect(text(r), name).not.toMatch(/e\d\d|\b[AMCO]\b|오프|≤|≥|undefined|NaN/);
  });
});

describe("presetName / describeRule: 새 모양", () => {
  const d = (b: ConstraintSpec) => [presetName(b), text(b, CONFIG)];

  it("태그·요일·공휴일로 고른 날마다 인원", () => {
    expect(d(count({ people: { tags: ["리더"] }, shifts: { in: ["A"] }, per: "day", min: 1 }))).toEqual([
      "태그별 배치",
      "매일 리더 태그 오픈 1명 이상",
    ]);
    expect(d(count({ days: { weekdays: [5] }, shifts: { in: ["A"] }, per: "day", min: 2, max: 2 }))).toEqual([
      "필요 인원",
      "토요일마다 오픈 2명",
    ]);
    expect(d(count({ days: { kind: "weekday", weekdays: [0, 2] }, shifts: { in: ["M"] }, per: "day", max: 2 }))).toEqual([
      "필요 인원",
      "평일 중 월·수요일마다 미들 2명까지",
    ]);
    expect(
      d(count({ people: { tags: ["리더"] }, days: { kind: "holiday" }, shifts: { in: ["C"] }, per: "day", min: 1 })),
    ).toEqual(["태그별 배치", "공휴일마다 리더 태그 마감 1명 이상"]);
    expect(d(count({ days: { kind: "weekday" }, shifts: { in: ["P"] }, per: "day", min: 1, max: 1 }))).toEqual([
      "필요 인원",
      "평일마다 피크 1명",
    ]);
  });

  it("주마다·며칠마다·근무 시간", () => {
    expect(d(count({ shifts: { not_in: ["O"] }, per: "person_week", measure: "hours", max: 52 }))).toEqual([
      "근무 시간",
      "모든 사람 주마다 근무 시간 52시간 이하",
    ]);
    expect(d(count({ shifts: { in: ["O"] }, per: "person_window", window: 7, min: 1 }))).toEqual([
      "휴무 간격",
      "모든 사람 7일마다 휴무 1일 이상",
    ]);
    expect(d(count({ people: { tags: ["신입"] }, shifts: { in: ["C"] }, per: "person", measure: "hours", max: 80 }))).toEqual([
      "근무 시간",
      "신입 태그 근무표마다 마감 근무 시간 80시간 이하",
    ]);
  });

  it("복합 코드와 여러 사람", () => {
    expect(d(count({ shifts: { in: ["AC"] }, per: "person", max: 2 }))).toEqual([
      "근무 횟수",
      "모든 사람 근무표마다 더블(AC) 2번까지",
    ]);
    expect(d(count({ people: { ids: ["e01", "e02", "e03", "e04"] }, shifts: { in: ["C"] }, per: "person", min: 4, max: 6 }))).toEqual([
      "근무 횟수",
      "이영희 외 3명 근무표마다 마감 4~6번",
    ]);
    expect(d(count({ people: { ids: ["e01", "e02"] }, days: { days: [10] }, shifts: { in: ["A", "P"] }, per: "day", min: 1 }))).toEqual([
      "세는 규칙",
      "11/10마다 이영희 박민수 오픈·피크 1명 이상",
    ]);
  });

  it("순서: 길이 범위(최대·최소 두 규칙으로 나뉜다), 다른 근무 금지, 사람 대상", () => {
    const [max, min] = [maxRun(C, 3), minRun(C, 2)];
    expect(d(max)).toEqual(["최대 연속 마감", "마감 연속 3일까지"]);
    expect(d(min)).toEqual(["최소 연속 마감", "마감은 2일 이상씩 이어서"]);
    expect(d(minRun(M, 2))).toEqual(["순서 규칙", "미들은 2일 이상씩 이어서"]);
    expect(d(forbid([C, { not_in: ["C", "O"] }]))).toEqual([
      "금지 순서",
      "마감 다음 날 마감 말고 다른 근무 금지",
    ]);
    expect(d(forbid([M, OFF, A]))).toEqual([
      "금지 순서",
      "미들 → 휴무 → 오픈 금지",
    ]);
    expect(d(maxRun(WORK, 4, { tags: ["신입"] }))).toEqual([
      "최대 연속 근무",
      "신입 태그 연속 근무 4일까지",
    ]);
  });

  it("고르게: 시간, 태그, 최근 4주를 빼면", () => {
    expect(d(balance({ people: { tags: ["신입"] }, shifts: WORK, measure: "hours" }))).toEqual([
      "고르게 규칙",
      "신입 태그 근무 시간을 고르게(최근 4주 포함)",
    ]);
    expect(d(balance({ shifts: { in: ["AC"] }, with_history: false }))).toEqual(["고르게 규칙", "더블(AC) 수를 고르게"]);
  });

  it("희망·기피는 가능하면인 한 사람 세기, 반드시면 근무 횟수", () => {
    const want: CountSpec = { people: { ids: ["e03"] }, days: { days: [20] }, shifts: { in: ["P"] }, per: "person", min: 1 };
    expect(d(count(want, { hardness: "soft", priority: "high" }))).toEqual(["희망·기피 근무", "정유진 · 11/20 · 피크 희망"]);
    expect(d(count(want, hard))).toEqual(["근무 횟수", "정유진 11/20 피크 1번 이상"]);
  });

  it("명단에 없는 직원", () => {
    const leave: CountSpec = { people: { ids: ["e99"] }, days: { days: [20] }, shifts: { not_in: ["O"] }, per: "person", max: 0 };
    expect(d(count(leave))).toEqual(["휴가", "(명단에 없는 직원) · 11/20 · 휴무"]);
  });

  it("휴가 모양이어도 가능하면이면 휴무 희망(토글을 숨기지 않는다)", () => {
    const offWish: CountSpec = { people: { ids: ["e02"] }, days: { kind: "weekend" }, shifts: { not_in: ["O"] }, per: "person", max: 0 };
    const wish = count(offWish, soft);
    expect(d(wish)).toEqual(["희망·기피 근무", "박민수 · 주말·공휴일 · 휴무 희망"]);
    expect(isLeaveRule(wish)).toBe(false);
    expect(isLeaveRule(count(offWish, hard))).toBe(true);
  });
});

describe("describeRule: 조정 가능한 값의 위치(parts)", () => {
  it("값은 이름과 함께 따로 나오고, 이어 붙이면 text다", () => {
    const r = count({ days: { kind: "weekday" }, shifts: A, per: "day", min: 3, max: 4 });
    const s = describeRule(r, DEFAULT_CONFIG, EMPLOYEES, NOV);
    expect(s.text).toBe("평일마다 오픈 3~4명");
    expect(s.parts).toEqual([{ text: "평일마다 오픈 " }, { value: "min", text: "3" }, { text: "~" }, { value: "max", text: "4" }, { text: "명" }]);
    expect(s.parts.map((p) => p.text).join("")).toBe(s.text);
  });

  it("최대 연속·고르게 차이도 값, 구조 숫자(휴무 일수 offset)는 값이 아니다", () => {
    const values = (r: ConstraintSpec) => describeRule(r, DEFAULT_CONFIG, EMPLOYEES, NOV).parts.filter((p) => "value" in p);
    expect(values(maxRun(C, 3))).toEqual([{ value: "max_len", text: "3" }]);
    expect(values(balance({ shifts: C, max_gap: 0 }, hard))).toEqual([{ value: "max_gap", text: "0" }]);
    expect(values(offAfter(C, 2))).toEqual([]);
  });
});

describe("describeRule: 새로 표현되는 규칙(설계 §2.6)", () => {
  const rule = (body: unknown, values: Rule["values"] = {}): ConstraintSpec =>
    ({ id: "x", type: "rule", scope: "shop", source_text: "", values, body }) as ConstraintSpec;
  const count = (shifts: string[], extra: object = {}) => ({ ...extra, shifts: { in: shifts } });
  const d = (r: ConstraintSpec) => [presetName(r), describeRule(r, CONFIG, EMPLOYEES, NOV).text];

  it("신입가 마감면 리더도 마감에 1명", () => {
    const r = rule({
      kind: "require",
      for_each: { per: "day" },
      when: { left: count(["C"], { who: { tags: ["신입"] } }), op: "ge", right: 1 },
      then: { left: count(["C"], { who: { tags: ["리더"] } }), op: "ge", right: 1 },
    });
    expect(d(r)).toEqual(["조건 규칙", "매일, 신입 태그 마감 1명 이상이면 리더 태그 마감 1명 이상"]);
  });

  it("둘은 같은 날 마감 금지", () => {
    const r = rule({ kind: "require", for_each: { per: "day" }, then: { left: count(["C"], { who: { ids: ["e01", "e02"] } }), op: "le", right: 1 } });
    expect(d(r)).toEqual(["세는 규칙", "매일 이영희 박민수 마감 1명까지"]);
  });

  it("둘은 오픈을 같이", () => {
    const r = rule({
      kind: "require",
      for_each: { per: "day" },
      then: { left: count(["A"], { who: { ids: ["e01"] } }), op: "eq", right: count(["A"], { who: { ids: ["e02"] } }) },
    });
    expect(d(r)).toEqual(["세는 규칙", "매일 이영희 오픈과 박민수 오픈이 같음"]);
  });

  it("리더가 신입보다 적으면 안 됨(마감)", () => {
    const r = rule({
      kind: "require",
      for_each: { per: "day" },
      then: { left: count(["C"], { who: { tags: ["리더"] } }), op: "ge", right: count(["C"], { who: { tags: ["신입"] } }) },
    });
    expect(d(r)).toEqual(["세는 규칙", "매일 리더 태그 마감이 신입 태그 마감 이상"]);
  });

  it("주말 마감 다음 월요일은 휴무", () => {
    const r = rule({
      kind: "require",
      for_each: { per: "person_day", days: { weekdays: [6] } },
      when: { left: { ...count(["C"]), offset: [0, 0] }, op: "ge", right: 1 },
      then: { left: { ...count(["O"]), offset: [1, 1] }, op: "eq", right: 1 },
    });
    expect(d(r)).toEqual(["조건 규칙", "모든 사람 · 일요일마다, 마감 1번 이상이면 다음 날 휴무 1일"]);
  });

  it("마감 연속은 2~3일씩(두 규칙)", () => {
    const rules = [maxRun(C, 3), minRun(C, 2)];
    expect(rules.map(d)).toEqual([
      ["최대 연속 마감", "마감 연속 3일까지"],
      ["최소 연속 마감", "마감은 2일 이상씩 이어서"],
    ]);
  });

  it("일반 틀: 값·그리고/또는·날짜 이동·근무표 전체", () => {
    const r = rule(
      {
        kind: "require",
        for_each: { per: "period" },
        then: {
          any: [
            { left: count(["AC"]), op: "le", right: { value: "max" } },
            { left: { ...count(["C"]), measure: "hours" }, op: "ge", right: 16 },
          ],
        },
      },
      { max: { value: 10, label: "최대 횟수" } },
    );
    const s = describeRule(r, CONFIG, EMPLOYEES, NOV);
    expect([presetName(r), s.text]).toEqual(["세는 규칙", "근무표 전체 더블(AC) 10번 이하 또는 마감 근무 시간 16시간 이상"]);
    expect(s.parts.filter((p) => "value" in p)).toEqual([{ value: "max", text: "10" }]);
    const seq = rule({
      kind: "require",
      for_each: { per: "person_day", people: { tags: ["신입"] } },
      then: { left: { ...count(["C"]), offset: [-2, -1] }, op: "le", right: 1 },
    });
    expect(d(seq)).toEqual(["순서 규칙", "신입 태그 · 날마다 앞 2일 마감 1번 이하"]);
  });
});

describe("shopRuleCount", () => {
  it("필요 인원은 세지 않는다", () => {
    const coverage = (kind: "weekday" | "weekend", code: string) =>
      count({ days: { kind }, shifts: { in: [code] }, per: "day", min: 2, max: 2 });
    const rules = [
      coverage("weekday", "A"),
      coverage("weekend", "C"),
      offAfter(C, 1),
      balance({ shifts: C }),
    ];
    expect(shopRuleCount(rules)).toBe(2);
    expect(shopRuleCount([])).toBe(0);
  });
});

describe("formatDeviation", () => {
  it("정수 일로 반올림, 0은 부호 없음, 음수는 − 기호", () => {
    expect(formatDeviation(2.6)).toBe("+3일");
    expect(formatDeviation(-0.4)).toBe("0일");
    expect(formatDeviation(0.4)).toBe("0일");
    expect(formatDeviation(0)).toBe("0일");
    expect(formatDeviation(-1.6)).toBe("−2일");
    expect(formatDeviation(1.5)).toBe("+2일");
    expect(formatDeviation(-1.5)).toBe("−2일");
  });
});

describe("nextTask", () => {
  const shop: Shop = {
    name: "성수 카페",
    unit: "month",
    config: DEFAULT_CONFIG,
    employees: EMPLOYEES.map((n) => ({ ...n, tags: [], active: true })),
    nextEmployeeNo: 5,
    rules: [],
    pendingRules: [],
    pendingConfig: [],
    unconverted: [],
  };
  const TODAY = "2026-10-28";
  const result = { assignments: {} } as unknown as NonNullable<WorkPeriod["result"]>;

  function period(start_date: string, length: number, patch: Partial<WorkPeriod> = {}): WorkPeriod {
    return {
      start_date,
      length,
      id: `p-${start_date}`,
      holidays: [],
      requests: [],
      pendingRequests: [],
      disabledIds: [],
      ruleOverrides: {},
      carryOver: [],
      carryOverUsed: null,
      result: null,
      resultVersion: null,
      status: "draft",
      versions: [],
      snapshot: null,
      ...patch,
    };
  }
  const confirmed = (start: string, length: number, at: string) =>
    period(start, length, {
      status: "confirmed",
      result,
      versions: [{ confirmed_at: at, assignments: {}, changed: [] }],
    });

  it("기간이 없으면 오늘 이후 첫 근무표를 만들 차례", () => {
    expect(nextTask(shop, [], TODAY)).toEqual({ kind: "none", name: "11월 근무표" });
  });

  it("작성 중, 생성 전", () => {
    const p = period("2026-11-01", 30, {
      requests: [
        fixedCell("e01", 15, "O"),
        balance({ shifts: C }, { scope: "period" }),
      ],
      pendingRequests: [fixedCell("e02", 3, "O")],
    });
    expect(nextTask(shop, [p], TODAY)).toEqual({ kind: "drafting", name: "11월 근무표" });
  });

  it("작성 중, 생성 후", () => {
    expect(nextTask(shop, [period("2026-11-01", 30, { result })], TODAY)).toEqual({
      kind: "generated",
      name: "11월 근무표",
    });
  });

  it("확정", () => {
    const p = confirmed("2026-11-01", 30, "2026-10-28T05:32:00.000Z");
    expect(nextTask(shop, [p], TODAY)).toEqual({
      kind: "confirmed",
      name: "11월 근무표",
      confirmedAt: "2026-10-28T05:32:00.000Z",
    });
  });

  it("운영 중 근무표가 있으면 그다음 근무표를 고른다", () => {
    const nov = confirmed("2026-11-01", 30, "2026-10-28T05:32:00.000Z");
    const during = "2026-11-09";
    expect(nextTask(shop, [nov], during)).toEqual({ kind: "none", name: "12월 근무표" });
    expect(nextTask(shop, [nov, period("2026-12-01", 31)], during)).toEqual({
      kind: "drafting",
      name: "12월 근무표",
    });
  });

  it("주 단위 매장은 날짜로 이름을 붙인다", () => {
    expect(nextTask({ ...shop, unit: "2w" }, [], TODAY)).toEqual({ kind: "none", name: "11/2~11/15 근무표" });
  });
});

describe("coverageText", () => {
  it("정확히·범위·이상·없음", () => {
    expect(coverageText({ min: 3, max: 3 })).toBe("3명");
    expect(coverageText({ min: 1, max: 2 })).toBe("1~2명");
    expect(coverageText({ min: 2, max: null })).toBe("2명 이상");
    expect(coverageText(null)).toBe("");
  });
});

describe("taskDoneSteps", () => {
  it("홈 진행 단계는 요청 → 근무표 → 확정 세 칸이다", () => {
    expect(TASK_STEPS).toEqual(["가능 시간", "매장 조건", "근무표", "확정"]);
  });

  it("상태별로 끝난 단계 수를 센다", () => {
    expect(taskDoneSteps({ kind: "none", name: "" })).toBe(0);
    expect(taskDoneSteps({ kind: "drafting", name: "" })).toBe(0);
    expect(taskDoneSteps({ kind: "generated", name: "" })).toBe(3);
    expect(taskDoneSteps({ kind: "confirmed", name: "", confirmedAt: "" })).toBe(4);
  });
});

