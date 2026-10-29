import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  legacyToBlock,
  migrateV4,
  NIGHT_ONLY_RULE_ID,
  NIGHT_ONLY_TAG,
  nightOnlyRule,
  normalizeBlock,
  type LegacySpec,
} from "./migrate";
import type { ConstraintSpec } from "./types.gen";

interface ConvertCase {
  name: string;
  period: { start_date: string; length: number };
  holidays: number[];
  template: LegacySpec | null;
  block: ConstraintSpec;
}

const ROOT = join(__dirname, "..");
const CASES: ConvertCase[] = JSON.parse(readFileSync(join(ROOT, "backend/tests/golden/convert-cases.json"), "utf-8"));
const FIXTURE = JSON.parse(readFileSync(join(ROOT, "e2e/fixtures/ward-oct.json"), "utf-8"));

describe("legacyToBlock: Python 변환(convert-cases.json)과 같다", () => {
  for (const c of CASES.filter((c) => c.template)) {
    it(c.name, () => {
      expect(legacyToBlock(c.template!, c.period, c.holidays)).toEqual(c.block);
    });
  }

  it("나이트 전담 기본 규칙", () => {
    const c = CASES.find((c) => c.template === null)!;
    expect(nightOnlyRule()).toEqual(c.block);
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
    } as unknown as ConstraintSpec;
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
    const raw = { id: "b", type: "balance", scope: "ward", source_text: "", params: { shifts: { in: ["N"] } } } as unknown as ConstraintSpec;
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
    expect(w.rules.at(-1)).toEqual(nightOnlyRule());
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
    v4.ward.rules.push(nightOnlyRule());
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
