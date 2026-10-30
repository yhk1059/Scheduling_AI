import { describe, expect, it } from "vitest";

import { balance, count, fixedCell, forbid, maxRun, minRun, OFF, offAfter, WORK } from "./test-rules";
import { DEFAULT_CONFIG, NIGHT_ONLY_RULE_ID, NIGHT_ONLY_TAG, nightOnlyRule, normalizeRule, ruleShape } from "./rules";
import type { ConstraintSpec, Rule, Shifts } from "./types.gen";

const N: Shifts = { in: ["N"] };
const D: Shifts = { in: ["D"] };

describe("DEFAULT_CONFIG", () => {
  it("D/E/N 8시간 + O", () => {
    expect(DEFAULT_CONFIG.shifts.map((s) => [s.code, s.name, s.hours])).toEqual([
      ["D", "데이", 8],
      ["E", "이브닝", 8],
      ["N", "나이트", 8],
      ["O", "휴무", 0],
    ]);
  });
});

describe("normalizeRule", () => {
  it("Pydantic dump와 같은 기본값을 채우고 weight를 중요도에서 정한다", () => {
    const raw = {
      id: "r",
      type: "rule",
      scope: "ward",
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
      scope: "ward",
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
    const raw = { id: "b", type: "rule", scope: "ward", source_text: "", body: { kind: "balance", shifts: { in: ["N"] } } } as unknown as Rule;
    expect(normalizeRule(raw)).toMatchObject({
      hardness: "soft",
      priority: "low",
      weight: 5,
      values: {},
      body: { kind: "balance", people: { exclude_tags: [] }, days: { kind: "all" }, measure: "count", with_history: true, max_gap: 1 },
    });
  });

  it("나이트 전담 기본 규칙은 default 식 규칙", () => {
    expect(nightOnlyRule()).toEqual(
      count({ people: { tags: [NIGHT_ONLY_TAG] }, shifts: { not_in: ["N", "O"] }, per: "person", max: 0 }, { id: NIGHT_ONLY_RULE_ID, hardness: "hard", source_text: "나이트 전담은 나이트와 휴무만", default: true }),
    );
    expect(nightOnlyRule()).toMatchObject({ id: NIGHT_ONLY_RULE_ID, default: true });
  });
});

describe("칸 고정", () => {
  it("normalizeRule은 항상 hard, 기본값을 채운다", () => {
    expect(fixedCell("n01", 2, "E")).toEqual({
      id: "f",
      type: "fixed_assignment",
      scope: "period",
      hardness: "hard",
      weight: 10,
      enabled: true,
      source_text: "",
      params: { nurse_id: "n01", day: 2, shift: "E" },
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
    expect(ruleShape(fixedCell("n01", 2, "E"))).toBeNull();
  });

  it("틀에 없는 식(조건부·세기끼리)은 null", () => {
    const rule = {
      id: "x",
      type: "rule",
      scope: "ward",
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
