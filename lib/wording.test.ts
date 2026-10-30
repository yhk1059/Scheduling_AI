import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { blockToRules, DEFAULT_CONFIG, legacyToBlock, nightOnlyBlock, type BlockSpec, type LegacySpec } from "./migrate";
import { isLeaveRule, type Ward, type WorkPeriod } from "./store";
import type { ConstraintSpec, Nurse, Rule, WardConfig } from "./types.gen";
import {
  configSummary,
  describeRule,
  describeShiftChange,
  formatDeviation,
  hardnessLabel,
  nextTask,
  presetName,
  scheduleName,
  TASK_STEPS,
  taskDoneSteps,
  unitName,
  unitShort,
  wardRuleCount,
} from "./wording";

const NOV = { start_date: "2026-11-01", length: 30 };
const NURSES: Nurse[] = [
  { id: "n01", name: "이영희", years: 12 },
  { id: "n02", name: "박민수", years: 9 },
  { id: "n03", name: "정유진", years: 5 },
  { id: "n04", name: "최지훈", years: 3 },
];
const CONFIG: WardConfig = {
  shifts: [
    ...DEFAULT_CONFIG.shifts.slice(0, 3),
    { code: "M", name: "미드", hours: 8 },
    { code: "DE", name: "더블", hours: 16, parts: ["D", "E"] },
    DEFAULT_CONFIG.shifts[3],
  ],
} as unknown as WardConfig;

/** 블록 하나를 식 규칙으로(변환표). 나뉘는 블록은 첫 규칙. 생략한 공통 필드는 기본값. */
function block(type: BlockSpec["type"], params: unknown, over: Partial<BlockSpec> = {}): ConstraintSpec {
  return blockToRules({ id: `c-${type}`, scope: "ward", source_text: "", type, params, ...over } as BlockSpec)[0];
}
const rulesOf = (b: BlockSpec) => blockToRules(b);
const text = (c: ConstraintSpec, config: WardConfig = DEFAULT_CONFIG) => describeRule(c, config, NURSES, NOV).text;

const CASES: { name: string; template: LegacySpec | null; period: typeof NOV; holidays: number[] }[] = JSON.parse(
  readFileSync(join(__dirname, "..", "backend/tests/golden/convert-cases.json"), "utf-8"),
);
const EXPR_CASES: { name: string; block: BlockSpec; rules: ConstraintSpec[] }[] = JSON.parse(
  readFileSync(join(__dirname, "..", "backend/tests/golden/expr-convert-cases.json"), "utf-8"),
);

describe("scheduleName", () => {
  it("달력 월은 'M월 근무표'", () => {
    expect(scheduleName(NOV, "month")).toBe("11월 근무표");
  });
  it("주 단위는 'M/D~M/D 근무표'", () => {
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
    expect(describeShiftChange({ action: "add", shift: { code: "M", name: "미드", hours: 8 } }, DEFAULT_CONFIG)).toBe(
      "근무 코드 추가 · M 미드 · 8시간",
    );
  });
  it("시작 시각이 있으면 함께 쓴다", () => {
    expect(
      describeShiftChange({ action: "add", shift: { code: "M", name: "미드", hours: 8, start: "11:00" } }, DEFAULT_CONFIG),
    ).toBe("근무 코드 추가 · M 미드 · 11:00부터 8시간");
  });
  it("더블은 세는 근무조 이름을 붙인다", () => {
    expect(
      describeShiftChange({ action: "add", shift: { code: "DE", name: "더블", hours: 16, parts: ["D", "E"] } }, DEFAULT_CONFIG),
    ).toBe("근무 코드 추가 · DE 더블 · 16시간 · 데이와 이브닝으로 세요");
  });
  it("수정", () => {
    expect(describeShiftChange({ action: "update", shift: { code: "E", name: "이브닝", hours: 9 } }, DEFAULT_CONFIG)).toBe(
      "근무 코드 수정 · E 이브닝 · 9시간",
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

describe("presetName / describeRule: 템플릿 변환표의 모든 모양(convert-cases.json, 템플릿 → 블록 → 식)", () => {
  const EXPECTED: Record<string, [string, string]> = {
    "daily_coverage-weekday": ["필요 인원", "평일마다 데이 3~4명"],
    "daily_coverage-weekend": ["필요 인원", "주말·공휴일마다 나이트 2명"],
    forbidden_sequence: ["금지 순서", "나이트 다음 날 데이 금지"],
    max_consecutive_work: ["최대 연속 근무", "연속 근무 5일까지"],
    max_consecutive_nights: ["최대 연속 나이트", "나이트 연속 3일까지"],
    min_days_off: ["최소 휴무 일수", "모든 사람 근무표마다 휴무 8일 이상"],
    off_after_night_block: ["나이트 다음 휴무", "나이트 다음 날은 휴무 2일"],
    skill_mix: ["연차별 배치", "매일 3년차 이상 이브닝 1명 이상"],
    leave: ["휴가", "이영희 · 11/3~11/5 · 휴무"],
    fixed_assignment: ["고정 근무", "이영희 · 11/2 · 이브닝 고정"],
    "shift_preference-prefer-all": ["희망·기피 근무", "박민수 · 근무표 전체 · 휴무 희망"],
    "shift_preference-prefer-weekends": ["희망·기피 근무", "박민수 · 주말·공휴일 · 휴무 희망"],
    "shift_preference-prefer-days": ["희망·기피 근무", "박민수 · 11/2~11/3, 11/7 · 데이 희망"],
    "shift_preference-prefer-days-weekends": ["희망·기피 근무", "박민수 · 11/2~11/3, 11/7 중 주말·공휴일 · 데이 희망"],
    "shift_preference-avoid-all": ["희망·기피 근무", "박민수 · 근무표 전체 · 나이트 피하기"],
    "shift_preference-avoid-weekends": ["희망·기피 근무", "박민수 · 주말·공휴일 · 나이트 피하기"],
    "shift_preference-avoid-days": ["희망·기피 근무", "박민수 · 11/5~11/6 · 이브닝 피하기"],
    "shift_preference-weight30": ["희망·기피 근무", "박민수 · 근무표 전체 · 나이트 피하기"],
    "night_fairness-soft": ["나이트 고르게", "나이트전담 빼고 나이트 수를 고르게(최근 4주 포함)"],
    "night_fairness-hard": ["나이트 고르게", "나이트전담 빼고 나이트 수를 고르게(최근 4주 포함) · 차이 1 이하"],
    "weekend_fairness-soft": ["주말·공휴일 고르게", "주말·공휴일 근무 수를 고르게(최근 4주 포함)"],
    "weekend_fairness-hard": ["주말·공휴일 고르게", "주말·공휴일 근무 수를 고르게(최근 4주 포함) · 차이 1 이하"],
  };
  /** 케이스 이름에서 hard/soft·가중치·꺼짐 꼬리를 뗀 모양 이름. */
  const shape = (name: string) => (EXPECTED[name] ? name : name.replace(/(-(hard|soft|disabled|weight\d+))+$/, ""));

  const ruleOf = (c: (typeof CASES)[number]) => {
    const rules = rulesOf(c.template ? legacyToBlock(c.template, c.period, c.holidays) : nightOnlyBlock());
    expect(rules, c.name).toHaveLength(1);
    return rules[0];
  };

  for (const c of CASES) {
    it(c.name, () => {
      const r = ruleOf(c);
      const want = c.template ? EXPECTED[shape(c.name)] : ["나이트 전담", "나이트전담 태그 나이트 말고 다른 근무 없음"];
      expect(want, c.name).toBeDefined();
      expect([presetName(r), text(r)]).toEqual(want);
    });
  }

  it("내부 id·코드만 있는 표기를 쓰지 않는다", () => {
    for (const c of CASES) expect(text(ruleOf(c)), c.name).not.toMatch(/n\d\d|\b[DENO]\b|오프|≤|≥/);
  });
});

describe("presetName / describeRule: 새 모양", () => {
  const d = (b: ConstraintSpec) => [presetName(b), text(b, CONFIG)];

  it("태그·연차·요일·공휴일로 고른 날마다 인원", () => {
    expect(d(block("count", { people: { tags: ["책임"] }, shifts: { in: ["D"] }, per: "day", min: 1 }))).toEqual([
      "태그별 배치",
      "매일 책임 태그 데이 1명 이상",
    ]);
    expect(d(block("count", { days: { weekdays: [5] }, shifts: { in: ["D"] }, per: "day", min: 2, max: 2 }))).toEqual([
      "필요 인원",
      "토요일마다 데이 2명",
    ]);
    expect(d(block("count", { days: { kind: "weekday", weekdays: [0, 2] }, shifts: { in: ["E"] }, per: "day", max: 2 }))).toEqual([
      "필요 인원",
      "평일 중 월·수요일마다 이브닝 2명까지",
    ]);
    expect(
      d(block("count", { people: { min_years: 3, max_years: 5 }, days: { kind: "holiday" }, shifts: { in: ["N"] }, per: "day", min: 1 })),
    ).toEqual(["연차별 배치", "공휴일마다 3~5년차 나이트 1명 이상"]);
    expect(d(block("count", { days: { kind: "weekday" }, shifts: { in: ["M"] }, per: "day", min: 1, max: 1 }))).toEqual([
      "필요 인원",
      "평일마다 미드 1명",
    ]);
  });

  it("주마다·며칠마다·근무 시간", () => {
    expect(d(block("count", { shifts: { not_in: ["O"] }, per: "person_week", measure: "hours", max: 52 }))).toEqual([
      "근무 시간",
      "모든 사람 주마다 근무 시간 52시간 이하",
    ]);
    expect(d(block("count", { shifts: { in: ["O"] }, per: "person_window", window: 7, min: 1 }))).toEqual([
      "휴무 간격",
      "모든 사람 7일마다 휴무 1일 이상",
    ]);
    expect(d(block("count", { people: { tags: ["신규"] }, shifts: { in: ["N"] }, per: "person", measure: "hours", max: 80 }))).toEqual([
      "근무 시간",
      "신규 태그 근무표마다 나이트 근무 시간 80시간 이하",
    ]);
  });

  it("복합 코드와 여러 사람", () => {
    expect(d(block("count", { shifts: { in: ["DE"] }, per: "person", max: 2 }))).toEqual([
      "근무 횟수",
      "모든 사람 근무표마다 더블(DE) 2번까지",
    ]);
    expect(d(block("count", { people: { ids: ["n01", "n02", "n03", "n04"] }, shifts: { in: ["N"] }, per: "person", min: 4, max: 6 }))).toEqual([
      "근무 횟수",
      "이영희 외 3명 근무표마다 나이트 4~6번",
    ]);
    expect(d(block("count", { people: { ids: ["n01", "n02"] }, days: { days: [10] }, shifts: { in: ["D", "M"] }, per: "day", min: 1 }))).toEqual([
      "세는 규칙",
      "11/10마다 이영희 박민수 데이·미드 1명 이상",
    ]);
  });

  it("순서: 길이 범위(최대·최소 두 규칙으로 나뉜다), 다른 근무 금지, 사람 대상", () => {
    const [max, min] = rulesOf({ id: "s", type: "sequence", scope: "ward", source_text: "", params: { run: { in: ["N"] }, min_len: 2, max_len: 3 } });
    expect(d(max)).toEqual(["최대 연속 나이트", "나이트 연속 3일까지"]);
    expect(d(min)).toEqual(["나이트 블록 길이", "나이트는 2일 이상씩 이어서"]);
    expect(d(block("sequence", { run: { in: ["E"] }, min_len: 2 }))).toEqual(["순서 규칙", "이브닝은 2일 이상씩 이어서"]);
    expect(d(block("sequence", { forbid: [[{ in: ["N"] }, { not_in: ["N", "O"] }]] }))).toEqual([
      "금지 순서",
      "나이트 다음 날 나이트 말고 다른 근무 금지",
    ]);
    expect(d(block("sequence", { forbid: [[{ in: ["E"] }, { in: ["O"] }, { in: ["D"] }]] }))).toEqual([
      "금지 순서",
      "이브닝 → 휴무 → 데이 금지",
    ]);
    expect(d(block("sequence", { people: { tags: ["신규"] }, run: { not_in: ["O"] }, max_len: 4 }))).toEqual([
      "최대 연속 근무",
      "신규 태그 연속 근무 4일까지",
    ]);
  });

  it("고르게: 시간, 태그, 최근 4주를 빼면", () => {
    expect(d(block("balance", { people: { tags: ["신규"] }, shifts: { not_in: ["O"] }, measure: "hours" }))).toEqual([
      "고르게 규칙",
      "신규 태그 근무 시간을 고르게(최근 4주 포함)",
    ]);
    expect(d(block("balance", { shifts: { in: ["DE"] }, with_history: false }))).toEqual(["고르게 규칙", "더블(DE) 수를 고르게"]);
  });

  it("희망·기피는 가능하면인 한 사람 세기, 반드시면 근무 횟수", () => {
    const want = { people: { ids: ["n03"] }, days: { days: [20] }, shifts: { in: ["M"] }, per: "person", min: 1 };
    expect(d(block("count", want, { hardness: "soft", priority: "high" }))).toEqual(["희망·기피 근무", "정유진 · 11/20 · 미드 희망"]);
    expect(d(block("count", want, { hardness: "hard" }))).toEqual(["근무 횟수", "정유진 11/20 미드 1번 이상"]);
  });

  it("명단에 없는 간호사", () => {
    const leave = { people: { ids: ["n99"] }, days: { days: [20] }, shifts: { not_in: ["O"] }, per: "person", max: 0 };
    expect(d(block("count", leave))).toEqual(["휴가", "(명단에 없는 간호사) · 11/20 · 휴무"]);
  });

  it("휴가 모양이어도 가능하면이면 휴무 희망(토글을 숨기지 않는다)", () => {
    const offWish = { people: { ids: ["n02"] }, days: { kind: "weekend" }, shifts: { not_in: ["O"] }, per: "person", max: 0 };
    const soft = block("count", offWish, { hardness: "soft" });
    expect(d(soft)).toEqual(["희망·기피 근무", "박민수 · 주말·공휴일 · 휴무 희망"]);
    expect(isLeaveRule(soft)).toBe(false);
    expect(isLeaveRule(block("count", offWish, { hardness: "hard" }))).toBe(true);
  });
});

describe("presetName / describeRule: 블록 → 식 변환표의 모든 모양(expr-convert-cases.json)", () => {
  const EXPECTED: Record<string, [string, string][]> = {
    "count-day-min": [["필요 인원", "매일 데이 3명 이상"]],
    "count-day-max": [["필요 인원", "주말·공휴일마다 이브닝 4명까지"]],
    "count-day-min-max": [["필요 인원", "평일마다 데이 3~4명"]],
    "count-day-eq": [["필요 인원", "매일 나이트 2명"]],
    "count-day-people": [["연차별 배치", "매일 3년차 이상 이브닝 1명 이상"]],
    "count-day-hours": [["세는 규칙", "매일 근무 시간 80시간 이하"]],
    "count-person-min": [["최소 휴무 일수", "모든 사람 근무표마다 휴무 8일 이상"]],
    "count-person-max-soft": [["희망·기피 근무", "(명단에 없는 간호사) · 주말·공휴일 · 나이트 피하기"]],
    "count-person-leave": [["휴가", "(명단에 없는 간호사) · 11/3~11/5 · 휴무"]],
    "count-person-week-hours": [["근무 시간", "모든 사람 주마다 근무 시간 52시간 이하"]],
    "count-person-window": [["휴무 간격", "신규 빼고 7일마다 휴무 1일 이상"]],
    "count-disabled": [["최소 휴무 일수", "모든 사람 근무표마다 휴무 8일 이상"]],
    "forbid-1": [["금지 순서", "나이트 다음 날 데이 금지"]],
    "forbid-2-split": [
      ["금지 순서", "나이트 다음 날 데이 금지"],
      ["금지 순서", "나이트 다음 날 이브닝 금지"],
    ],
    "forbid-3-long": [["금지 순서", "신규 태그 나이트 → 휴무 → 데이 금지"]],
    "run-max-len-night": [["최대 연속 나이트", "나이트 연속 3일까지"]],
    "run-max-len-work": [["최대 연속 근무", "연속 근무 5일까지"]],
    "run-min-len": [["나이트 블록 길이", "나이트는 2일 이상씩 이어서"]],
    "run-min-max-split": [
      ["최대 연속 나이트", "나이트 연속 3일까지"],
      ["나이트 블록 길이", "나이트는 2일 이상씩 이어서"],
    ],
    "after-then-off-1": [["나이트 다음 휴무", "나이트 다음 날은 휴무 1일"]],
    "after-then-off-2": [["나이트 다음 휴무", "나이트 다음 날은 휴무 2일"]],
    "balance-soft": [["나이트 고르게", "나이트전담 빼고 나이트 수를 고르게(최근 4주 포함)"]],
    "balance-hard-gap": [["나이트 고르게", "나이트 수를 고르게(최근 4주 포함) · 차이 0 이하"]],
    "balance-hours-no-history": [["고르게 규칙", "주말·공휴일 근무 시간을 고르게"]],
    "fixed-assignment": [["고정 근무", "(명단에 없는 간호사) · 11/2 · 이브닝 고정"]],
    "default-coverage": [["필요 인원", "매일 데이 3명"]],
    "default-night-only": [["나이트 전담", "나이트전담 태그 나이트 말고 다른 근무 없음"]],
  };

  for (const [name, want] of Object.entries(EXPECTED)) {
    it(name, () => {
      const c = EXPR_CASES.find((x) => x.name === name)!;
      expect(c, name).toBeDefined();
      expect(c.rules.map((r) => [presetName(r), text(r)])).toEqual(want);
      // 블록이었을 때와 같은 문장: 블록을 다시 바꿔도 같다
      expect(blockToRules(c.block).map((r) => text(r))).toEqual(want.map(([, t]) => t));
    });
  }

  it("모든 케이스(샘플·골든 요청 포함)에 내부 id·코드만 있는 표기가 없다", () => {
    for (const c of EXPR_CASES) {
      for (const r of c.rules) expect(text(r), `${c.name} ${r.id}`).not.toMatch(/n\d\d|\b[DENO]\b|오프|≤|≥|undefined|NaN/);
    }
  });
});

describe("describeRule: 조정 가능한 값의 위치(parts)", () => {
  it("값은 이름과 함께 따로 나오고, 이어 붙이면 text다", () => {
    const r = EXPR_CASES.find((x) => x.name === "count-day-min-max")!.rules[0];
    const s = describeRule(r, DEFAULT_CONFIG, NURSES, NOV);
    expect(s.text).toBe("평일마다 데이 3~4명");
    expect(s.parts).toEqual([{ text: "평일마다 데이 " }, { value: "min", text: "3" }, { text: "~" }, { value: "max", text: "4" }, { text: "명" }]);
    expect(s.parts.map((p) => p.text).join("")).toBe(s.text);
  });

  it("최대 연속·고르게 차이도 값, 구조 숫자(휴무 일수 offset)는 값이 아니다", () => {
    const values = (name: string) =>
      describeRule(EXPR_CASES.find((x) => x.name === name)!.rules[0], DEFAULT_CONFIG, NURSES, NOV).parts.filter((p) => "value" in p);
    expect(values("run-max-len-night")).toEqual([{ value: "max_len", text: "3" }]);
    expect(values("balance-hard-gap")).toEqual([{ value: "max_gap", text: "0" }]);
    expect(values("after-then-off-2")).toEqual([]);
  });
});

describe("describeRule: 새로 표현되는 규칙(설계 §2.6)", () => {
  const rule = (body: unknown, values: Rule["values"] = {}): ConstraintSpec =>
    ({ id: "x", type: "rule", scope: "ward", source_text: "", values, body }) as ConstraintSpec;
  const count = (shifts: string[], extra: object = {}) => ({ ...extra, shifts: { in: shifts } });
  const d = (r: ConstraintSpec) => [presetName(r), describeRule(r, CONFIG, NURSES, NOV).text];

  it("신규가 나이트면 책임도 나이트에 1명", () => {
    const r = rule({
      kind: "require",
      for_each: { per: "day" },
      when: { left: count(["N"], { who: { tags: ["신규"] } }), op: "ge", right: 1 },
      then: { left: count(["N"], { who: { tags: ["책임"] } }), op: "ge", right: 1 },
    });
    expect(d(r)).toEqual(["조건 규칙", "매일, 신규 태그 나이트 1명 이상이면 책임 태그 나이트 1명 이상"]);
  });

  it("둘은 같은 날 나이트 금지", () => {
    const r = rule({ kind: "require", for_each: { per: "day" }, then: { left: count(["N"], { who: { ids: ["n01", "n02"] } }), op: "le", right: 1 } });
    expect(d(r)).toEqual(["세는 규칙", "매일 이영희 박민수 나이트 1명까지"]);
  });

  it("둘은 데이를 같이", () => {
    const r = rule({
      kind: "require",
      for_each: { per: "day" },
      then: { left: count(["D"], { who: { ids: ["n01"] } }), op: "eq", right: count(["D"], { who: { ids: ["n02"] } }) },
    });
    expect(d(r)).toEqual(["세는 규칙", "매일 이영희 데이와 박민수 데이가 같음"]);
  });

  it("책임이 신규보다 적으면 안 됨(나이트)", () => {
    const r = rule({
      kind: "require",
      for_each: { per: "day" },
      then: { left: count(["N"], { who: { tags: ["책임"] } }), op: "ge", right: count(["N"], { who: { tags: ["신규"] } }) },
    });
    expect(d(r)).toEqual(["세는 규칙", "매일 책임 태그 나이트가 신규 태그 나이트 이상"]);
  });

  it("주말 나이트 다음 월요일은 휴무", () => {
    const r = rule({
      kind: "require",
      for_each: { per: "person_day", days: { weekdays: [6] } },
      when: { left: { ...count(["N"]), offset: [0, 0] }, op: "ge", right: 1 },
      then: { left: { ...count(["O"]), offset: [1, 1] }, op: "eq", right: 1 },
    });
    expect(d(r)).toEqual(["조건 규칙", "모든 사람 · 일요일마다, 나이트 1번 이상이면 다음 날 휴무 1일"]);
  });

  it("나이트 블록은 2~3일씩(두 규칙)", () => {
    const rules = rulesOf({ id: "s", type: "sequence", scope: "ward", source_text: "", params: { run: { in: ["N"] }, min_len: 2, max_len: 3 } });
    expect(rules.map(d)).toEqual([
      ["최대 연속 나이트", "나이트 연속 3일까지"],
      ["나이트 블록 길이", "나이트는 2일 이상씩 이어서"],
    ]);
  });

  it("일반 틀: 값·그리고/또는·날짜 이동·근무표 전체", () => {
    const r = rule(
      {
        kind: "require",
        for_each: { per: "period" },
        then: {
          any: [
            { left: count(["DE"]), op: "le", right: { value: "max" } },
            { left: { ...count(["N"]), measure: "hours" }, op: "ge", right: 16 },
          ],
        },
      },
      { max: { value: 10, label: "최대 횟수" } },
    );
    const s = describeRule(r, CONFIG, NURSES, NOV);
    expect([presetName(r), s.text]).toEqual(["세는 규칙", "근무표 전체 더블(DE) 10번 이하 또는 나이트 근무 시간 16시간 이상"]);
    expect(s.parts.filter((p) => "value" in p)).toEqual([{ value: "max", text: "10" }]);
    const seq = rule({
      kind: "require",
      for_each: { per: "person_day", people: { tags: ["신규"] } },
      then: { left: { ...count(["N"]), offset: [-2, -1] }, op: "le", right: 1 },
    });
    expect(d(seq)).toEqual(["순서 규칙", "신규 태그 · 날마다 앞 2일 나이트 1번 이하"]);
  });
});

describe("wardRuleCount", () => {
  it("필요 인원은 세지 않는다", () => {
    const coverage = (kind: string, code: string) =>
      block("count", { days: { kind }, shifts: { in: [code] }, per: "day", min: 2, max: 2 });
    const rules = [
      coverage("weekday", "D"),
      coverage("weekend", "N"),
      block("sequence", { after: { in: ["N"] }, then_off: 1 }),
      block("balance", { shifts: { in: ["N"] } }, { hardness: "soft", priority: "low" }),
    ];
    expect(wardRuleCount(rules)).toBe(2);
    expect(wardRuleCount([])).toBe(0);
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
  const ward: Ward = {
    name: "내과 병동",
    unit: "month",
    config: DEFAULT_CONFIG,
    nurses: NURSES.map((n) => ({ ...n, tags: [], active: true })),
    nextNurseNo: 5,
    rules: [],
    pendingRules: [],
    pendingConfig: [],
    unconverted: [],
    introSeen: true,
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
    expect(nextTask(ward, [], TODAY)).toEqual({ kind: "none", name: "11월 근무표" });
  });

  it("작성 중, 생성 전: 적용한 요청 수", () => {
    const p = period("2026-11-01", 30, {
      requests: [
        block("fixed_assignment", { nurse_id: "n01", day: 15, shift: "O" }, { scope: "period" }),
        block("balance", { shifts: { in: ["N"] } }, { scope: "period" }),
      ],
      pendingRequests: [block("fixed_assignment", { nurse_id: "n02", day: 3, shift: "O" }, { scope: "period" })],
    });
    expect(nextTask(ward, [p], TODAY)).toEqual({ kind: "drafting", name: "11월 근무표", requests: 2 });
  });

  it("작성 중, 생성 후", () => {
    expect(nextTask(ward, [period("2026-11-01", 30, { result })], TODAY)).toEqual({
      kind: "generated",
      name: "11월 근무표",
    });
  });

  it("확정", () => {
    const p = confirmed("2026-11-01", 30, "2026-10-28T05:32:00.000Z");
    expect(nextTask(ward, [p], TODAY)).toEqual({
      kind: "confirmed",
      name: "11월 근무표",
      confirmedAt: "2026-10-28T05:32:00.000Z",
    });
  });

  it("운영 중 근무표가 있으면 그다음 근무표를 고른다", () => {
    const nov = confirmed("2026-11-01", 30, "2026-10-28T05:32:00.000Z");
    const during = "2026-11-09";
    expect(nextTask(ward, [nov], during)).toEqual({ kind: "none", name: "12월 근무표" });
    expect(nextTask(ward, [nov, period("2026-12-01", 31)], during)).toEqual({
      kind: "drafting",
      name: "12월 근무표",
      requests: 0,
    });
  });

  it("주 단위 병동은 날짜로 이름을 붙인다", () => {
    expect(nextTask({ ...ward, unit: "2w" }, [], TODAY)).toEqual({ kind: "none", name: "11/2~11/15 근무표" });
  });
});

describe("taskDoneSteps", () => {
  it("홈 진행 단계는 요청 → 근무표 → 확정 세 칸이다", () => {
    expect(TASK_STEPS).toEqual(["요청", "근무표", "확정"]);
  });

  it("상태별로 끝난 단계 수를 센다", () => {
    expect(taskDoneSteps({ kind: "none", name: "" })).toBe(0);
    expect(taskDoneSteps({ kind: "drafting", name: "", requests: 0 })).toBe(0);
    expect(taskDoneSteps({ kind: "drafting", name: "", requests: 2 })).toBe(1);
    expect(taskDoneSteps({ kind: "generated", name: "" })).toBe(2);
    expect(taskDoneSteps({ kind: "confirmed", name: "", confirmedAt: "" })).toBe(3);
  });
});

describe("configSummary", () => {
  const shift = (code: string, name: string, hours: number, extra: object = {}) => ({ code, name, hours, ...extra });
  const config = (...shifts: ReturnType<typeof shift>[]): WardConfig =>
    ({ shifts: [...shifts, shift("O", "휴무", 0)] }) as unknown as WardConfig;

  it("기본 근무 형태는 UI_GUIDE 문구와 같다", () => {
    expect(configSummary(DEFAULT_CONFIG)).toBe("데이·이브닝·나이트 3교대, 각 8시간");
  });

  it("시간이 다르면 근무조마다 적고, 더블과 꺼진 코드를 구분한다", () => {
    const c = config(
      shift("D", "데이", 8),
      shift("E", "이브닝", 8),
      shift("N", "나이트", 10),
      shift("M", "미드", 7.5, { active: false }),
      shift("DE", "더블", 16, { parts: ["D", "E"] }),
    );
    expect(configSummary(c)).toBe("데이·이브닝·나이트 3교대, 데이 8시간·이브닝 8시간·나이트 10시간 · 더블 DE");
  });

  it("근무조가 하나뿐이면 교대라고 하지 않는다", () => {
    expect(configSummary(config(shift("D", "데이", 7.5)))).toBe("데이 근무, 7.5시간");
  });
});
