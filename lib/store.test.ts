import { describe, expect, it } from "vitest";

import sample from "./samples/ward-15.json";
import {
  createAppStore,
  currentPeriod,
  findReplaced,
  isNurseUsed,
  orphanConstraintIds,
  STORAGE_KEY,
  toScheduleRequest,
} from "./store";
import type { ConstraintSpec, ScheduleResult } from "./types.gen";

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const TODAY = "2026-10-28"; // 수요일
const CONFIRMED_AT = new Date("2026-10-28T05:00:00.000Z");
const rows = [
  { name: "이영희", years: 12, night_only: false },
  { name: "박민수", years: 9, night_only: false },
];

function card(over: Partial<ConstraintSpec> & Pick<ConstraintSpec, "id" | "type" | "params">) {
  return { scope: "ward", hardness: "hard", weight: 1, source_text: "원문", enabled: true, ...over } as ConstraintSpec;
}

const result = (assignments: Record<string, string[]>) =>
  ({
    assignments,
    summary: { preferences_total: 0, preferences_met: 0, soft_violation_count: 0 },
    stats: {},
    soft_violations: [],
    diff: null,
    optimal: true,
  }) as unknown as ScheduleResult;

function fresh(storage: Storage = new MemoryStorage()) {
  return createAppStore(() => storage, () => CONFIRMED_AT);
}

/** 병동(이영희 n01, 박민수 n02, 월 단위) + 첫 기간. */
function withPeriod() {
  const store = fresh();
  store.getState().startWard();
  store.getState().addNurses(rows);
  const id = store.getState().createPeriod(TODAY)!;
  const period = () => store.getState().periods.find((p) => p.id === id)!;
  return { store, id, period };
}

describe("초기 상태", () => {
  it("병동과 기간이 없고 홈에서 시작한다", () => {
    const s = fresh().getState();
    expect(s.ward).toBeNull();
    expect(s.periods).toEqual([]);
    expect(s.view).toEqual({ screen: "home" });
    expect(s.inputVersion).toBe(0);
    expect(s.storageAvailable).toBe(true);
    expect(s.resetNotice).toBe(false);
    expect(s.hasInput()).toBe(false);
  });
});

describe("병동", () => {
  it("startWard는 빈 병동을 만들고 병동 설정으로 간다", () => {
    const store = fresh();
    store.getState().startWard();
    const s = store.getState();
    expect(s.ward).toMatchObject({ name: "", unit: "month", nurses: [], nextNurseNo: 1, rules: [], isSample: false });
    expect(s.view).toEqual({ screen: "settings", tab: "roster" });
    expect(s.hasInput()).toBe(true);
    expect(s.inputVersion).toBe(1);
  });

  it("loadSample은 샘플 병동과 첫 기간을 만들고 그 기간을 연다", () => {
    const store = fresh();
    store.getState().loadSample(TODAY);
    const s = store.getState();
    expect(s.ward!.isSample).toBe(true);
    expect(s.ward!.nurses).toEqual(sample.nurses.map((n) => ({ ...n, active: true })));
    expect(s.ward!.nextNurseNo).toBe(sample.nurses.length + 1);
    expect(s.ward!.rules).toHaveLength(sample.constraints.length);
    expect(s.periods).toHaveLength(1);
    expect(s.periods[0]).toMatchObject({ start_date: "2026-11-01", length: 30, status: "draft", result: null });
    expect(s.view).toEqual({ screen: "period", periodId: s.periods[0].id, step: 1 });
  });

  it("setWardName·setUnit·setCoverage는 inputVersion을 올리고 필요 인원은 ward.rules의 daily_coverage다", () => {
    const store = fresh();
    store.getState().startWard();
    store.getState().setWardName("내과 5병동");
    store.getState().setUnit("2w");
    store.getState().setCoverage("D", "weekday", 3, 4);
    store.getState().setCoverage("D", "weekend", 2, 2);
    store.getState().setCoverage("D", "weekday", 4, 5);
    const w = store.getState().ward!;
    expect(w.name).toBe("내과 5병동");
    expect(w.unit).toBe("2w");
    expect(w.rules).toHaveLength(2);
    expect(w.rules.find((c) => c.type === "daily_coverage" && c.params.day_kind === "weekday")).toMatchObject({
      scope: "ward",
      hardness: "hard",
      source_text: "필요 인원 설정",
      params: { shift: "D", day_kind: "weekday", min: 4, max: 5 },
    });
    expect(store.getState().inputVersion).toBe(6);
  });
});

describe("병동 규칙 카드", () => {
  it("대기 카드는 inputVersion 없이 쌓이고, 적용하면 rules로 옮긴다", () => {
    const store = fresh();
    store.getState().startWard();
    const v = store.getState().inputVersion;
    store.getState().addPendingRules([card({ id: "c1", type: "max_consecutive_work", params: { days: 5 } })]);
    expect(store.getState().inputVersion).toBe(v);
    store.getState().applyRule("c1");
    expect(store.getState().ward!.pendingRules).toEqual([]);
    expect(store.getState().ward!.rules.map((c) => c.id)).toEqual(["c1"]);
    expect(store.getState().inputVersion).toBe(v + 1);
  });

  it("같은 type·scope·대상이면 교체하고, 대상이 다르면 추가한다", () => {
    const store = fresh();
    store.getState().startWard();
    store.getState().addPendingRules([
      card({ id: "d", type: "max_consecutive_work", params: { days: 5 } }),
      card({ id: "e", type: "max_consecutive_work", params: { days: 6 } }),
      card({ id: "f", type: "skill_mix", params: { shift: "N", min_years: 3, min_count: 1 } }),
      card({ id: "g", type: "skill_mix", params: { shift: "D", min_years: 3, min_count: 1 } }),
      card({ id: "h", type: "forbidden_sequence", params: { first: "N", second: "D" } }),
      card({ id: "i", type: "forbidden_sequence", params: { first: "E", second: "D" } }),
    ]);
    for (const id of ["d", "e", "f", "g", "h", "i"]) store.getState().applyRule(id);
    expect(store.getState().ward!.rules.map((c) => c.id).sort()).toEqual(["e", "f", "g", "h", "i"]);
  });

  it("updateRule: 대기 카드는 inputVersion 없이, 적용된 규칙은 올리며 바꾸고 hardness에 맞춰 weight를 맞춘다", () => {
    const store = fresh();
    store.getState().startWard();
    store.getState().addPendingRules([
      card({ id: "p", type: "max_consecutive_work", params: { days: 5 } }),
      card({ id: "q", type: "night_fairness", hardness: "soft", weight: 5, params: {} }),
    ]);
    store.getState().applyRule("q");
    const v = store.getState().inputVersion;
    store.getState().updateRule("p", { params: { days: 4 }, hardness: "soft" });
    expect(store.getState().ward!.pendingRules[0]).toMatchObject({ params: { days: 4 }, hardness: "soft", weight: 10 });
    expect(store.getState().inputVersion).toBe(v);
    store.getState().updateRule("q", { hardness: "hard" });
    expect(store.getState().ward!.rules[0]).toMatchObject({ hardness: "hard", weight: 1 });
    expect(store.getState().inputVersion).toBe(v + 1);
  });

  it("removeRule: 대기 카드는 inputVersion 없이, 적용된 규칙은 올리며 지운다", () => {
    const store = fresh();
    store.getState().startWard();
    store.getState().addPendingRules([
      card({ id: "p", type: "max_consecutive_work", params: { days: 5 } }),
      card({ id: "q", type: "min_days_off", params: { days: 8 } }),
    ]);
    store.getState().applyRule("q");
    const v = store.getState().inputVersion;
    store.getState().removeRule("p");
    expect(store.getState().inputVersion).toBe(v);
    store.getState().removeRule("q");
    expect(store.getState().ward!.rules).toEqual([]);
    expect(store.getState().inputVersion).toBe(v + 1);
  });
});

describe("findReplaced", () => {
  it("같은 type·scope·대상의 다른 제약을 찾고, 휴가는 대체하지 않는다", () => {
    const existing = [
      card({ id: "a", type: "leave", scope: "period", params: { nurse_id: "n01", days: [3] } }),
      card({ id: "b", type: "max_consecutive_work", params: { days: 5 } }),
    ];
    expect(findReplaced(existing, card({ id: "c", type: "max_consecutive_work", params: { days: 4 } }))?.id).toBe("b");
    expect(findReplaced(existing, card({ id: "e", type: "max_consecutive_work", scope: "period", params: { days: 4 } }))).toBeUndefined();
    expect(findReplaced(existing, existing[1])).toBeUndefined();
    expect(findReplaced(existing, card({ id: "l", type: "leave", scope: "period", params: { nurse_id: "n01", days: [9] } }))).toBeUndefined();
  });
});

describe("간호사 id", () => {
  it("addNurses는 n{번호}를 부여하고 nextNurseNo를 올린다", () => {
    const store = fresh();
    store.getState().startWard();
    store.getState().addNurses(rows);
    const w = store.getState().ward!;
    expect(w.nurses).toEqual([
      { id: "n01", name: "이영희", years: 12, night_only: false, active: true },
      { id: "n02", name: "박민수", years: 9, night_only: false, active: true },
    ]);
    expect(w.nextNurseNo).toBe(3);
  });

  it("replaceRoster는 같은 이름의 id를 유지하고(순서가 바뀌어도), 새 이름에만 새 id, 빠진 사람은 비활성", () => {
    const store = fresh();
    store.getState().startWard();
    store.getState().addNurses(rows);
    store.getState().replaceRoster([
      { name: "김철수", years: 7, night_only: false },
      { name: "이영희", years: 13, night_only: false },
    ]);
    const w = store.getState().ward!;
    expect(w.nurses).toEqual([
      { id: "n03", name: "김철수", years: 7, night_only: false, active: true },
      { id: "n01", name: "이영희", years: 13, night_only: false, active: true },
      { id: "n02", name: "박민수", years: 9, night_only: false, active: false },
    ]);
    expect(w.nextNurseNo).toBe(4);
  });

  it("replaceRoster에 다시 들어온 비활성 간호사는 원래 id로 다시 활성이 된다", () => {
    const store = fresh();
    store.getState().startWard();
    store.getState().addNurses(rows);
    store.getState().replaceRoster([rows[0]]);
    store.getState().replaceRoster(rows);
    const w = store.getState().ward!;
    expect(w.nurses.map((n) => [n.id, n.active])).toEqual([
      ["n01", true],
      ["n02", true],
    ]);
    expect(w.nextNurseNo).toBe(3);
  });

  it("nextNurseNo는 삭제 후에도 줄어들지 않고 지운 번호를 다시 쓰지 않는다", () => {
    const store = fresh();
    store.getState().startWard();
    store.getState().addNurses(rows);
    store.getState().removeNurse("n02");
    store.getState().addNurses([{ name: "김철수", years: 7, night_only: false }]);
    expect(store.getState().ward!.nurses.map((n) => n.id)).toEqual(["n01", "n03"]);
    expect(store.getState().ward!.nextNurseNo).toBe(4);
  });

  it("updateNurse·setNurseActive는 id를 바꾸지 않는다", () => {
    const store = fresh();
    store.getState().startWard();
    store.getState().addNurses(rows);
    store.getState().updateNurse("n01", { name: "이영희A", years: 13 });
    store.getState().setNurseActive("n02", false);
    expect(store.getState().ward!.nurses).toEqual([
      { id: "n01", name: "이영희A", years: 13, night_only: false, active: true },
      { id: "n02", name: "박민수", years: 9, night_only: false, active: false },
    ]);
  });

  it("removeNurse는 어떤 기간에서도 쓰이지 않은 간호사만 지우고, 아니면 비활성으로 바꾼다", () => {
    const { store, id } = withPeriod();
    store.getState().addPendingRequests(id, [
      card({ id: "l", type: "leave", scope: "period", params: { nurse_id: "n01", days: [3] } }),
    ]);
    store.getState().removeNurse("n01"); // 초안 기간의 대기 요청이 참조
    store.getState().removeNurse("n02");
    expect(store.getState().ward!.nurses.map((n) => [n.id, n.active])).toEqual([["n01", false]]);
  });

  it("isNurseUsed는 기간 요청·결과에서 쓰인 간호사만 true다([삭제] 표시 기준)", () => {
    const { store, id } = withPeriod();
    store.getState().setResult(id, result({ n02: ["D"] }));
    const { ward, periods } = store.getState();
    expect(isNurseUsed("n01", ward!, periods)).toBe(false);
    expect(isNurseUsed("n02", ward!, periods)).toBe(true);
  });

  it("결과나 확정본에 있는 간호사도 지우지 않는다", () => {
    const { store, id } = withPeriod();
    store.getState().setResult(id, result({ n02: ["D"] }));
    store.getState().removeNurse("n02");
    expect(store.getState().ward!.nurses.find((n) => n.id === "n02")?.active).toBe(false);
  });
});

describe("createPeriod", () => {
  it("첫 기간은 단위별 오늘 이후 첫 시작일이고, 그 기간 ①로 간다", () => {
    const cases: [string, { start_date: string; length: number }][] = [
      ["month", { start_date: "2026-11-01", length: 30 }],
      ["1w", { start_date: "2026-11-02", length: 7 }],
      ["2w", { start_date: "2026-11-02", length: 14 }],
      ["4w", { start_date: "2026-11-02", length: 28 }],
    ];
    for (const [unit, range] of cases) {
      const store = fresh();
      store.getState().startWard();
      store.getState().setUnit(unit as "month");
      const id = store.getState().createPeriod(TODAY);
      const p = store.getState().periods[0];
      expect(p).toMatchObject({ ...range, id, status: "draft", holidays: [], requests: [], versions: [], snapshot: null });
      expect(store.getState().view).toEqual({ screen: "period", periodId: id, step: 1 });
    }
  });

  it("초안이 있으면 새로 만들지 않고 그 기간을 연다", () => {
    const { store, id } = withPeriod();
    store.getState().go({ screen: "home" });
    expect(store.getState().createPeriod(TODAY)).toBe(id);
    expect(store.getState().periods).toHaveLength(1);
    expect(store.getState().view).toEqual({ screen: "period", periodId: id, step: 1 });
  });

  it("마지막 기간이 확정되면 그 다음 연속 기간을 만든다", () => {
    const { store, id } = withPeriod();
    store.getState().setResult(id, result({ n01: ["D"], n02: ["O"] }));
    store.getState().confirm(id);
    const next = store.getState().createPeriod(TODAY);
    expect(next).not.toBe(id);
    expect(store.getState().periods.map((p) => [p.start_date, p.length])).toEqual([
      ["2026-11-01", 30],
      ["2026-12-01", 31],
    ]);
  });

  it("병동이 없으면 아무것도 하지 않는다", () => {
    const store = fresh();
    expect(store.getState().createPeriod(TODAY)).toBeNull();
    expect(store.getState().periods).toEqual([]);
  });
});

describe("기간 입력", () => {
  it("공휴일·이월·요청 적용은 그 기간만 바꾸고 inputVersion을 올린다", () => {
    const { store, id, period } = withPeriod();
    const v = store.getState().inputVersion;
    store.getState().toggleHoliday(id, 18);
    store.getState().toggleHoliday(id, 3);
    store.getState().toggleHoliday(id, 18);
    expect(period().holidays).toEqual([3]);
    store.getState().setCarryOver(id, [{ nurse_id: "n01", shifts: ["N"] }]);
    expect(period().carryOver).toEqual([{ nurse_id: "n01", shifts: ["N"] }]);
    store.getState().addPendingRequests(id, [
      card({ id: "l1", type: "leave", scope: "period", params: { nurse_id: "n01", days: [15] } }),
      card({ id: "l2", type: "leave", scope: "period", params: { nurse_id: "n01", days: [20] } }),
    ]);
    expect(store.getState().inputVersion).toBe(v + 4);
    store.getState().applyRequest(id, "l1");
    store.getState().applyRequest(id, "l2");
    expect(period().requests.map((c) => c.id)).toEqual(["l1", "l2"]);
    expect(period().pendingRequests).toEqual([]);
    store.getState().updateRequest(id, "l2", { params: { nurse_id: "n01", days: [20, 21] } });
    expect(period().requests[1].params).toEqual({ nurse_id: "n01", days: [20, 21] });
    store.getState().removeRequest(id, "l1");
    expect(period().requests.map((c) => c.id)).toEqual(["l2"]);
    expect(store.getState().inputVersion).toBe(v + 8);
  });

  it("setFixed는 같은 칸의 고정을 교체하고 원문의 M/D는 실제 날짜, clearFixed는 그 칸만 지운다", () => {
    const { store, id, period } = withPeriod();
    store.getState().setFixed(id, "n01", 5, "D");
    store.getState().setFixed(id, "n01", 6, "E");
    store.getState().setFixed(id, "n01", 5, "N");
    expect(period().requests.map((c) => c.params)).toEqual([
      { nurse_id: "n01", day: 6, shift: "E" },
      { nurse_id: "n01", day: 5, shift: "N" },
    ]);
    expect(period().requests[1]).toMatchObject({
      type: "fixed_assignment",
      scope: "period",
      hardness: "hard",
      source_text: "수동 고정: 이영희 11/5 N",
    });
    store.getState().clearFixed(id, "n01", 6);
    expect(period().requests.map((c) => c.params)).toEqual([{ nurse_id: "n01", day: 5, shift: "N" }]);
  });

  it("setResult는 inputVersion을 바꾸지 않고 그때의 버전을 resultVersion으로 남긴다", () => {
    const { store, id, period } = withPeriod();
    const v = store.getState().inputVersion;
    store.getState().setResult(id, result({ n01: ["D"] }));
    expect(period().resultVersion).toBe(v);
    expect(store.getState().inputVersion).toBe(v);
  });

  it("go는 inputVersion을 올리지 않는다", () => {
    const { store, id } = withPeriod();
    const v = store.getState().inputVersion;
    store.getState().go({ screen: "settings", tab: "rules" });
    store.getState().go({ screen: "period", periodId: id, step: 3 });
    expect(store.getState().inputVersion).toBe(v);
    expect(store.getState().view).toEqual({ screen: "period", periodId: id, step: 3 });
  });
});

describe("이번 기간만 끄기와 제안 수락", () => {
  function setup() {
    const ctx = withPeriod();
    const { store, id } = ctx;
    store.getState().addPendingRules([card({ id: "r", type: "max_consecutive_nights", params: { days: 3 } })]);
    store.getState().applyRule("r");
    store.getState().addPendingRequests(id, [
      card({ id: "l", type: "leave", scope: "period", params: { nurse_id: "n01", days: [3, 4] } }),
      card({ id: "p", type: "shift_preference", scope: "period", hardness: "soft", weight: 10, params: { nurse_id: "n02", shift: "N", prefer: false } }),
    ]);
    store.getState().applyRequest(id, "l");
    store.getState().applyRequest(id, "p");
    return ctx;
  }

  it("setDisabled는 그 기간의 disabledIds만 바꾸고 원본은 그대로 둔다", () => {
    const { store, id, period } = setup();
    const v = store.getState().inputVersion;
    store.getState().setDisabled(id, "r", true);
    store.getState().setDisabled(id, "l", true);
    expect(period().disabledIds).toEqual(["r", "l"]);
    expect(store.getState().ward!.rules[0].enabled).toBe(true);
    expect(period().requests[0].enabled).toBe(true);
    store.getState().setDisabled(id, "r", false);
    expect(period().disabledIds).toEqual(["l"]);
    expect(store.getState().inputVersion).toBe(v + 3);
  });

  it("applyChanges: disable은 disabledIds, 요청 update는 요청을, 병동 규칙 update는 ruleOverrides를 바꾼다", () => {
    const { store, id, period } = setup();
    store.getState().applyChanges(id, [
      { action: "update", constraint_id: "r", params: { days: 4 }, hardness: "soft" },
      { action: "disable", constraint_id: "l" },
      { action: "update", constraint_id: "p", hardness: "hard" },
      { action: "update", constraint_id: "없음", params: { days: 1 } },
    ]);
    const p = period();
    expect(store.getState().ward!.rules[0]).toMatchObject({ params: { days: 3 }, hardness: "hard" });
    expect(p.ruleOverrides.r).toMatchObject({ id: "r", params: { days: 4 }, hardness: "soft", weight: 10 });
    expect(p.disabledIds).toEqual(["l"]);
    expect(p.requests[1]).toMatchObject({ hardness: "hard", weight: 1 });
    expect(Object.keys(p.ruleOverrides)).toEqual(["r"]);
  });
});

describe("toScheduleRequest", () => {
  it("현재 병동과 기간으로 요청 본문을 만든다(override 적용, 꺼진 제약 enabled=false)", () => {
    const { store, id, period } = withPeriod();
    store.getState().setCoverage("D", "weekday", 1, 1);
    store.getState().addPendingRules([card({ id: "r", type: "max_consecutive_nights", params: { days: 3 } })]);
    store.getState().applyRule("r");
    store.getState().addPendingRequests(id, [
      card({ id: "l", type: "leave", scope: "period", params: { nurse_id: "n01", days: [3] } }),
    ]);
    store.getState().applyRequest(id, "l");
    store.getState().toggleHoliday(id, 18);
    store.getState().setDisabled(id, "l", true);
    store.getState().applyChanges(id, [{ action: "update", constraint_id: "r", params: { days: 4 } }]);

    const req = toScheduleRequest(store.getState().ward!, period());
    expect(req.nurses).toEqual([
      { id: "n01", name: "이영희", years: 12, night_only: false },
      { id: "n02", name: "박민수", years: 9, night_only: false },
    ]);
    expect(req.period).toEqual({ start_date: "2026-11-01", length: 30 });
    expect(req.holidays).toEqual([18]);
    expect(req.constraints!.map((c) => [c.id, c.enabled])).toEqual([
      ["cov-weekday-D", true],
      ["r", true],
      ["l", false],
    ]);
    expect(req.constraints![1].params).toEqual({ days: 4 });
    expect(req.carry_over).toEqual([]);
    expect(req.previous ?? null).toBeNull();
    expect(req).not.toHaveProperty("input_version");
  });

  it("비활성 간호사와 그를 참조하는 제약·이월·이전 배정을 뺀다", () => {
    const { store, id, period } = withPeriod();
    store.getState().addPendingRequests(id, [
      card({ id: "l1", type: "leave", scope: "period", params: { nurse_id: "n01", days: [3] } }),
      card({ id: "l2", type: "leave", scope: "period", params: { nurse_id: "n02", days: [3] } }),
      card({ id: "x", type: "leave", scope: "period", params: { nurse_id: "n99", days: [3] } }),
    ]);
    for (const c of ["l1", "l2", "x"]) store.getState().applyRequest(id, c);
    store.getState().setCarryOver(id, [
      { nurse_id: "n01", shifts: ["N"] },
      { nurse_id: "n02", shifts: ["D"] },
    ]);
    store.getState().setResult(id, result({ n01: ["D", "E"], n02: ["N", "O"] }));
    store.getState().setNurseActive("n02", false);

    const req = toScheduleRequest(store.getState().ward!, period());
    expect(req.nurses.map((n) => n.id)).toEqual(["n01"]);
    expect(req.constraints!.map((c) => c.id)).toEqual(["l1"]);
    expect(req.carry_over).toEqual([{ nurse_id: "n01", shifts: ["N"] }]);
    expect(req.previous).toEqual({ n01: ["D", "E"] });
  });

  it("확정된 기간은 병동이 바뀌어도 확정 시점의 명단과 병동 규칙을 쓴다", () => {
    const { store, id, period } = withPeriod();
    store.getState().setCoverage("D", "weekday", 1, 1);
    store.getState().setResult(id, result({ n01: ["D"], n02: ["O"] }));
    store.getState().confirm(id);

    store.getState().setCoverage("D", "weekday", 2, 2);
    store.getState().addNurses([{ name: "김철수", years: 7, night_only: false }]);
    store.getState().setNurseActive("n02", false);

    const confirmedReq = toScheduleRequest(store.getState().ward!, period());
    expect(confirmedReq.nurses.map((n) => n.id)).toEqual(["n01", "n02"]);
    expect(confirmedReq.constraints![0].params).toMatchObject({ min: 1, max: 1 });
  });
});

describe("confirm", () => {
  it("status를 확정으로, versions에 1개, snapshot에 활성 명단과 원본 병동 규칙을 남긴다", () => {
    const { store, id, period } = withPeriod();
    store.getState().addPendingRules([card({ id: "r", type: "max_consecutive_nights", params: { days: 3 } })]);
    store.getState().applyRule("r");
    store.getState().applyChanges(id, [{ action: "update", constraint_id: "r", params: { days: 4 } }]);
    store.getState().addNurses([{ name: "김철수", years: 7, night_only: false }]);
    store.getState().setNurseActive("n03", false);

    store.getState().confirm(id);
    expect(period().status).toBe("draft"); // 결과가 없으면 확정하지 않는다

    store.getState().setResult(id, result({ n01: ["D"], n02: ["O"] }));
    store.getState().confirm(id);
    const p = period();
    expect(p.status).toBe("confirmed");
    expect(p.versions).toEqual([{ confirmed_at: CONFIRMED_AT.toISOString(), assignments: { n01: ["D"], n02: ["O"] }, changed: [] }]);
    expect(p.snapshot!.nurses.map((n) => n.id)).toEqual(["n01", "n02"]);
    expect(p.snapshot!.rules.map((c) => c.params)).toEqual([{ days: 3 }]);
  });
});

describe("currentPeriod·orphanConstraintIds", () => {
  it("현재 기간은 view의 기간, 없으면 첫 초안이다", () => {
    const { store, id } = withPeriod();
    store.getState().go({ screen: "settings", tab: "roster" });
    expect(currentPeriod(store.getState())?.id).toBe(id);
    store.getState().go({ screen: "period", periodId: id, step: 2 });
    expect(currentPeriod(store.getState())?.id).toBe(id);
    expect(currentPeriod(fresh().getState())).toBeNull();
  });

  it("활성 명단에 없는 간호사를 가리키는 병동 규칙·요청 id", () => {
    const { store, id, period } = withPeriod();
    store.getState().addPendingRequests(id, [
      card({ id: "ok", type: "leave", scope: "period", params: { nurse_id: "n01", days: [3] } }),
      card({ id: "gone", type: "fixed_assignment", scope: "period", params: { nurse_id: "n09", day: 2, shift: "D" } }),
    ]);
    store.getState().applyRequest(id, "ok");
    store.getState().applyRequest(id, "gone");
    expect(orphanConstraintIds(store.getState().ward!, period())).toEqual(["gone"]);
    store.getState().setNurseActive("n01", false);
    expect(orphanConstraintIds(store.getState().ward!, period())).toEqual(["ok", "gone"]);
  });
});

describe("reset", () => {
  it("병동과 기간을 모두 지우고 홈으로, inputVersion은 올린다", () => {
    const store = fresh();
    store.getState().loadSample(TODAY);
    const before = store.getState().inputVersion;
    store.getState().reset();
    const s = store.getState();
    expect(s.hasInput()).toBe(false);
    expect(s.ward).toBeNull();
    expect(s.periods).toEqual([]);
    expect(s.view).toEqual({ screen: "home" });
    expect(s.inputVersion).toBe(before + 1);
  });
});

describe("persist", () => {
  it("localStorage에 저장하고 다시 만들면 복원한다", () => {
    const storage = new MemoryStorage();
    const a = fresh(storage);
    a.getState().loadSample(TODAY);
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(saved.version).toBe(3);
    expect(saved.state).not.toHaveProperty("storageAvailable");

    const b = fresh(storage).getState();
    expect(b.ward).toEqual(a.getState().ward);
    expect(b.periods).toEqual(a.getState().periods);
    expect(b.view).toEqual(a.getState().view);
    expect(b.inputVersion).toBe(a.getState().inputVersion);
    expect(b.resetNotice).toBe(false);
  });

  it("버전이 다르면 초기 상태로 되돌리고 resetNotice를 켠다", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, state: { step: 3, period: { start_date: "2026-11-01", length: 30 }, nurses: [], inputVersion: 9 } }),
    );
    const s = fresh(storage).getState();
    expect(s.ward).toBeNull();
    expect(s.resetNotice).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).state.ward).toBeNull();
  });

  it("JSON 파싱에 실패하면 초기화한다", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    const s = fresh(storage).getState();
    expect(s.ward).toBeNull();
    expect(s.resetNotice).toBe(true);
  });

  it("모양이 손상되면 초기화한다", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, state: { ward: { nurses: "x" }, periods: [], inputVersion: 1 } }));
    const s = fresh(storage).getState();
    expect(s.ward).toBeNull();
    expect(s.resetNotice).toBe(true);
  });

  it("dismissResetNotice로 안내를 끈다", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    const store = fresh(storage);
    store.getState().dismissResetNotice();
    expect(store.getState().resetNotice).toBe(false);
  });
});

describe("localStorage 예외", () => {
  it("접근이 예외를 던지면 메모리로 동작한다", () => {
    const store = createAppStore(() => {
      throw new Error("SecurityError");
    });
    expect(store.getState().storageAvailable).toBe(false);
    store.getState().startWard();
    store.getState().addNurses(rows);
    expect(store.getState().ward!.nurses).toHaveLength(2);
  });

  it("쓰기가 예외를 던지면 메모리로 동작한다", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = fresh(storage);
    expect(store.getState().storageAvailable).toBe(false);
    store.getState().startWard();
    expect(store.getState().ward).not.toBeNull();
  });
});
