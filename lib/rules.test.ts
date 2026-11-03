import { describe, expect, it } from "vitest";

import { balance, count, fixedCell, forbid, maxRun, minRun, OFF, offAfter, WORK } from "./test-rules";
import { closingShift, DEFAULT_CONFIG, normalizeRule, ruleShape, shiftTimesError, shiftTones } from "./rules";
import type { ConstraintSpec, Rule, Shifts, ShopConfig } from "./types.gen";

const N: Shifts = { in: ["N"] };
const D: Shifts = { in: ["D"] };

describe("DEFAULT_CONFIG", () => {
  it("오픈·미들·마감 + 휴무", () => {
    expect(DEFAULT_CONFIG.shifts.map((s) => [s.code, s.name, s.start, s.end, s.hours])).toEqual([
      ["A", "오픈", "09:00", "15:00", 6],
      ["M", "미들", "12:00", "18:00", 6],
      ["C", "마감", "17:00", "23:00", 6],
      ["O", "휴무", undefined, undefined, 0],
    ]);
  });
});

describe("shiftTimesError", () => {
  it("30분 단위, 24:00까지 받는다", () => {
    expect(shiftTimesError("09:00", "15:30")).toBeNull();
    expect(shiftTimesError("17:30", "24:00")).toBeNull();
  });
  it("형식이 틀리면 형식 오류", () => {
    for (const [s, e] of [["9:00", "15:00"], ["09:15", "15:00"], ["09:00", "24:30"], ["", "15:00"]]) {
      expect(shiftTimesError(s, e)).toContain("30분 단위");
    }
  });
  it("끝이 시작보다 빠르거나 같으면(자정을 넘기면) 오류", () => {
    expect(shiftTimesError("22:00", "02:00")).toContain("자정");
    expect(shiftTimesError("09:00", "09:00")).toContain("자정");
  });
});

describe("closingShift", () => {
  it("기본 근무 형태는 마감", () => {
    expect(closingShift(DEFAULT_CONFIG)?.code).toBe("C");
  });
  it("코드와 이름이 달라도 가장 늦게 끝나는 활성 기본 코드", () => {
    const shifts: ShopConfig["shifts"] = [
      { code: "X", name: "저녁", hours: 6, start: "16:00", end: "22:00" },
      { code: "Y", name: "야간", hours: 6, start: "18:00", end: "24:00", active: false },
      { code: "Z", name: "늦은 저녁", hours: 4, start: "18:00", end: "22:00" },
      { code: "XZ", name: "더블", hours: 10, parts: ["X", "Z"] },
      { code: "O", name: "휴무", hours: 0 },
    ];
    expect(closingShift({ shifts })?.code).toBe("Z");
  });
  it("세는 근무조가 없으면 null", () => {
    expect(closingShift({ shifts: [{ code: "O", name: "휴무", hours: 0 }] })).toBeNull();
  });
});

describe("normalizeRule", () => {
  it("Pydantic dump와 같은 기본값을 채우고 weight를 중요도에서 정한다", () => {
    const raw = {
      id: "r",
      type: "rule",
      scope: "shop",
      source_text: "원문",
      weight: 99,
      values: { min: { value: 1, label: "인원" } },
      body: {
        kind: "require",
        for_each: { per: "day", window: null },
        when: null,
        then: { left: { who: { tags: ["책임"], ids: null }, shifts: { in: ["D"], not_in: null } }, op: "ge", right: { value: "min" } },
      },
    } as unknown as ConstraintSpec;
    expect(normalizeRule(raw)).toEqual({
      id: "r",
      type: "rule",
      scope: "shop",
      hardness: "hard",
      priority: "normal",
      weight: 10,
      enabled: true,
      default: false,
      source_text: "원문",
      values: { min: { value: 1, label: "인원" } },
      body: {
        kind: "require",
        for_each: { per: "day", people: { exclude_tags: [] }, days: { kind: "all" } },
        then: {
          left: { who: { tags: ["책임"], exclude_tags: [] }, days: { kind: "all" }, shifts: { in: ["D"] }, measure: "count" },
          op: "ge",
          right: { value: "min" },
        },
      },
    });
  });

  it("고르게는 기본이 가능하면·낮음, max_gap 1", () => {
    const raw = { id: "b", type: "rule", scope: "shop", source_text: "", body: { kind: "balance", shifts: { in: ["N"] } } } as unknown as Rule;
    expect(normalizeRule(raw)).toMatchObject({
      hardness: "soft",
      priority: "low",
      weight: 5,
      values: {},
      body: { kind: "balance", people: { exclude_tags: [] }, days: { kind: "all" }, measure: "count", with_history: true, max_gap: 1 },
    });
  });

});

describe("칸 고정", () => {
  it("normalizeRule은 항상 hard, 기본값을 채운다", () => {
    expect(fixedCell("e01", 2, "E")).toEqual({
      id: "f",
      type: "fixed_assignment",
      scope: "period",
      hardness: "hard",
      weight: 10,
      enabled: true,
      source_text: "",
      params: { employee_id: "e01", day: 2, shift: "E" },
    });
  });
});

describe("ruleShape: 블록 모양으로 되읽기", () => {
  it("세기: 범위·최소·최대와 값 이름", () => {
    expect(ruleShape(count({ days: { kind: "weekday" }, shifts: D, per: "day", min: 3, max: 4 }))).toMatchObject({ kind: "count", per: "day", min: { n: 3, name: "min" }, max: { n: 4, name: "max" } });
    expect(ruleShape(count({ shifts: N, per: "day", min: 2, max: 2 }))).toMatchObject({ kind: "count", min: { n: 2, name: "min" }, max: { n: 2, name: "min" } });
    expect(ruleShape(count({ shifts: WORK, per: "person_week", measure: "hours", max: 52 }))).toMatchObject({ kind: "count", per: "person_week", measure: "hours" });
  });

  it("순서: 금지 패턴, 최대·최소 연속, 다음 휴무", () => {
    const long = ruleShape(forbid([N, OFF, D], { tags: ["신규"] }));
    expect(long).toMatchObject({ kind: "forbid" });
    expect((long as { pattern: unknown[] }).pattern).toHaveLength(3);
    expect(ruleShape(maxRun(N, 3))).toMatchObject({ kind: "max_run", run: N, max_len: { n: 3, name: "max_len" } });
    expect(ruleShape(minRun(N, 2))).toMatchObject({ kind: "min_run", min_len: 2 });
    expect(ruleShape(offAfter(N, 2))).toMatchObject({ kind: "off_after", after: N, then_off: 2 });
  });

  it("고르게와 칸 고정", () => {
    expect(ruleShape(balance({ shifts: N, max_gap: 0 }, { hardness: "hard" }))).toMatchObject({ kind: "balance", max_gap: { name: "max_gap" } });
    expect(ruleShape(fixedCell("e01", 2, "E"))).toBeNull();
  });

  it("틀에 없는 식(조건부·세기끼리)은 null", () => {
    const rule = {
      id: "x",
      type: "rule",
      scope: "shop",
      source_text: "",
      body: {
        kind: "require",
        for_each: { per: "day" },
        when: { left: { who: { tags: ["신규"] }, shifts: { in: ["N"] } }, op: "ge", right: 1 },
        then: { left: { who: { tags: ["책임"] }, shifts: { in: ["N"] } }, op: "ge", right: 1 },
      },
    } as unknown as Rule;
    expect(ruleShape(rule)).toBeNull();
  });
});

describe("shiftTones", () => {
  const shift = (code: string, start?: string, extra: object = {}) => ({ code, name: code, hours: 6, ...(start && { start, end: "23:00" }), ...extra });
  const config = (...shifts: object[]) => ({ shifts: [...shifts, { code: "O", name: "휴무", hours: 0 }] }) as unknown as ShopConfig;

  it("기본 근무 형태: 오픈 밝게, 마감 진하게, 휴무는 off", () => {
    expect(shiftTones(DEFAULT_CONFIG)).toEqual({ A: 0, M: 2, C: 4, O: "off" });
  });

  it("설정 순서가 아니라 시작 시각 순으로 밝은 색부터 칠한다", () => {
    expect(shiftTones(config(shift("N", "22:00"), shift("D", "07:00"), shift("E", "15:00")))).toEqual({ D: 0, E: 2, N: 4, O: "off" });
  });

  it("근무조 수에 맞춰 다섯 단계에 고르게 나눈다", () => {
    expect(shiftTones(config(shift("D", "07:00")))).toEqual({ D: 2, O: "off" });
    expect(shiftTones(config(shift("D", "07:00"), shift("N", "22:00")))).toEqual({ D: 0, N: 4, O: "off" });
    expect(shiftTones(config(shift("A", "07:00"), shift("B", "10:00"), shift("C", "14:00"), shift("D", "18:00")))).toEqual({
      A: 0,
      B: 1,
      C: 3,
      D: 4,
      O: "off",
    });
  });

  it("더블처럼 근무조를 합친 코드는 multi, 꺼진 코드도 색을 받는다", () => {
    const tones = shiftTones(config(shift("A", "09:00"), shift("C", "17:00", { active: false }), shift("AC", undefined, { parts: ["A", "C"] })));
    expect(tones).toEqual({ A: 0, C: 4, AC: "multi", O: "off" });
  });

  it("시작 시각이 없는 코드가 있으면 설정 순서를 쓴다", () => {
    expect(shiftTones(config(shift("N", "22:00"), shift("D")))).toEqual({ N: 0, D: 4, O: "off" });
  });
});
