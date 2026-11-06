import { describe, expect, it } from "vitest";

import {
  applyDrag,
  availableCount,
  availabilityFromLinks,
  availabilityRules,
  cellKey,
  cellsFromSlots,
  copyDay,
  coversShift,
  isAvailabilityRule,
  mergeAvailabilityConflicts,
  sameAvailability,
  SLOT_COUNT,
  slotSpan,
  slotLabel,
  slotsFromCells,
  type AvailabilitySlots,
  unsubmittedCause,
} from "./availability";
import { DEFAULT_CONFIG } from "./rules";
import type { Rule, ShopConfig } from "./types.gen";

const CONFIG: ShopConfig = {
  shifts: [...DEFAULT_CONFIG.shifts, { code: "AC", name: "더블", hours: 12, parts: ["A", "C"] }],
};
const shift = (code: string) => CONFIG.shifts.find((s) => s.code === code)!;
const PERIOD = { start_date: "2026-11-02", length: 3 };
const LEE = { id: "e01", name: "이영희" };
const PARK = { id: "e02", name: "박민수" };
const FULL = [["09:00", "23:00"]] as [string, string][];

/** 규칙이 금지하는 날짜 인덱스. */
const forbiddenDays = (rules: Rule[], id: string) => {
  const body = rules.find((r) => r.id === id)?.body;
  return body?.kind === "require" ? body.for_each.days?.days : undefined;
};

describe("isAvailabilityRule", () => {
  it("avail- 접두사로 가른다", () => {
    expect(isAvailabilityRule("avail-e01-A")).toBe(true);
    expect(isAvailabilityRule("rule-max-run")).toBe(false);
  });
});

describe("mergeAvailabilityConflicts", () => {
  const conflict = (constraint_id: string, source_text: string) => ({ constraint_id, type: "rule", source_text });
  it("같은 직원의 가능 시간은 한 줄로 묶고 다른 규칙은 그대로 둔다", () => {
    const merged = mergeAvailabilityConflicts([
      conflict("avail-e01-A", "이영희 가능 시간"),
      conflict("r1", "같은 문장"),
      conflict("avail-e01-C", "이영희 가능 시간"),
      conflict("r2", "같은 문장"),
      conflict("avail-e02-A", "박민수 가능 시간"),
    ]);
    expect(merged.map((c) => c.constraint_id)).toEqual(["avail-e01-A", "r1", "r2", "avail-e02-A"]);
  });
});

describe("coversShift", () => {
  it("근무조 시각을 완전히 덮어야 한다", () => {
    expect(coversShift([["09:00", "15:00"]], shift("A"), CONFIG)).toBe(true);
    expect(coversShift([["08:00", "16:00"]], shift("A"), CONFIG)).toBe(true);
    expect(coversShift([["09:30", "15:00"]], shift("A"), CONFIG)).toBe(false);
    expect(coversShift([["09:00", "14:30"]], shift("A"), CONFIG)).toBe(false);
    expect(coversShift([], shift("A"), CONFIG)).toBe(false);
  });

  it("이어진 구간은 합쳐서 판단한다(순서 무관)", () => {
    expect(coversShift([["12:00", "15:00"], ["09:00", "12:00"]], shift("A"), CONFIG)).toBe(true);
    expect(coversShift([["09:00", "12:30"], ["12:00", "15:00"]], shift("A"), CONFIG)).toBe(true);
    expect(coversShift([["09:00", "12:00"], ["12:30", "15:00"]], shift("A"), CONFIG)).toBe(false);
  });

  it("24:00까지 덮는 구간도 판단한다", () => {
    const late = { code: "L", name: "늦은 마감", hours: 6, start: "18:00", end: "24:00" };
    expect(coversShift([["18:00", "24:00"]], late, CONFIG)).toBe(true);
    expect(coversShift([["18:00", "23:30"]], late, CONFIG)).toBe(false);
  });

  it("복합 코드는 parts가 모두 덮여야 한다", () => {
    expect(coversShift([["09:00", "15:00"], ["17:00", "23:00"]], shift("AC"), CONFIG)).toBe(true);
    expect(coversShift([["09:00", "15:00"]], shift("AC"), CONFIG)).toBe(false);
  });

  it("휴무는 시각이 없어 언제나 덮인다", () => {
    expect(coversShift([], shift("O"), CONFIG)).toBe(true);
  });
});

describe("availabilityRules", () => {
  it("직원 × 코드마다 덮지 못하는 날을 금지하는 반드시 규칙을 만든다", () => {
    const slots: AvailabilitySlots = { "2026-11-02": FULL, "2026-11-03": [["12:00", "18:00"]] };
    const rules = availabilityRules([LEE], CONFIG, PERIOD, { e01: slots }, []);
    expect(rules.map((r) => r.id)).toEqual(["avail-e01-A", "avail-e01-M", "avail-e01-C", "avail-e01-AC"]);
    expect(forbiddenDays(rules, "avail-e01-A")).toEqual([2, 3]);
    expect(forbiddenDays(rules, "avail-e01-M")).toEqual([3]);
    expect(forbiddenDays(rules, "avail-e01-C")).toEqual([2, 3]);
    expect(forbiddenDays(rules, "avail-e01-AC")).toEqual([2, 3]);
    expect(rules[0]).toMatchObject({
      type: "rule",
      hardness: "hard",
      enabled: true,
      scope: "period",
      source_text: "이영희 가능 시간",
      body: {
        kind: "require",
        for_each: { per: "person", people: { ids: ["e01"] } },
        then: { left: { shifts: { in: ["A"] } }, op: "eq", right: 0 },
      },
    });
  });

  it("다 덮는 코드는 규칙이 없고, 휴무 규칙은 만들지 않는다", () => {
    const allDays: AvailabilitySlots = { "2026-11-02": FULL, "2026-11-03": FULL, "2026-11-04": FULL };
    expect(availabilityRules([LEE], CONFIG, PERIOD, { e01: allDays }, [])).toEqual([]);
  });

  it("가능 시간이 없는 직원은 휴무 말고 모두 금지다", () => {
    const rules = availabilityRules([LEE, PARK], CONFIG, PERIOD, { e01: {} }, []);
    expect(rules.map((r) => r.id)).toEqual([
      ...["A", "M", "C", "AC"].map((c) => `avail-e01-${c}`),
      ...["A", "M", "C", "AC"].map((c) => `avail-e02-${c}`),
    ]);
    expect(forbiddenDays(rules, "avail-e02-M")).toEqual([1, 2, 3]);
    expect(rules.find((r) => r.id === "avail-e02-M")?.source_text).toBe("박민수 가능 시간");
  });

  it("고정 칸은 그 직원의 모든 코드에서 뺀다", () => {
    const fixed = [{ employee_id: "e01", day: 2 }, { employee_id: "e02", day: 1 }];
    const rules = availabilityRules([LEE], CONFIG, PERIOD, { e01: {} }, fixed);
    expect(forbiddenDays(rules, "avail-e01-A")).toEqual([1, 3]);
    expect(forbiddenDays(rules, "avail-e01-AC")).toEqual([1, 3]);
  });

  it("모든 날이 고정이면 규칙이 없다", () => {
    const fixed = [1, 2, 3].map((day) => ({ employee_id: "e01", day }));
    expect(availabilityRules([LEE], CONFIG, PERIOD, { e01: {} }, fixed)).toEqual([]);
  });

  it("꺼진 코드는 배정되지 않으므로 규칙을 만들지 않는다", () => {
    const config = { shifts: CONFIG.shifts.map((s) => (s.code === "M" ? { ...s, active: false } : s)) } as ShopConfig;
    expect(availabilityRules([LEE], config, PERIOD, { e01: {} }, []).map((r) => r.id)).toEqual([
      "avail-e01-A",
      "avail-e01-C",
      "avail-e01-AC",
    ]);
  });
});

describe("slotLabel", () => {
  it("06:00에서 24:00까지 30분 칸 36개다", () => {
    expect(SLOT_COUNT).toBe(36);
    expect(slotLabel(0)).toEqual(["06:00", "06:30"]);
    expect(slotLabel(13)).toEqual(["12:30", "13:00"]);
    expect(slotLabel(35)).toEqual(["23:30", "24:00"]);
  });
});

describe("slots ↔ 칸", () => {
  const DAY = "2026-11-03";

  it("구간을 칸으로 펼친다", () => {
    const cells = cellsFromSlots({ [DAY]: [["06:00", "07:00"], ["23:30", "24:00"]] });
    expect([...cells].sort()).toEqual([cellKey(DAY, 0), cellKey(DAY, 1), cellKey(DAY, 35)].sort());
  });

  it("이어진 칸은 구간 하나로 합치고 날짜별로 나눈다", () => {
    const cells = new Set([cellKey(DAY, 12), cellKey(DAY, 13), cellKey(DAY, 15), cellKey("2026-11-02", 0)]);
    expect(slotsFromCells(cells)).toEqual({
      "2026-11-02": [["06:00", "06:30"]],
      [DAY]: [["12:00", "13:00"], ["13:30", "14:00"]],
    });
  });

  it("칸이 없으면 빈 객체다", () => {
    expect(slotsFromCells(new Set())).toEqual({});
  });

  it("왕복해도 같다", () => {
    const slots: AvailabilitySlots = { [DAY]: [["12:00", "23:00"]], "2026-11-05": [["12:00", "18:00"]] };
    expect(slotsFromCells(cellsFromSlots(slots))).toEqual(slots);
    expect(cellsFromSlots(slots).size).toBe(34);
  });
});

describe("applyDrag", () => {
  const DAY = "2026-11-03";
  const keys = (...slots: number[]) => slots.map((i) => cellKey(DAY, i));

  it("빈 칸에서 시작하면 범위를 칠한다. 위로 끌어도 같다", () => {
    expect([...applyDrag(new Set(), [DAY], 2, 4)].sort()).toEqual(keys(2, 3, 4).sort());
    expect([...applyDrag(new Set(), [DAY], 4, 2)].sort()).toEqual(keys(2, 3, 4).sort());
  });

  it("칠한 칸에서 시작하면 범위를 지운다", () => {
    expect([...applyDrag(new Set(keys(2, 3, 4, 5)), [DAY], 3, 4)].sort()).toEqual(keys(2, 5).sort());
  });

  it("빈 칸에서 시작해 칠한 칸을 지나도 칠한 채로 둔다", () => {
    expect([...applyDrag(new Set(keys(3)), [DAY], 2, 4)].sort()).toEqual(keys(2, 3, 4).sort());
  });

  it("원본과 다른 날은 건드리지 않는다", () => {
    const base = new Set([cellKey("2026-11-02", 2)]);
    const next = applyDrag(base, [DAY], 2, 2);
    expect(next.has(cellKey("2026-11-02", 2))).toBe(true);
    expect(base.size).toBe(1);
  });

  const DATES = ["2026-11-02", "2026-11-03", "2026-11-04"];
  const rect = (dates: string[], ...slots: number[]) => dates.flatMap((d) => slots.map((i) => cellKey(d, i))).sort();

  it("열 셋을 건너면 날짜 × 시간 직사각형을 칠한다", () => {
    expect([...applyDrag(new Set(), DATES, 2, 5)].sort()).toEqual(rect(DATES, 2, 3, 4, 5));
  });

  it("시작 칸이 칠해져 있으면 직사각형을 지운다. 일부만 칠해져 있어도 모두 지운다", () => {
    const outside = cellKey("2026-11-05", 3);
    const base = new Set([cellKey(DATES[0], 2), cellKey(DATES[2], 4), outside]);
    expect([...applyDrag(base, DATES, 2, 5)]).toEqual([outside]);
    expect([...applyDrag(new Set([...rect(DATES, 2, 3, 4, 5), outside]), DATES, 2, 5)]).toEqual([outside]);
  });

  it("시작 칸이 비어 있으면 칠한 칸이 섞여 있어도 모두 칠한다", () => {
    const base = new Set([cellKey(DATES[1], 3)]);
    expect([...applyDrag(base, DATES, 2, 5)].sort()).toEqual(rect(DATES, 2, 3, 4, 5));
  });

  it("왼쪽 위로 끌어도(뒤집힌 순서) 같은 직사각형이다", () => {
    const reversed = [...DATES].reverse();
    expect([...applyDrag(new Set(), reversed, 5, 2)].sort()).toEqual(rect(DATES, 2, 3, 4, 5));
  });

  it("지우기 판정은 시작 열(dates[0])의 시작 칸으로 한다", () => {
    const base = new Set([cellKey(DATES[2], 5)]);
    expect([...applyDrag(base, [...DATES].reverse(), 5, 2)]).toEqual([]);
    expect([...applyDrag(base, DATES, 5, 2)].sort()).toEqual(rect(DATES, 2, 3, 4, 5));
  });
});

describe("copyDay", () => {
  const [MON, TUE, WED] = ["2026-11-02", "2026-11-03", "2026-11-04"];
  const keysOf = (cells: Set<string>, date: string) => [...cells].filter((k) => k.startsWith(`${date}@`)).sort();

  it("월요일 09:00~15:00을 화·수에 더하고 화요일의 기존 칸은 남긴다", () => {
    const cells = cellsFromSlots({ [MON]: [["09:00", "15:00"]], [TUE]: [["18:00", "20:00"]] });
    const next = copyDay(cells, MON, [TUE, WED]);
    expect(slotsFromCells(next)).toEqual({
      [MON]: [["09:00", "15:00"]],
      [TUE]: [["09:00", "15:00"], ["18:00", "20:00"]],
      [WED]: [["09:00", "15:00"]],
    });
    expect(cells.size).toBe(16);
  });

  it("from이 비어 있으면 그대로다", () => {
    const cells = cellsFromSlots({ [TUE]: [["18:00", "20:00"]] });
    expect([...copyDay(cells, MON, [TUE, WED])].sort()).toEqual([...cells].sort());
  });

  it("from이 to에 있어도 된다", () => {
    const cells = cellsFromSlots({ [MON]: [["09:00", "10:00"]] });
    const next = copyDay(cells, MON, [MON, TUE]);
    expect(keysOf(next, MON)).toEqual(keysOf(cells, MON));
    expect(slotsFromCells(next)[TUE]).toEqual([["09:00", "10:00"]]);
  });
});

describe("availabilityFromLinks", () => {
  it("직원 id로 묶고 아직 비어 있는 행은 뺀다", () => {
    const slots: AvailabilitySlots = { "2026-11-02": [["09:00", "15:00"]] };
    expect(availabilityFromLinks([{ employee_id: "e01", slots }, { employee_id: "e02", slots: {} }])).toEqual({ e01: slots });
  });
});

describe("sameAvailability", () => {
  const a: AvailabilitySlots = { "2026-11-02": [["09:00", "15:00"]], "2026-11-03": [["12:00", "18:00"]] };
  const reordered: AvailabilitySlots = { "2026-11-03": [["12:00", "18:00"]], "2026-11-02": [["09:00", "15:00"]] };

  it("키 순서는 보지 않는다", () => {
    expect(sameAvailability({ e01: a }, { e01: reordered })).toBe(true);
  });

  it("칸이 다르면 다르다", () => {
    expect(sameAvailability({ e01: a }, { e01: { "2026-11-02": [["09:00", "15:30"]] } })).toBe(false);
    expect(sameAvailability({ e01: a }, {})).toBe(false);
  });
});

describe("slotSpan", () => {
  it("구간을 시작 칸과 끝 칸(끝 칸 미포함)으로 바꾼다", () => {
    expect(slotSpan(["06:00", "06:30"])).toEqual([0, 1]);
    expect(slotSpan(["09:00", "18:00"])).toEqual([6, 24]);
    expect(slotSpan(["17:00", "24:00"])).toEqual([22, SLOT_COUNT]);
  });
});

describe("availableCount", () => {
  const DATE = "2026-11-02";
  const slots = (...ranges: [string, string][]): AvailabilitySlots => ({ [DATE]: ranges });

  it("근무조 시각을 완전히 덮는 직원만 센다", () => {
    const list = [slots(["09:00", "23:00"]), slots(["09:00", "15:00"]), slots(["12:00", "18:00"])];
    expect(availableCount(list, DATE, shift("A"), CONFIG)).toBe(2);
    expect(availableCount(list, DATE, shift("C"), CONFIG)).toBe(1);
  });

  it("나눠 칠해도 이어지면 덮은 것으로 센다", () => {
    expect(availableCount([slots(["09:00", "12:00"], ["12:00", "15:00"])], DATE, shift("A"), CONFIG)).toBe(1);
  });

  it("그날 칠하지 않았거나 비어 있으면 세지 않는다", () => {
    expect(availableCount([{}, { "2026-11-03": FULL }], DATE, shift("A"), CONFIG)).toBe(0);
  });
});

describe("unsubmittedCause", () => {
  const ACTIVE = ["e01", "e02", "e03"];
  it("제출한 직원이 없으면 충돌과 무관하게 true", () => {
    expect(unsubmittedCause(["cov-a"], [], ACTIVE)).toBe(true);
    expect(unsubmittedCause([], [], ACTIVE)).toBe(true);
  });
  it("충돌에 걸린 가능 시간 직원이 모두 미제출이면 true", () => {
    expect(unsubmittedCause(["cov-a", "avail-e01-A", "avail-e02-M"], ["e03"], ACTIVE)).toBe(true);
  });
  it("걸린 직원 중 하나라도 제출했으면 false", () => {
    expect(unsubmittedCause(["avail-e01-A", "avail-e02-M"], ["e02"], ACTIVE)).toBe(false);
  });
  it("충돌에 가능 시간 규칙이 없고 제출자가 있으면 false", () => {
    expect(unsubmittedCause(["cov-a", "rule-x"], ["e01"], ACTIVE)).toBe(false);
  });
  it("활성 직원이 없으면 false", () => {
    expect(unsubmittedCause(["cov-a"], [], [])).toBe(false);
  });
  it("직원 id에 -가 있어도 마지막 - 뒤를 코드로 본다", () => {
    expect(unsubmittedCause(["avail-emp-1-AC"], ["e01"], ["emp-1", "e01"])).toBe(true);
    expect(unsubmittedCause(["avail-emp-1-AC"], ["emp-1"], ["emp-1", "e01"])).toBe(false);
  });
  it("제출자 판정은 활성 직원만 센다", () => {
    expect(unsubmittedCause(["cov-a"], ["e99"], ACTIVE)).toBe(true);
  });
});
