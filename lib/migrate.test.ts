import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  blockToRules,
  DEFAULT_CONFIG,
  legacyToBlock,
  migrateV4,
  migrateV5,
  NIGHT_ONLY_RULE_ID,
  NIGHT_ONLY_TAG,
  nightOnlyBlock,
  nightOnlyRule,
  normalizeRule,
  ruleShape,
  STORAGE_VERSION,
  tagged,
  normalizeBlock,
  upgradeDoc,
  type BlockSpec,
  type LegacySpec,
} from "./migrate";
import type { ConstraintSpec, Rule } from "./types.gen";

interface ConvertCase {
  name: string;
  period: { start_date: string; length: number };
  holidays: number[];
  template: LegacySpec | null;
  block: BlockSpec;
}

interface ExprCase {
  name: string;
  block: BlockSpec;
  rules: ConstraintSpec[];
}

const ROOT = join(__dirname, "..");
const CASES: ConvertCase[] = JSON.parse(readFileSync(join(ROOT, "backend/tests/golden/convert-cases.json"), "utf-8"));
const EXPR_CASES: ExprCase[] = JSON.parse(readFileSync(join(ROOT, "backend/tests/golden/expr-convert-cases.json"), "utf-8"));
const FIXTURE = JSON.parse(readFileSync(join(ROOT, "e2e/fixtures/ward-oct.json"), "utf-8"));

describe("legacyToBlock: Python 변환(convert-cases.json)과 같다", () => {
  for (const c of CASES.filter((c) => c.template)) {
    it(c.name, () => {
      expect(legacyToBlock(c.template!, c.period, c.holidays)).toEqual(c.block);
    });
  }

  it("나이트 전담 기본 규칙", () => {
    const c = CASES.find((c) => c.template === null)!;
    expect(nightOnlyBlock()).toEqual(c.block);
    expect(NIGHT_ONLY_RULE_ID).toBe(c.block.id);
  });

  it("예상 밖 params는 throw한다", () => {
    const base = { id: "x", scope: "ward", source_text: "원문" } as const;
    expect(() => legacyToBlock({ ...base, type: "max_consecutive_work", params: { days: "5" } } as unknown as LegacySpec)).toThrow();
    expect(() => legacyToBlock({ ...base, type: "daily_coverage", params: { shift: "M", day_kind: "weekday", min: 1, max: 1 } } as unknown as LegacySpec)).toThrow();
    expect(() => legacyToBlock({ ...base, type: "모르는_템플릿", params: {} } as unknown as LegacySpec)).toThrow();
    // 희망 근무 전체 기간은 기간이 있어야 센다
    expect(() =>
      legacyToBlock({ ...base, type: "shift_preference", params: { nurse_id: "n01", shift: "O", prefer: true } } as unknown as LegacySpec),
    ).toThrow();
  });
});

describe("normalizeBlock", () => {
  it("셀렉터 기본값을 채우고 null을 지우며 weight를 중요도에서 정한다", () => {
    const raw = {
      id: "r",
      type: "count",
      scope: "ward",
      source_text: "원문",
      params: { people: { ids: null, tags: ["책임"] }, shifts: { in: ["D"], not_in: null }, per: "day", min: 1, max: null },
    } as unknown as BlockSpec;
    expect(normalizeBlock(raw)).toEqual({
      id: "r",
      type: "count",
      scope: "ward",
      hardness: "hard",
      priority: "normal",
      weight: 10,
      enabled: true,
      source_text: "원문",
      params: {
        people: { tags: ["책임"], exclude_tags: [] },
        days: { kind: "all" },
        shifts: { in: ["D"] },
        per: "day",
        measure: "count",
        min: 1,
      },
    });
  });

  it("고르게는 기본이 가능하면·낮음", () => {
    const raw = { id: "b", type: "balance", scope: "ward", source_text: "", params: { shifts: { in: ["N"] } } } as unknown as BlockSpec;
    expect(normalizeBlock(raw)).toMatchObject({ hardness: "soft", priority: "low", weight: 5, params: { with_history: true, max_gap: 1 } });
  });

  it("DEFAULT_CONFIG는 D/E/N 8시간 + O", () => {
    expect(DEFAULT_CONFIG.shifts.map((s) => [s.code, s.name, s.hours])).toEqual([
      ["D", "데이", 8],
      ["E", "이브닝", 8],
      ["N", "나이트", 8],
      ["O", "휴무", 0],
    ]);
  });
});

describe("migrateV4", () => {
  const today = "2026-10-28";

  it("e2e 픽스처(v4)를 v5로: 기본 근무 형태, 태그, 규칙·요청 수, 기본 규칙", () => {
    const v4 = FIXTURE.state;
    const v5 = migrateV4(v4, today)!;
    expect(v5).not.toBeNull();
    const w = v5.ward!;
    expect(w.config).toEqual(DEFAULT_CONFIG);
    expect(w.unconverted).toEqual([]);
    expect(w.pendingConfig).toEqual([]);
    expect(w.rules).toHaveLength(v4.ward.rules.length + 1);
    expect(w.rules.at(-1)).toEqual(nightOnlyBlock());
    expect(w.rules.every((r) => ["count", "sequence", "balance"].includes(r.type))).toBe(true);
    expect(w.rules.map((r) => r.id).slice(0, v4.ward.rules.length)).toEqual(v4.ward.rules.map((r: { id: string }) => r.id));
    expect(w.nurses.filter((n) => n.tags.includes(NIGHT_ONLY_TAG)).map((n) => n.name)).toEqual(["문가람", "배수아"]);
    expect(w.nurses.every((n) => !("night_only" in n))).toBe(true);

    const [oct, nov] = v5.periods;
    expect(nov.requests.map((r) => [r.id, r.type, r.hardness])).toEqual([
      ["req-leave-n01", "count", "hard"],
      ["req-avoid-n02", "count", "soft"],
      ["req-prefer-n04", "count", "soft"],
    ]);
    // 희망 min은 그 기간의 대상 날짜 수
    expect(nov.requests[2].params).toMatchObject({ people: { ids: ["n04"] }, days: { days: [20] }, min: 1 });
    expect(oct.snapshot!.rules).toHaveLength(v4.periods[0].snapshot.rules.length);
    expect(oct.snapshot!.nurses.find((n) => n.name === "문가람")!.tags).toEqual([NIGHT_ONLY_TAG]);
    // 옛 결과는 그대로 두고, 운영 중인 10월은 stale로 표시한다
    expect(oct.result).toEqual(v4.periods[0].result);
    expect(oct.resultVersion).not.toBe(v5.inputVersion);
    expect(oct.resultVersion).not.toBeNull();
    expect(nov.result).toBeNull();
    expect(nov.resultVersion).toBeNull();
    expect(v5.view).toEqual(v4.view);
    expect(v5.inputVersion).toBe(v4.inputVersion);
  });

  it("작성 중 결과는 stale, 끝난 확정 기간의 결과는 그대로 둔다", () => {
    const v4 = structuredClone(FIXTURE.state);
    v4.periods[1].result = v4.periods[0].result;
    v4.periods[1].resultVersion = v4.inputVersion;
    expect(migrateV4(v4, today)!.periods[1].resultVersion).not.toBe(v4.inputVersion);
    const after = migrateV4(v4, "2026-12-15")!;
    expect(after.periods[0].resultVersion).toBe(v4.periods[0].resultVersion);
  });

  it("확정본 버전의 요청, ruleOverrides, 대기 카드도 바꾼다", () => {
    const v4 = structuredClone(FIXTURE.state);
    const leave = v4.periods[1].requests[0];
    v4.periods[1].versions = [{ confirmed_at: "x", assignments: {}, changed: [], requests: [leave] }];
    v4.periods[1].pendingRequests = [leave];
    v4.periods[1].ruleOverrides = { "rule-max-work": { ...v4.ward.rules[7], params: { days: 4 } } };
    v4.ward.pendingRules = [v4.ward.rules[8]];
    const v5 = migrateV4(v4, today)!;
    const nov = v5.periods[1];
    expect(nov.versions[0].requests![0]).toEqual(nov.requests[0]);
    expect(nov.pendingRequests[0].type).toBe("count");
    expect(nov.ruleOverrides["rule-max-work"]).toMatchObject({ type: "sequence", params: { max_len: 4 } });
    expect(v5.ward!.pendingRules[0]).toMatchObject({ type: "sequence", params: { run: { in: ["N"] }, max_len: 3 } });
  });

  it("변환하지 못한 제약은 원문만 unconverted로 옮기고 나머지는 남긴다", () => {
    const v4 = structuredClone(FIXTURE.state);
    v4.ward.rules.push({ id: "bad", type: "skill_mix", scope: "ward", hardness: "hard", weight: 1, source_text: "이상한 규칙", enabled: true, params: { shift: "X" } });
    v4.periods[1].requests.push({ id: "bad2", type: "모르는", scope: "period", source_text: "이상한 요청", params: {} });
    const v5 = migrateV4(v4, today)!;
    expect(v5.ward!.unconverted).toEqual([{ source_text: "이상한 규칙" }, { source_text: "이상한 요청" }]);
    expect(v5.ward!.rules.some((r) => r.id === "bad")).toBe(false);
    expect(v5.periods[1].requests).toHaveLength(3);
  });

  it("기본 규칙이 이미 있으면 다시 넣지 않고, 병동이 없으면 그대로 둔다", () => {
    const once = migrateV4(FIXTURE.state, today)!;
    const v4 = structuredClone(FIXTURE.state);
    v4.ward.rules.push(nightOnlyBlock());
    expect(migrateV4(v4, today)!.ward!.rules.filter((r) => r.id === NIGHT_ONLY_RULE_ID)).toHaveLength(1);
    expect(once.ward!.rules.filter((r) => r.id === NIGHT_ONLY_RULE_ID)).toHaveLength(1);
    const empty = migrateV4({ ward: null, periods: [], view: { screen: "home" }, inputVersion: 3 }, today)!;
    expect(empty).toEqual({ ward: null, periods: [], view: { screen: "home" }, inputVersion: 3 });
  });

  it("모양이 v4가 아니면 null", () => {
    expect(migrateV4(null, today)).toBeNull();
    expect(migrateV4({ ward: { nurses: "x" }, periods: [], view: { screen: "home" }, inputVersion: 1 }, today)).toBeNull();
    expect(migrateV4({ step: 3 }, today)).toBeNull();
  });
});

describe("tagged", () => {
  it("옛 명단의 나이트 전담 표시를 태그로 바꾸고 다른 필드는 그대로 둔다", () => {
    expect(tagged({ id: "n01", name: "가", years: 3, night_only: true })).toEqual({ id: "n01", name: "가", years: 3, tags: [NIGHT_ONLY_TAG] });
    expect(tagged({ id: "n02", name: "나", years: 1, night_only: false, tags: ["책임"] })).toEqual({ id: "n02", name: "나", years: 1, tags: ["책임"] });
    expect(tagged({ id: "n03", name: "다", years: 1, night_only: true, tags: [NIGHT_ONLY_TAG] }).tags).toEqual([NIGHT_ONLY_TAG]);
  });
});

describe("blockToRules: Python block_to_rules(expr-convert-cases.json)와 같다", () => {
  for (const c of EXPR_CASES) {
    it(c.name, () => {
      expect(blockToRules(c.block)).toEqual(c.rules);
    });
  }

  it("기본값이 빠진 블록도 같은 결과(저장 문서의 블록은 생략된 필드가 있을 수 있다)", () => {
    const c = EXPR_CASES.find((x) => x.name === "run-min-max-split")!;
    const raw = { ...c.block, weight: undefined, enabled: undefined } as unknown as BlockSpec;
    expect(blockToRules(raw)).toEqual(c.rules);
  });

  it("규칙과 칸 고정은 기본값만 채운 한 개짜리 목록", () => {
    const rule = EXPR_CASES.find((x) => x.name === "count-day-min")!.rules[0];
    expect(blockToRules(rule)).toEqual([rule]);
    const fixed = EXPR_CASES.find((x) => x.name === "fixed-assignment")!;
    expect(blockToRules(fixed.block)).toEqual(fixed.rules);
  });

  it("식으로 바꿀 수 없는 블록은 throw한다", () => {
    const base = { id: "x", scope: "ward", source_text: "", hardness: "hard" } as const;
    // min_len 1만 있는 순서, 세기 범위 없음, 창 15일(최대 연속 14일)
    expect(() => blockToRules({ ...base, type: "sequence", params: { run: { in: ["N"] }, min_len: 1 } } as BlockSpec)).toThrow();
    expect(() => blockToRules({ ...base, type: "count", params: { shifts: { in: ["D"] }, per: "day" } } as BlockSpec)).toThrow();
    expect(() => blockToRules({ ...base, type: "sequence", params: { run: { in: ["N"] }, max_len: 14 } } as BlockSpec)).toThrow();
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
    const c = EXPR_CASES.find((x) => x.name === "default-night-only")!;
    expect(nightOnlyRule()).toEqual(c.rules[0]);
    expect(nightOnlyRule()).toMatchObject({ id: NIGHT_ONLY_RULE_ID, default: true });
  });
});

describe("ruleShape: 블록 모양으로 되읽기", () => {
  const shapeOf = (name: string, i = 0) => ruleShape(EXPR_CASES.find((x) => x.name === name)!.rules[i]);

  it("세기: 범위·최소·최대와 값 이름", () => {
    expect(shapeOf("count-day-min-max")).toMatchObject({ kind: "count", per: "day", min: { n: 3, name: "min" }, max: { n: 4, name: "max" } });
    expect(shapeOf("count-day-eq")).toMatchObject({ kind: "count", min: { n: 2, name: "min" }, max: { n: 2, name: "min" } });
    expect(shapeOf("count-person-week-hours")).toMatchObject({ kind: "count", per: "person_week", measure: "hours" });
  });

  it("순서: 금지 패턴, 최대·최소 연속, 다음 휴무", () => {
    expect(shapeOf("forbid-3-long")).toMatchObject({ kind: "forbid" });
    expect((shapeOf("forbid-3-long") as { pattern: unknown[] }).pattern).toHaveLength(3);
    expect(shapeOf("run-max-len-night")).toMatchObject({ kind: "max_run", run: { in: ["N"] }, max_len: { n: 3, name: "max_len" } });
    expect(shapeOf("run-min-max-split", 1)).toMatchObject({ kind: "min_run", min_len: 2 });
    expect(shapeOf("after-then-off-2")).toMatchObject({ kind: "off_after", after: { in: ["N"] }, then_off: 2 });
  });

  it("고르게와 칸 고정", () => {
    expect(shapeOf("balance-hard-gap")).toMatchObject({ kind: "balance", max_gap: { name: "max_gap" } });
    expect(shapeOf("fixed-assignment")).toBeNull();
  });

  it("변환표의 모든 규칙을 블록 모양으로 되읽는다", () => {
    for (const c of EXPR_CASES) {
      for (const r of c.rules) if (r.type === "rule") expect(ruleShape(r), `${c.name} ${r.id}`).not.toBeNull();
    }
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

describe("migrateV5", () => {
  const today = "2026-10-28";
  const v5 = () => migrateV4(FIXTURE.state, today)!;
  const forbid2 = {
    id: "f2",
    type: "sequence",
    scope: "ward",
    hardness: "hard",
    source_text: "이브닝 다음 데이, 나이트 다음 데이 금지",
    params: { forbid: [[{ in: ["E"] }, { in: ["D"] }], [{ in: ["N"] }, { in: ["D"] }]] },
  } as BlockSpec;

  it("e2e 픽스처(v4 → v5)를 식으로: 규칙 id·원문 유지, 기본 규칙 default, 요청 수 그대로", () => {
    const before = v5();
    const after = migrateV5(before, today)!;
    const w = after.ward!;
    expect(w.rules.map((r) => r.id)).toEqual(before.ward!.rules.map((r) => r.id));
    expect(w.rules.every((r) => r.type === "rule")).toBe(true);
    expect(w.rules.filter((r) => r.type === "rule" && r.default).map((r) => r.id)).toEqual(
      before.ward!.rules.filter((r) => r.id.startsWith("cov-") || r.id === NIGHT_ONLY_RULE_ID).map((r) => r.id),
    );
    expect(w.rules.map((r) => r.source_text)).toEqual(before.ward!.rules.map((r) => r.source_text));
    expect(w.unconverted).toEqual([]);
    expect(w.introSeen).toBe(true);
    const [oct, nov] = after.periods;
    expect(nov.requests.map((r) => [r.id, r.type, r.hardness])).toEqual([
      ["req-leave-n01", "rule", "hard"],
      ["req-avoid-n02", "rule", "soft"],
      ["req-prefer-n04", "rule", "soft"],
    ]);
    expect(oct.snapshot!.rules.every((r) => r.type === "rule")).toBe(true);
    // 옛 결과는 그대로, 운영 중인 10월은 stale
    expect(oct.result).toEqual(before.periods[0].result);
    expect(oct.resultVersion).toBe(-1);
    expect(after.view).toEqual(before.view);
    expect(after.inputVersion).toBe(before.inputVersion);
  });

  it("금지 패턴이 나뉘면 꺼진 id·덮어쓴 규칙·카드 순서·딸린 카드 id도 나뉜 id로 늘린다", () => {
    const d = v5();
    d.ward!.rules.push(forbid2);
    d.ward!.pendingRules.push({ ...forbid2, id: "f3" });
    d.ward!.cardOrder = ["f3", "f2"];
    d.ward!.pendingConfig = [{ id: "cfg-M", source_text: "", change: { action: "add", shift: { code: "M", name: "미드", hours: 8 } }, ruleIds: ["f3"] }];
    d.periods[1].disabledIds = ["f2", "rule-max-work"];
    d.periods[1].ruleOverrides = { f2: { ...forbid2, hardness: "soft" } };
    const after = migrateV5(d, today)!;
    const w = after.ward!;
    expect(w.rules.filter((r) => r.id.startsWith("f2")).map((r) => r.id)).toEqual(["f2", "f2-2"]);
    expect(w.pendingRules.map((r) => r.id)).toEqual(["f3", "f3-2"]);
    expect(w.cardOrder).toEqual(["f3", "f3-2", "f2", "f2-2"]);
    expect(w.pendingConfig[0].ruleIds).toEqual(["f3", "f3-2"]);
    const nov = after.periods[1];
    expect(nov.disabledIds).toEqual(["f2", "f2-2", "rule-max-work"]);
    expect(Object.keys(nov.ruleOverrides)).toEqual(["f2", "f2-2"]);
    expect(Object.values(nov.ruleOverrides).every((r) => r.hardness === "soft" && r.type === "rule")).toBe(true);
  });

  it("확정본 버전의 요청과 대기 요청도 바꾸고, 바꾸지 못한 제약은 원문을 unconverted에 더한다", () => {
    const d = v5();
    const leave = d.periods[1].requests[0];
    d.periods[1].versions = [{ confirmed_at: "x", assignments: {}, changed: [], requests: [leave] }];
    d.periods[1].pendingRequests = [leave];
    d.ward!.unconverted = [{ source_text: "옛 실패" }];
    d.ward!.rules.push({ id: "bad", type: "sequence", scope: "ward", hardness: "hard", source_text: "이상한 규칙", params: { run: { in: ["N"] }, min_len: 1 } } as BlockSpec);
    const after = migrateV5(d, today)!;
    const nov = after.periods[1];
    expect(nov.versions[0].requests![0]).toEqual(nov.requests[0]);
    expect(nov.pendingRequests[0].type).toBe("rule");
    expect(after.ward!.unconverted).toEqual([{ source_text: "옛 실패" }, { source_text: "이상한 규칙" }]);
    expect(after.ward!.rules.some((r) => r.id === "bad")).toBe(false);
  });

  it("칸 고정은 그대로, 근무표가 없고 필요 인원도 없는 병동은 병동 소개 단계를 아직 안 봤다", () => {
    const d = v5();
    const fixed = { id: "fix-n01-3", type: "fixed_assignment", scope: "period", hardness: "hard", weight: 1, source_text: "", enabled: true, params: { nurse_id: "n01", day: 3, shift: "D" } } as BlockSpec;
    d.periods[1].requests.push(fixed);
    expect(migrateV5(d, today)!.periods[1].requests.at(-1)).toEqual(fixed);
    const bare = { ...d, ward: { ...d.ward!, rules: d.ward!.rules.filter((r) => !r.id.startsWith("cov-")) }, periods: [] };
    expect(migrateV5(bare, today)!.ward!.introSeen).toBe(false);
  });

  it("모양이 v5가 아니면 null, 병동이 없어도 바꾼다", () => {
    expect(migrateV5(FIXTURE.state, today)).toBeNull(); // v4 모양(근무 형태 없음)
    expect(migrateV5(null, today)).toBeNull();
    expect(migrateV5({ ward: null, periods: [], view: { screen: "home" }, inputVersion: 2 }, today)).toEqual({
      ward: null,
      periods: [],
      view: { screen: "home" },
      inputVersion: 2,
    });
  });
});

describe("upgradeDoc", () => {
  const today = "2026-10-28";
  it("v4는 v4 → v5 → v6, v5는 v5 → v6, v6은 그대로, 그 밖은 null", () => {
    const v5 = migrateV4(FIXTURE.state, today)!;
    const v6 = migrateV5(v5, today)!;
    expect(STORAGE_VERSION).toBe(6);
    expect(upgradeDoc(FIXTURE.state, 4, today)).toEqual(v6);
    expect(upgradeDoc(v5, 5, today)).toEqual(v6);
    expect(upgradeDoc(v6, 6, today)).toBe(v6);
    expect(upgradeDoc(v6, 3, today)).toBeNull();
    expect(upgradeDoc({ junk: 1 }, 5, today)).toBeNull();
  });
});
