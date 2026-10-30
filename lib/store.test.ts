import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canRevertToConfirmed,
  carryOverChanged,
  cardsInOrder,
  coverageRange,
  coverageRule,
  createAppStore,
  currentPeriod,
  findReplaced,
  hasCoverage,
  hasUnconfirmedChanges,
  homeSummary,
  isEmployeeUsed,
  isShiftUsed,
  isShopReady,
  orphanConstraintIds,
  prepareNeedsReview,
  rosterChangesFor,
  SAVE_DEBOUNCE_MS,
  STORAGE_KEY,
  setupStep,
  toScheduleRequest,
  viewForPeriod,
  type ShopRemote,
} from "./store";
import { DEFAULT_CONFIG, STORAGE_VERSION } from "./rules";
import { balance, count, DEN_CONFIG, fixedCell, forbid as forbidRule, maxRun, OFF, WORK } from "./test-rules";
import type { ConstraintSpec, Rule, RuleExample, ScheduleResult } from "./types.gen";

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
  { name: "이영희" },
  { name: "박민수" },
];

const CARD = { scope: "shop", hardness: "hard", source_text: "원문" } as const;
/** 세는 규칙 카드. */
const countCard = (id: string, params: Parameters<typeof count>[0], over: Parameters<typeof count>[1] = {}) =>
  count(params, { ...CARD, id, ...over });
/** 규칙의 조정 가능한 값. */
const val = (c: ConstraintSpec, name: string) => (c as Rule).values![name].value;

// 프리셋 이름의 카드
const maxWork = (id: string, days: number) => maxRun(WORK, days, undefined, { ...CARD, id });
const maxNights = (id: string, days: number) => maxRun({ in: ["N"] }, days, undefined, { ...CARD, id });
const minOff = (id: string, days: number) => countCard(id, { shifts: OFF, per: "person", min: days });
const skillMix = (id: string, shift: string) => countCard(id, { people: { tags: ["책임"] }, shifts: { in: [shift] }, per: "day", min: 1 });
const forbid = (id: string, first: string, second: string) => forbidRule([{ in: [first] }, { in: [second] }], undefined, { ...CARD, id });
const nightFair = (id: string) =>
  balance({ shifts: { in: ["N"] } }, { ...CARD, id, hardness: "soft", priority: "low" });
const leave = (id: string, employee: string, days: number[]) =>
  countCard(id, { people: { ids: [employee] }, days: { days }, shifts: WORK, per: "person", max: 0 }, { scope: "period" });
const fixed = (id: string, employee: string, day: number, shift: string) =>
  ({ ...fixedCell(employee, day, shift, { id, weight: 1 }), source_text: "원문" }) as ConstraintSpec;
const avoid = (id: string, employee: string, shift: string) =>
  countCard(id, { people: { ids: [employee] }, shifts: { in: [shift] }, per: "person", max: 0 }, { scope: "period", hardness: "soft" });

const ruleIds = (rules: ConstraintSpec[]) => rules.map((c) => c.id);
const byId = (list: ConstraintSpec[], id: string) => list.find((c) => c.id === id)!;

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

/** 코드 이름과 주기가 뜻을 갖지 않는 테스트의 매장: 한 달 단위, D/E/N. */
function startDenShop(store: ReturnType<typeof fresh>) {
  store.getState().startShop();
  store.setState((s) => ({ shop: { ...s.shop!, unit: "month", config: DEN_CONFIG } }));
}

/** 게스트 입력: 매장(이영희 e01, 박민수 e02, 월 단위) + 첫 기간. */
function addInput(store: ReturnType<typeof createAppStore>) {
  startDenShop(store);
  store.getState().addEmployees(rows);
  store.getState().createPeriod(TODAY);
}

/** 매장(이영희 e01, 박민수 e02, 월 단위) + 첫 기간. */
function withPeriod() {
  const store = fresh();
  startDenShop(store);
  store.getState().addEmployees(rows);
  const id = store.getState().createPeriod(TODAY)!;
  const period = () => store.getState().periods.find((p) => p.id === id)!;
  return { store, id, period };
}

describe("초기 상태", () => {
  it("병동과 기간이 없고 홈에서 시작한다", () => {
    const s = fresh().getState();
    expect(s.shop).toBeNull();
    expect(s.periods).toEqual([]);
    expect(s.view).toEqual({ screen: "home" });
    expect(s.inputVersion).toBe(0);
    expect(s.storageAvailable).toBe(true);
    expect(s.resetNotice).toBe(false);
    expect(s.hasInput()).toBe(false);
  });
});

describe("병동", () => {
  it("startShop는 빈 병동을 만들고 처음 설정 ①로 간다", () => {
    const store = fresh();
    store.getState().startShop();
    const s = store.getState();
    expect(s.shop).toMatchObject({ name: "", unit: "1w", employees: [], nextEmployeeNo: 1, pendingConfig: [], unconverted: [] });
    // 기본 근무 형태, 기본 규칙 없음
    expect(s.shop!.config).toEqual(DEFAULT_CONFIG);
    expect(s.shop!.rules).toEqual([]);
    expect(s.view).toEqual({ screen: "setup", step: 1 });
    expect(s.hasInput()).toBe(true);
    expect(s.inputVersion).toBe(1);
  });

  it("setShopName·setUnit·setCoverage는 inputVersion을 올리고 필요 인원은 shop.rules의 기본 규칙이다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().setShopName("내과 5병동");
    store.getState().setUnit("2w");
    store.getState().setCoverage("D", "weekday", 3, 4);
    store.getState().setCoverage("D", "weekend", 2, 2);
    store.getState().setCoverage("D", "weekday", 4, 5);
    const w = store.getState().shop!;
    expect(w.name).toBe("내과 5병동");
    expect(w.unit).toBe("2w");
    expect(ruleIds(w.rules)).toEqual(["cov-weekday-D", "cov-weekend-D"]);
    expect(coverageRule(w.rules, "D", "weekday")).toMatchObject({
      type: "rule",
      scope: "shop",
      hardness: "hard",
      default: true,
      source_text: "필요 인원 설정",
      values: { min: { value: 4 }, max: { value: 5 } },
      body: { for_each: { per: "day", days: { kind: "weekday" } } },
    });
    expect(coverageRange(w.rules, "D", "weekday")).toEqual({ min: 4, max: 5 });
    expect(coverageRange(w.rules, "D", "weekend")).toEqual({ min: 2, max: 2 });
    expect(coverageRange(w.rules, "E", "weekend")).toBeNull();
    expect(store.getState().inputVersion).toBe(6);
  });

  it("setCoverage: 최대가 없으면 이상, 같으면 정확히, 범위면 최소·최대. 같은 칸은 제자리에서 바꾼다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().setCoverage("N", "weekday", 2, null);
    const w = () => store.getState().shop!;
    const cov = () => coverageRule(w().rules, "N", "weekday") as Rule;
    expect(cov().body).toMatchObject({ then: { op: "ge", right: { value: "min" } } });
    expect(coverageRange(w().rules, "N", "weekday")).toEqual({ min: 2, max: null });
    store.getState().setCoverage("N", "weekday", 2, 2);
    expect(cov().body).toMatchObject({ then: { op: "eq", right: { value: "min" } } });
    store.getState().setCoverage("N", "weekday", 2, 3);
    expect(cov().body).toMatchObject({ then: { all: [{ op: "ge" }, { op: "le" }] } });
    expect(ruleIds(w().rules)).toEqual(["cov-weekday-N"]);
    // 최소가 최대보다 크거나 음수면 바꾸지 않는다
    const v = store.getState().inputVersion;
    store.getState().setCoverage("N", "weekday", 4, 3);
    store.getState().setCoverage("N", "weekday", -1, null);
    expect(coverageRange(w().rules, "N", "weekday")).toEqual({ min: 2, max: 3 });
    expect(store.getState().inputVersion).toBe(v);
  });

  it("coverageRange는 폼 모양 규칙만 읽는다(토요일만·사람을 고른 규칙은 null)", () => {
    const saturday = countCard("s", { days: { weekdays: [5] }, shifts: { in: ["D"] }, per: "day", min: 2 });
    const charge = countCard("c", { people: { tags: ["책임"] }, days: { kind: "weekday" }, shifts: { in: ["D"] }, per: "day", min: 1 });
    expect(coverageRange([saturday, charge], "D", "weekday")).toBeNull();
    const weekday = countCard("w", { days: { kind: "weekday" }, shifts: { in: ["D"] }, per: "day", max: 4 });
    expect(coverageRange([weekday], "D", "weekday")).toEqual({ min: 0, max: 4 });
  });
});

describe("병동 규칙 카드", () => {
  it("대기 카드는 inputVersion 없이 쌓이고, 적용하면 rules로 옮긴다", () => {
    const store = fresh();
    startDenShop(store);
    const v = store.getState().inputVersion;
    store.getState().addPendingRules([maxWork("c1", 5)]);
    expect(store.getState().inputVersion).toBe(v);
    store.getState().applyRule("c1");
    expect(store.getState().shop!.pendingRules).toEqual([]);
    expect(ruleIds(store.getState().shop!.rules)).toEqual(["c1"]);
    expect(store.getState().inputVersion).toBe(v + 1);
  });

  it("말로 만든 필요 인원 카드(날마다 모든 사람의 개수)는 기본 규칙이 된다", () => {
    const store = fresh();
    startDenShop(store);
    const sat = countCard("sat-D", { days: { kind: "all", weekdays: [5] }, shifts: { in: ["D"] }, per: "day", min: 2 });
    store.getState().addPendingRules([sat, skillMix("s", "D"), minOff("m", 8)]);
    expect(store.getState().shop!.pendingRules.map((c) => [c.id, (c as Rule).default])).toEqual([
      ["sat-D", true],
      ["s", false],
      ["m", false],
    ]);
  });

  it("같은 type·scope·대상이면 교체하고, 대상이 다르면 추가한다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addPendingRules([
      maxWork("d", 5),
      maxWork("e", 6),
      skillMix("f", "N"),
      skillMix("g", "D"),
      forbid("h", "N", "D"),
      forbid("i", "E", "D"),
    ]);
    for (const id of ["d", "e", "f", "g", "h", "i"]) store.getState().applyRule(id);
    expect(ruleIds(store.getState().shop!.rules).sort()).toEqual(["e", "f", "g", "h", "i"]);
  });

  it("updateRule: 대기 카드는 inputVersion 없이, 적용된 규칙은 올리며 바꾸고 weight는 중요도를 따른다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addPendingRules([maxWork("p", 5), nightFair("q")]);
    store.getState().applyRule("q");
    const v = store.getState().inputVersion;
    store.getState().updateRule("p", { hardness: "soft" });
    expect(store.getState().shop!.pendingRules[0]).toMatchObject({ hardness: "soft", priority: "normal", weight: 10 });
    expect(store.getState().inputVersion).toBe(v);
    store.getState().updateRule("q", { hardness: "hard" });
    expect(byId(store.getState().shop!.rules, "q")).toMatchObject({ hardness: "hard", priority: "low", weight: 5 });
    expect(store.getState().inputVersion).toBe(v + 1);
    store.getState().updateRule("q", { priority: "high" });
    expect(byId(store.getState().shop!.rules, "q")).toMatchObject({ priority: "high", weight: 30 });
  });

  it("휴가 모양과 칸 고정은 hardness를 바꾸지 않는다", () => {
    const { store, id, period } = withPeriod();
    store.getState().addPendingRequests(id, [leave("l", "e01", [3]), fixed("f", "e01", 5, "D")]);
    store.getState().updateRequest(id, "l", { hardness: "soft" });
    store.getState().updateRequest(id, "f", { hardness: "soft" });
    expect(period().pendingRequests.map((c) => c.hardness)).toEqual(["hard", "hard"]);
  });

  it("setRuleValue: 값만 바꾸고, 최대 연속은 창 길이도 함께 바꾸며, 이름이 없거나 음수면 무시한다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addPendingRules([maxNights("p", 3), minOff("q", 8)]);
    store.getState().applyRule("q");
    const v = store.getState().inputVersion;
    store.getState().setRuleValue("p", "max_len", 4);
    const p = store.getState().shop!.pendingRules[0] as Rule;
    expect(val(p, "max_len")).toBe(4);
    expect(p.body).toMatchObject({ for_each: { per: "person_window", window: 5 } });
    expect(store.getState().inputVersion).toBe(v);
    store.getState().setRuleValue("q", "min", 9);
    expect(val(byId(store.getState().shop!.rules, "q"), "min")).toBe(9);
    expect(store.getState().inputVersion).toBe(v + 1);
    store.getState().setRuleValue("q", "없는값", 1);
    store.getState().setRuleValue("q", "min", -1);
    store.getState().setRuleValue("p", "max_len", 14); // 창 15일은 상한 밖
    expect(val(byId(store.getState().shop!.rules, "q"), "min")).toBe(9);
    expect(val(store.getState().shop!.pendingRules[0], "max_len")).toBe(4);
    expect(store.getState().inputVersion).toBe(v + 1);
  });

  it("removeRule: 기본 규칙은 지우지 않고 끈다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().setCoverage("D", "weekday", 3, 3);
    store.getState().removeRule("cov-weekday-D");
    expect(store.getState().shop!.rules.map((c) => [c.id, c.enabled])).toEqual([
      ["cov-weekday-D", false],
    ]);
  });

  it("enableRule: 끈 기본 규칙을 다시 켜고 inputVersion을 올린다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().setCoverage("D", "weekday", 3, null);
    store.getState().removeRule("cov-weekday-D");
    const v = store.getState().inputVersion;
    store.getState().enableRule("cov-weekday-D");
    expect(byId(store.getState().shop!.rules, "cov-weekday-D").enabled).toBe(true);
    expect(store.getState().inputVersion).toBe(v + 1);
    store.getState().enableRule("cov-weekday-D"); // 이미 켜져 있으면 그대로
    store.getState().enableRule("없는규칙");
    expect(store.getState().inputVersion).toBe(v + 1);
  });

  it("removeRule: 대기 카드는 inputVersion 없이, 적용된 규칙은 올리며 지운다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addPendingRules([maxWork("p", 5), minOff("q", 8)]);
    store.getState().applyRule("q");
    const v = store.getState().inputVersion;
    store.getState().removeRule("p");
    expect(store.getState().inputVersion).toBe(v);
    store.getState().removeRule("q");
    expect(store.getState().shop!.rules).toEqual([]);
    expect(store.getState().inputVersion).toBe(v + 1);
  });
});

describe("카드 예시", () => {
  const example = (detail: string): RuleExample => ({ employee_ids: ["e01"], days: [1, 2], cells: { e01: ["N", "D"] }, marks: [["e01", 2]], detail });

  it("병동 규칙: 카드별로 한 번 저장하고, 적용해도 남고, 지우거나 교체되면 지운다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addPendingRules([forbid("a", "N", "D"), maxWork("b", 5)], [], { a: [example("가")], b: [], x: [example("없는 카드")] });
    const w = () => store.getState().shop!;
    expect(w().examples).toEqual({ a: [example("가")] });
    store.getState().applyRule("a");
    expect(w().examples).toEqual({ a: [example("가")] });
    // 같은 모양의 새 카드가 교체하면 옛 카드의 예시를 지운다
    store.getState().addPendingRules([forbid("a2", "N", "D")], [], { a2: [example("나")] });
    store.getState().applyRule("a2");
    expect(w().examples).toEqual({ a2: [example("나")] });
    store.getState().removeRule("a2");
    expect(w().examples).toEqual({});
  });

  it("요청: 카드별로 저장하고 지우면 지우며, 요청 본문에는 넣지 않는다", () => {
    const { store, id, period } = withPeriod();
    store.getState().addPendingRequests(id, [leave("l", "e01", [3]), avoid("p", "e02", "N")], { l: [example("휴가")] });
    expect(period().examples).toEqual({ l: [example("휴가")] });
    store.getState().applyRequest(id, "l");
    const req = toScheduleRequest(store.getState().shop!, period(), store.getState().periods, TODAY);
    expect(JSON.stringify(req)).not.toContain("휴가");
    store.getState().removeRequest(id, "l");
    expect(period().examples).toEqual({});
  });

  it("값을 바꾸면 그 카드의 예시를 지운다(예시는 옛 값으로 판정한 것)", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addPendingRules([maxNights("p", 3), minOff("q", 8)], [], { p: [example("가")], q: [example("나")] });
    store.getState().applyRule("q");
    store.getState().setRuleValue("p", "없는값", 4);
    expect(store.getState().shop!.examples).toEqual({ p: [example("가")], q: [example("나")] });
    store.getState().setRuleValue("p", "max_len", 4);
    store.getState().setRuleValue("q", "min", 9);
    expect(store.getState().shop!.examples).toEqual({});

    const { store: s2, id, period } = withPeriod();
    s2.getState().addPendingRequests(id, [leave("l", "e01", [3])], { l: [example("휴가")] });
    s2.getState().applyRequest(id, "l");
    s2.getState().setRequestValue(id, "l", "max", 1);
    expect(period().examples).toEqual({});
  });
});

describe("카드 순서", () => {
  const ids = (list: { card: ConstraintSpec; pending: boolean }[]) => list.map((x) => `${x.card.id}${x.pending ? "?" : ""}`);

  it("병동 규칙: 새 카드는 맨 위에 붙고, 적용해도 제자리에 남는다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addPendingRules([maxWork("a", 5)]);
    store.getState().addPendingRules([minOff("b", 8), maxNights("c", 3)]);
    const w = () => store.getState().shop!;
    const order = () => ids(cardsInOrder(w().pendingRules, w().rules, w().cardOrder));
    expect(order()).toEqual(["b?", "c?", "a?"]);
    store.getState().applyRule("c");
    expect(order()).toEqual(["b?", "c", "a?"]);
    store.getState().applyRule("a");
    store.getState().applyRule("b");
    expect(order()).toEqual(["b", "c", "a"]);
  });

  it("요청: 적용해도 제자리에 남고, 교체된 카드 자리에는 새 카드만 남는다", () => {
    const { store, id, period } = withPeriod();
    store.getState().addPendingRequests(id, [fixed("f1", "e01", 3, "D")]);
    store.getState().applyRequest(id, "f1");
    store.getState().addPendingRequests(id, [leave("l1", "e02", [5]), fixed("f2", "e01", 3, "E")]);
    const order = () => ids(cardsInOrder(period().pendingRequests, period().requests, period().cardOrder));
    expect(order()).toEqual(["l1?", "f2?", "f1"]);
    store.getState().applyRequest(id, "f2");
    expect(order()).toEqual(["l1?", "f2"]);
  });

  it("순서 정보가 없는 카드(옛 저장본·샘플)는 대기 → 적용 순으로 뒤에 둔다", () => {
    const p = minOff("p", 8);
    const a = maxWork("a", 5);
    const n = nightFair("n");
    expect(ids(cardsInOrder([p], [a, n], undefined))).toEqual(["p?", "a", "n"]);
    expect(ids(cardsInOrder([p], [a, n], ["n"]))).toEqual(["n", "p?", "a"]);
  });
});

describe("findReplaced", () => {
  it("같은 type·scope·대상의 다른 제약을 찾고, 휴가는 대체하지 않는다", () => {
    const existing = [leave("a", "e01", [3]), maxWork("b", 5), avoid("p", "e02", "N")];
    expect(findReplaced(existing, maxWork("c", 4))?.id).toBe("b");
    expect(findReplaced(existing, { ...maxWork("e", 4), scope: "period" })).toBeUndefined();
    expect(findReplaced(existing, existing[1])).toBeUndefined();
    expect(findReplaced(existing, leave("l", "e01", [9]))).toBeUndefined();
    expect(findReplaced(existing, maxNights("n", 4))).toBeUndefined();
    // 같은 사람·근무의 희망은 기피를 대체한다(수만 다르다)
    const prefer = countCard("q", { people: { ids: ["e02"], exclude_tags: [] }, shifts: { in: ["N"] }, per: "person", min: 30 }, { scope: "period", hardness: "soft" });
    expect(findReplaced(existing, prefer)?.id).toBe("p");
  });
});

describe("간호사 id", () => {
  it("addEmployees는 e{번호}를 부여하고 nextEmployeeNo를 올린다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addEmployees(rows);
    const w = store.getState().shop!;
    expect(w.employees).toEqual([
      { id: "e01", name: "이영희", tags: [], active: true },
      { id: "e02", name: "박민수", tags: [], active: true },
    ]);
    expect(w.nextEmployeeNo).toBe(3);
  });

  it("nextEmployeeNo는 삭제 후에도 줄어들지 않고 지운 번호를 다시 쓰지 않는다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addEmployees(rows);
    store.getState().removeEmployee("e02");
    store.getState().addEmployees([{ name: "김철수" }]);
    expect(store.getState().shop!.employees.map((n) => n.id)).toEqual(["e01", "e03"]);
    expect(store.getState().shop!.nextEmployeeNo).toBe(4);
  });

  it("updateEmployee·setEmployeeActive는 id를 바꾸지 않는다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addEmployees(rows);
    store.getState().updateEmployee("e01", { name: "이영희A" });
    store.getState().setEmployeeActive("e02", false);
    expect(store.getState().shop!.employees).toEqual([
      { id: "e01", name: "이영희A", tags: [], active: true },
      { id: "e02", name: "박민수", tags: [], active: false },
    ]);
  });

  it("removeEmployee는 어떤 기간에서도 쓰이지 않은 간호사만 지우고, 아니면 비활성으로 바꾼다", () => {
    const { store, id } = withPeriod();
    store.getState().addPendingRequests(id, [leave("l", "e01", [3])]);
    store.getState().removeEmployee("e01"); // 초안 기간의 대기 요청이 참조
    store.getState().removeEmployee("e02");
    expect(store.getState().shop!.employees.map((n) => [n.id, n.active])).toEqual([["e01", false]]);
  });

  it("isEmployeeUsed는 기간 요청·결과에서 쓰인 간호사만 true다([삭제] 표시 기준)", () => {
    const { store, id } = withPeriod();
    store.getState().setResult(id, result({ e02: ["D"] }), []);
    const { shop, periods } = store.getState();
    expect(isEmployeeUsed("e01", shop!, periods)).toBe(false);
    expect(isEmployeeUsed("e02", shop!, periods)).toBe(true);
  });

  it("결과나 확정본에 있는 간호사도 지우지 않는다", () => {
    const { store, id } = withPeriod();
    store.getState().setResult(id, result({ e02: ["D"] }), []);
    store.getState().removeEmployee("e02");
    expect(store.getState().shop!.employees.find((n) => n.id === "e02")?.active).toBe(false);
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
      startDenShop(store);
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
    store.getState().setResult(id, result({ e01: ["D"], e02: ["O"] }), []);
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
    store.getState().setCarryOver(id, [{ employee_id: "e01", shifts: ["N"] }]);
    expect(period().carryOver).toEqual([{ employee_id: "e01", shifts: ["N"] }]);
    store.getState().addPendingRequests(id, [leave("l1", "e01", [15]), leave("l2", "e01", [20])]);
    expect(store.getState().inputVersion).toBe(v + 4);
    store.getState().applyRequest(id, "l1");
    store.getState().applyRequest(id, "l2");
    expect(period().requests.map((c) => c.id)).toEqual(["l1", "l2"]);
    expect(period().pendingRequests).toEqual([]);
    store.getState().setRequestValue(id, "l2", "max", 1);
    store.getState().setRequestValue(id, "l2", "없는값", 1);
    expect(val(period().requests[1], "max")).toBe(1);
    store.getState().removeRequest(id, "l1");
    expect(period().requests.map((c) => c.id)).toEqual(["l2"]);
    expect(store.getState().inputVersion).toBe(v + 8);
  });

  it("setFixed는 같은 칸의 고정을 교체하고 원문의 M/D는 실제 날짜, clearFixed는 그 칸만 지운다", () => {
    const { store, id, period } = withPeriod();
    store.getState().setFixed(id, "e01", 5, "D");
    store.getState().setFixed(id, "e01", 6, "E");
    store.getState().setFixed(id, "e01", 5, "N");
    expect(period().requests.map((c) => (c.type === "fixed_assignment" ? c.params : null))).toEqual([
      { employee_id: "e01", day: 6, shift: "E" },
      { employee_id: "e01", day: 5, shift: "N" },
    ]);
    expect(period().requests[1]).toMatchObject({
      type: "fixed_assignment",
      scope: "period",
      hardness: "hard",
      source_text: "수동 고정: 이영희 11/5 N",
    });
    store.getState().clearFixed(id, "e01", 6);
    expect(period().requests.map((c) => (c.type === "fixed_assignment" ? c.params : null))).toEqual([{ employee_id: "e01", day: 5, shift: "N" }]);
  });

  it("setResult는 inputVersion을 바꾸지 않고 그때의 버전을 resultVersion으로 남긴다", () => {
    const { store, id, period } = withPeriod();
    const v = store.getState().inputVersion;
    store.getState().setResult(id, result({ e01: ["D"] }), []);
    expect(period().resultVersion).toBe(v);
    expect(store.getState().inputVersion).toBe(v);
  });

  it("go는 inputVersion을 올리지 않는다", () => {
    const { store, id } = withPeriod();
    const v = store.getState().inputVersion;
    store.getState().go({ screen: "settings", tab: "rules" });
    store.getState().go({ screen: "period", periodId: id, step: 2 });
    expect(store.getState().inputVersion).toBe(v);
    expect(store.getState().view).toEqual({ screen: "period", periodId: id, step: 2 });
  });
});

describe("이번 기간만 끄기와 제안 수락", () => {
  function setup() {
    const ctx = withPeriod();
    const { store, id } = ctx;
    store.getState().addPendingRules([maxNights("r", 3)]);
    store.getState().applyRule("r");
    store.getState().addPendingRequests(id, [leave("l", "e01", [3, 4]), avoid("p", "e02", "N")]);
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
    expect(byId(store.getState().shop!.rules, "r").enabled).toBe(true);
    expect(period().requests[0].enabled).toBe(true);
    store.getState().setDisabled(id, "r", false);
    expect(period().disabledIds).toEqual(["l"]);
    expect(store.getState().inputVersion).toBe(v + 3);
  });

  it("applyChanges: disable은 disabledIds, 요청의 값·hardness는 요청을, 병동 규칙의 값·hardness는 ruleOverrides를 바꾼다", () => {
    const { store, id, period } = setup();
    store.getState().applyChanges(id, [
      { action: "set_value", constraint_id: "r", name: "max_len", value: 4 },
      { action: "set_hardness", constraint_id: "r", hardness: "soft" },
      { action: "disable", constraint_id: "l" },
      { action: "set_hardness", constraint_id: "p", hardness: "hard" },
      { action: "set_value", constraint_id: "없음", name: "max_len", value: 1 },
      { action: "set_value", constraint_id: "p", name: "없는값", value: 1 },
    ]);
    const p = period();
    expect(byId(store.getState().shop!.rules, "r")).toMatchObject({ values: { max_len: { value: 3 } }, hardness: "hard" });
    expect(p.ruleOverrides.r).toMatchObject({
      id: "r",
      values: { max_len: { value: 4 } },
      body: { for_each: { window: 5 } },
      hardness: "soft",
      weight: 10,
    });
    expect(p.disabledIds).toEqual(["l"]);
    expect(p.requests[1]).toMatchObject({ hardness: "hard", weight: 10 });
    expect(Object.keys(p.ruleOverrides)).toEqual(["r"]);
  });
});

describe("toScheduleRequest", () => {
  it("현재 병동과 기간으로 요청 본문을 만든다(근무 형태·태그, override 적용, 꺼진 제약 enabled=false)", () => {
    const { store, id, period } = withPeriod();
    store.getState().setCoverage("D", "weekday", 1, 1);
    store.getState().addPendingRules([maxNights("r", 3)]);
    store.getState().applyRule("r");
    store.getState().addPendingRequests(id, [leave("l", "e01", [3])]);
    store.getState().applyRequest(id, "l");
    store.getState().toggleHoliday(id, 18);
    store.getState().setDisabled(id, "l", true);
    store.getState().applyChanges(id, [{ action: "set_value", constraint_id: "r", name: "max_len", value: 4 }]);
    store.getState().addTag("e02", "책임");

    const req = toScheduleRequest(store.getState().shop!, period(), store.getState().periods, TODAY);
    expect(req.config).toEqual(DEN_CONFIG);
    expect(req.employees).toEqual([
      { id: "e01", name: "이영희", tags: [] },
      { id: "e02", name: "박민수", tags: ["책임"] },
    ]);
    expect(req.period).toEqual({ start_date: "2026-11-01", length: 30 });
    expect(req.holidays).toEqual([18]);
    expect(req.constraints!.map((c) => [c.id, c.enabled])).toEqual([
      ["cov-weekday-D", true],
      ["r", true],
      ["l", false],
    ]);
    expect(val(req.constraints![1], "max_len")).toBe(4);
    // 카드 예시는 요청 본문에 넣지 않는다
    expect(JSON.stringify(req)).not.toContain("examples");
    expect(req.history).toBeNull();
    expect(req.carry_over).toEqual([]);
    expect(req.previous ?? null).toBeNull();
    expect(req).not.toHaveProperty("input_version");
  });

  it("비활성 간호사와 그를 참조하는 제약·이월·이전 배정을 뺀다", () => {
    const { store, id, period } = withPeriod();
    store.getState().addPendingRequests(id, [leave("l1", "e01", [3]), leave("l2", "e02", [3]), leave("x", "e99", [3])]);
    for (const c of ["l1", "l2", "x"]) store.getState().applyRequest(id, c);
    store.getState().setCarryOver(id, [
      { employee_id: "e01", shifts: ["N"] },
      { employee_id: "e02", shifts: ["D"] },
    ]);
    store.getState().setResult(id, result({ e01: ["D", "E"], e02: ["N", "O"] }), []);
    store.getState().setEmployeeActive("e02", false);

    const req = toScheduleRequest(store.getState().shop!, period(), store.getState().periods, TODAY);
    expect(req.employees.map((n) => n.id)).toEqual(["e01"]);
    expect(req.constraints!.map((c) => c.id)).toEqual(["l1"]);
    expect(req.carry_over).toEqual([{ employee_id: "e01", shifts: ["N"] }]);
    expect(req.previous).toEqual({ e01: ["D", "E"] });
  });

  it("확정된 기간은 병동이 바뀌어도 확정 시점의 명단과 병동 규칙을 쓴다", () => {
    const { store, id, period } = withPeriod();
    store.getState().setCoverage("D", "weekday", 1, 1);
    store.getState().setResult(id, result({ e01: ["D"], e02: ["O"] }), []);
    store.getState().confirm(id);

    store.getState().setCoverage("D", "weekday", 2, 2);
    store.getState().addEmployees([{ name: "김철수" }]);
    store.getState().setEmployeeActive("e02", false);

    const confirmedReq = toScheduleRequest(store.getState().shop!, period(), store.getState().periods, TODAY);
    expect(confirmedReq.employees.map((n) => n.id)).toEqual(["e01", "e02"]);
    expect(coverageRange(confirmedReq.constraints!, "D", "weekday")).toEqual({ min: 1, max: 1 });
  });
});

describe("confirm", () => {
  it("status를 확정으로, versions에 1개, snapshot에 활성 명단과 원본 병동 규칙을 남긴다", () => {
    const { store, id, period } = withPeriod();
    store.getState().addPendingRules([maxNights("r", 3)]);
    store.getState().applyRule("r");
    store.getState().applyChanges(id, [{ action: "set_value", constraint_id: "r", name: "max_len", value: 4 }]);
    store.getState().addEmployees([{ name: "김철수" }]);
    store.getState().setEmployeeActive("e03", false);

    store.getState().confirm(id);
    expect(period().status).toBe("draft"); // 결과가 없으면 확정하지 않는다

    store.getState().setResult(id, result({ e01: ["D"], e02: ["O"] }), []);
    store.getState().confirm(id);
    const p = period();
    expect(p.status).toBe("confirmed");
    expect(p.versions).toEqual([
      {
        confirmed_at: CONFIRMED_AT.toISOString(),
        assignments: { e01: ["D"], e02: ["O"] },
        changed: [],
        requests: [],
        result: result({ e01: ["D"], e02: ["O"] }),
        carryOverUsed: [],
      },
    ]);
    expect(p.snapshot!.employees.map((n) => n.id)).toEqual(["e01", "e02"]);
    expect(val(byId(p.snapshot!.rules, "r"), "max_len")).toBe(3);
  });

  it("확정하면 확정 근무표 화면으로 옮기고, 결과가 없으면 화면을 그대로 둔다", () => {
    const { store, id } = withPeriod();
    store.getState().confirm(id);
    expect(store.getState().view).toEqual({ screen: "period", periodId: id, step: 1 });
    store.getState().setResult(id, result({ e01: ["D"], e02: ["O"] }), []);
    store.getState().go({ screen: "period", periodId: id, step: 2 });
    store.getState().confirm(id);
    expect(store.getState().view).toEqual({ screen: "confirmed", periodId: id });
  });
});

describe("변경 취소", () => {
  const sick = leave("sick", "e01", [5]);

  it("마지막 확정본의 배정·결과와 요청으로 되돌리고 inputVersion을 올린다", () => {
    const { store, id, period } = withConfirmed(fill(30, "D"), fill(30, "O"));
    expect(canRevertToConfirmed(period())).toBe(false); // 바뀐 것이 없다

    store.getState().addPendingRequests(id, [sick]);
    store.getState().applyRequest(id, "sick");
    const changed = fill(30, "D");
    changed[4] = "O";
    store.getState().setResult(id, result({ e01: changed, e02: fill(30, "O") }), []);
    expect(canRevertToConfirmed(period())).toBe(true);

    const v = store.getState().inputVersion;
    store.getState().revertToConfirmed(id);
    const p = period();
    expect(p.requests).toEqual([]);
    expect(p.result!.assignments).toEqual({ e01: fill(30, "D"), e02: fill(30, "O") });
    expect(store.getState().inputVersion).toBe(v + 1);
    expect(p.resultVersion).toBe(v + 1); // 되돌린 결과는 stale이 아니다
    expect(hasUnconfirmedChanges(p)).toBe(false);
    expect(canRevertToConfirmed(p)).toBe(false);
    expect(p.versions).toHaveLength(1);
  });

  it("결과를 만든 이월도 확정본의 것으로 되돌린다(지난 근무 변경 판정)", () => {
    const { store, id, period } = withConfirmed(fill(30, "D"), fill(30, "O"));
    const nextId = store.getState().createPeriod(TODAY)!;
    const next = () => store.getState().periods.find((p) => p.id === nextId)!;
    const req = () => toScheduleRequest(store.getState().shop!, next(), store.getState().periods, TODAY);
    store.getState().setResult(nextId, result({ e01: fill(31, "D"), e02: fill(31, "O") }), req().carry_over ?? []);
    store.getState().confirm(nextId);

    const late = fill(30, "D");
    late[29] = "N";
    store.getState().setResult(id, result({ e01: late, e02: fill(30, "O") }), []);
    store.getState().confirm(id);
    expect(carryOverChanged(next(), store.getState().periods)).toBe(true);

    const changed = fill(31, "D");
    changed[0] = "O";
    store.getState().setResult(nextId, result({ e01: changed, e02: fill(31, "O") }), req().carry_over ?? []);
    expect(carryOverChanged(next(), store.getState().periods)).toBe(false);
    store.getState().revertToConfirmed(nextId);
    expect(carryOverChanged(next(), store.getState().periods)).toBe(true);
    expect(period().status).toBe("confirmed");
  });

  it("요청만 바뀌어도(다시 만들기 전) 되돌릴 수 있다", () => {
    const { store, id, period } = withConfirmed();
    store.getState().addPendingRequests(id, [sick]);
    store.getState().applyRequest(id, "sick");
    expect(canRevertToConfirmed(period())).toBe(true);
  });

  it("요청을 남기지 않은 옛 버전은 되돌릴 수 없고 revertToConfirmed는 아무것도 하지 않는다", () => {
    const { store, id, period } = withConfirmed(fill(30, "D"), fill(30, "O"));
    const old = { ...period().versions[0] };
    delete (old as Partial<typeof old>).requests;
    delete (old as Partial<typeof old>).result;
    store.setState({ periods: store.getState().periods.map((p) => (p.id === id ? { ...p, versions: [old] } : p)) });
    const changed = fill(30, "D");
    changed[4] = "O";
    store.getState().setResult(id, result({ e01: changed, e02: fill(30, "O") }), []);
    expect(canRevertToConfirmed(period())).toBe(false);
    const before = period();
    store.getState().revertToConfirmed(id);
    expect(period()).toBe(before);
  });

  it("초안 기간은 되돌릴 수 없다", () => {
    const { store, id, period } = withPeriod();
    store.getState().setResult(id, result({ e01: ["D"] }), []);
    expect(canRevertToConfirmed(period())).toBe(false);
  });
});

/** 길이 len의 근무 배열(pattern 반복). */
const fill = (len: number, pattern: string) => Array.from({ length: len }, (_, i) => pattern[i % pattern.length]);

/** 첫 기간(2026-11-01, 30일)을 e01·e02 배정으로 확정한다. */
function withConfirmed(e01 = fill(30, "DDEENNO"), e02 = fill(30, "O")) {
  const ctx = withPeriod();
  ctx.store.getState().setResult(ctx.id, result({ e01, e02 }), []);
  ctx.store.getState().confirm(ctx.id);
  return ctx;
}

describe("기간 연속성: 요청 조립", () => {
  it("연속한 다음 기간은 범위가 자동이고, carry_over는 지난 확정본 마지막 7일이다(기간에 복사하지 않음)", () => {
    const e01 = fill(30, "DDEENNO");
    const { store } = withConfirmed(e01);
    const nextId = store.getState().createPeriod(TODAY)!;
    const next = store.getState().periods.find((p) => p.id === nextId)!;
    expect([next.start_date, next.length, next.holidays]).toEqual(["2026-12-01", 31, []]);
    expect(next.carryOver).toEqual([]);

    const req = toScheduleRequest(store.getState().shop!, next, store.getState().periods, TODAY);
    expect(req.carry_over).toEqual([
      { employee_id: "e01", shifts: e01.slice(-7) },
      { employee_id: "e02", shifts: fill(7, "O") },
    ]);
  });

  it("지난 확정 기간이 없는 첫 기간은 수동 입력 carry_over를 쓴다", () => {
    const { store, id, period } = withPeriod();
    store.getState().setCarryOver(id, [{ employee_id: "e01", shifts: ["N", "N"] }]);
    const req = toScheduleRequest(store.getState().shop!, period(), store.getState().periods, TODAY);
    expect(req.carry_over).toEqual([{ employee_id: "e01", shifts: ["N", "N"] }]);
  });

  it("history는 최근 28일 확정본 원본이고 비활성 간호사는 뺀다", () => {
    const { store, id } = withConfirmed(fill(30, "N"), fill(30, "D"));
    store.getState().toggleHoliday(id, 4); // 확정 뒤 공휴일을 바꿔도 그 기간의 공휴일 날짜를 쓴다
    store.getState().setEmployeeActive("e02", false);
    const nextId = store.getState().createPeriod(TODAY)!;
    const next = store.getState().periods.find((p) => p.id === nextId)!;
    const req = toScheduleRequest(store.getState().shop!, next, store.getState().periods, TODAY);
    // 창: 11/3~11/30
    expect(req.history).toEqual({ start_date: "2026-11-03", rows: { e01: fill(28, "N") }, holidays: ["2026-11-04"] });
    expect(req.employees.map((n) => n.id)).toEqual(["e01"]);
  });

  it("운영 중 기간은 오늘 이전 날짜 잠금을 더하고, 같은 칸의 수동 고정은 뺀다", () => {
    const { store, id, period } = withConfirmed(fill(30, "D"), fill(30, "O"));
    store.getState().setFixed(id, "e01", 2, "O");
    store.getState().setFixed(id, "e01", 10, "E");

    const req = toScheduleRequest(store.getState().shop!, period(), store.getState().periods, "2026-11-05");
    const ids = req.constraints!.map((c) => c.id);
    expect(ids).toContain("fix-e01-10");
    expect(ids).not.toContain("fix-e01-2");
    const locks = req.constraints!.filter((c) => c.id.startsWith("lock-"));
    expect(locks).toHaveLength(8); // 2명 × 11/1~11/4
    expect(locks.find((c) => c.id === "lock-e01-2")).toMatchObject({ params: { employee_id: "e01", day: 2, shift: "D" } });
    // 잠금은 요청에 저장하지 않는다
    expect(period().requests.some((c) => c.id.startsWith("lock-"))).toBe(false);

    // 운영 전(오늘이 기간 시작 전)에는 잠금이 없다
    const before = toScheduleRequest(store.getState().shop!, period(), store.getState().periods, TODAY);
    expect(before.constraints!.some((c) => c.id.startsWith("lock-"))).toBe(false);
    expect(before.constraints!.map((c) => c.id)).toContain("fix-e01-2");
  });
});

describe("기간 연속성: 확정 버전과 이월 변경", () => {
  it("[다시 확정]은 직전 버전 대비 changed로 버전을 추가하고, 바뀐 칸이 없으면 추가하지 않는다", () => {
    const { store, id, period } = withConfirmed(fill(30, "D"), fill(30, "O"));
    expect(hasUnconfirmedChanges(period())).toBe(false);

    store.getState().setResult(id, result({ e01: fill(30, "D"), e02: fill(30, "O") }), []);
    store.getState().confirm(id);
    expect(period().versions).toHaveLength(1);

    const changed = fill(30, "D");
    changed[4] = "O";
    store.getState().setResult(id, result({ e01: changed, e02: fill(30, "O") }), []);
    expect(hasUnconfirmedChanges(period())).toBe(true);
    store.getState().confirm(id);
    const p = period();
    expect(p.status).toBe("confirmed");
    expect(p.versions).toHaveLength(2);
    expect(p.versions[1].changed).toEqual([{ employee_id: "e01", day: 5, before: "D", after: "O" }]);
    expect(p.versions[1].assignments.e01).toEqual(changed);
    expect(hasUnconfirmedChanges(p)).toBe(false);

    store.getState().confirm(id);
    expect(period().versions).toHaveLength(2);
  });

  it("초안 기간은 hasUnconfirmedChanges가 false다", () => {
    const { store, id, period } = withPeriod();
    store.getState().setResult(id, result({ e01: ["D"] }), []);
    expect(hasUnconfirmedChanges(period())).toBe(false);
  });

  it("setResult는 그 요청에 쓴 carry_over를 carryOverUsed로 남긴다", () => {
    const { store, id, period } = withPeriod();
    expect(period().carryOverUsed).toBeNull();
    store.getState().setResult(id, result({ e01: ["D"] }), [{ employee_id: "e01", shifts: ["N"] }]);
    expect(period().carryOverUsed).toEqual([{ employee_id: "e01", shifts: ["N"] }]);
  });

  it("지난 기간 [다시 확정]으로 마지막 7일이 바뀌면 다음 기간의 carryOverChanged가 true다(초안·확정 모두)", () => {
    const { store, id } = withConfirmed(fill(30, "D"), fill(30, "O"));
    const nextId = store.getState().createPeriod(TODAY)!;
    const next = () => store.getState().periods.find((p) => p.id === nextId)!;
    expect(carryOverChanged(next(), store.getState().periods)).toBe(false); // 아직 생성 안 함

    const req = toScheduleRequest(store.getState().shop!, next(), store.getState().periods, TODAY);
    store.getState().setResult(nextId, result({ e01: fill(31, "D"), e02: fill(31, "O") }), req.carry_over ?? []);
    expect(carryOverChanged(next(), store.getState().periods)).toBe(false);

    // 마지막 7일 밖(1일)만 바뀌면 이월은 같다
    const early = fill(30, "D");
    early[0] = "O";
    store.getState().setResult(id, result({ e01: early, e02: fill(30, "O") }), []);
    store.getState().confirm(id);
    expect(carryOverChanged(next(), store.getState().periods)).toBe(false);

    const late = [...early];
    late[29] = "N";
    store.getState().setResult(id, result({ e01: late, e02: fill(30, "O") }), []);
    expect(carryOverChanged(next(), store.getState().periods)).toBe(false); // 다시 확정 전에는 그대로
    store.getState().confirm(id);
    expect(carryOverChanged(next(), store.getState().periods)).toBe(true);

    store.getState().confirm(nextId);
    expect(next().status).toBe("confirmed");
    expect(carryOverChanged(next(), store.getState().periods)).toBe(true);
  });
});

describe("createPeriod: 다음 기간", () => {
  it("단위를 바꿔도 마지막 기간 끝 다음 날에 이어서 새 단위로 만든다", () => {
    const { store } = withConfirmed();
    store.getState().toggleHoliday(store.getState().periods[0].id, 18);
    store.getState().setUnit("1w");
    const nextId = store.getState().createPeriod(TODAY)!;
    const next = store.getState().periods.find((p) => p.id === nextId)!;
    // 11/30 끝 → 12/1(화)부터 7일
    expect([next.start_date, next.length, next.holidays]).toEqual(["2026-12-01", 7, []]);
  });
});

describe("homeSummary", () => {
  it("운영 중 기간과 다음 기간(없음·초안·확정), 최근 기간(시작일 내림차순)", () => {
    const { store, id } = withPeriod();
    // 오늘이 첫 기간 시작 전: 운영 중 없음, 다음 = 첫 기간 초안
    let h = homeSummary(store.getState().periods, TODAY);
    expect(h.operating).toBeNull();
    expect(h.next).toMatchObject({ state: "draft", period: { id } });

    store.getState().setResult(id, result({ e01: fill(30, "D"), e02: fill(30, "O") }), []);
    store.getState().confirm(id);
    const during = "2026-11-05";
    h = homeSummary(store.getState().periods, during);
    expect(h.operating?.id).toBe(id);
    expect(h.next).toEqual({ state: "none" });

    const nextId = store.getState().createPeriod(during)!;
    h = homeSummary(store.getState().periods, during);
    expect(h.next).toMatchObject({ state: "draft", period: { id: nextId } });
    expect(h.recent.map((p) => p.id)).toEqual([nextId, id]);

    store.getState().setResult(nextId, result({ e01: fill(31, "D"), e02: fill(31, "O") }), []);
    store.getState().confirm(nextId);
    h = homeSummary(store.getState().periods, during);
    expect(h.next).toMatchObject({ state: "confirmed", period: { id: nextId } });
  });
});

describe("rosterChangesFor", () => {
  it("지난 확정 기간 snapshot 대비 추가·비활성화된 간호사", () => {
    const { store, id } = withConfirmed();
    store.getState().addEmployees([{ name: "김철수" }]);
    store.getState().setEmployeeActive("e02", false);
    const nextId = store.getState().createPeriod(TODAY)!;
    const { shop, periods } = store.getState();
    const changes = rosterChangesFor(shop!, periods, nextId);
    expect(changes.added.map((n) => n.id)).toEqual(["e03"]);
    expect(changes.deactivated.map((n) => n.id)).toEqual(["e02"]);
    expect(rosterChangesFor(shop!, periods, id)).toEqual({ added: [], deactivated: [] });
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
    store.getState().addPendingRequests(id, [leave("ok", "e01", [3]), fixed("gone", "e09", 2, "D")]);
    store.getState().applyRequest(id, "ok");
    store.getState().applyRequest(id, "gone");
    expect(orphanConstraintIds(store.getState().shop!, period())).toEqual(["gone"]);
    store.getState().setEmployeeActive("e01", false);
    expect(orphanConstraintIds(store.getState().shop!, period())).toEqual(["ok", "gone"]);
  });
});

describe("reset", () => {
  it("병동과 기간을 모두 지우고 홈으로, inputVersion은 올린다", () => {
    const store = fresh();
    addInput(store);
    const before = store.getState().inputVersion;
    store.getState().reset();
    const s = store.getState();
    expect(s.hasInput()).toBe(false);
    expect(s.shop).toBeNull();
    expect(s.periods).toEqual([]);
    expect(s.view).toEqual({ screen: "home" });
    expect(s.inputVersion).toBe(before + 1);
  });
});

describe("persist", () => {
  it("localStorage에 저장하고 다시 만들면 복원한다", () => {
    const storage = new MemoryStorage();
    const a = fresh(storage);
    addInput(a);
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(saved.version).toBe(1);
    expect(saved.state).not.toHaveProperty("storageAvailable");

    const b = fresh(storage).getState();
    expect(b.shop).toEqual(a.getState().shop);
    expect(b.periods).toEqual(a.getState().periods);
    expect(b.view).toEqual(a.getState().view);
    expect(b.inputVersion).toBe(a.getState().inputVersion);
    expect(b.resetNotice).toBe(false);
  });

  it("버전이 다르면 초기 상태로 되돌리고 resetNotice를 켠다", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, state: { step: 3, period: { start_date: "2026-11-01", length: 30 }, employees: [], inputVersion: 9 } }),
    );
    const s = fresh(storage).getState();
    expect(s.shop).toBeNull();
    expect(s.resetNotice).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).state.shop).toBeNull();
  });

  it("모양이 맞아도 버전이 다르면 변환하지 않고 초기화한다", () => {
    const storage = new MemoryStorage();
    const { state } = serverDoc();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION - 1, state }));
    const s = fresh(storage).getState();
    expect(s.shop).toBeNull();
    expect(s.resetNotice).toBe(true);
  });

  it("JSON 파싱에 실패하면 초기화한다", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    const s = fresh(storage).getState();
    expect(s.shop).toBeNull();
    expect(s.resetNotice).toBe(true);
  });

  it("모양이 손상되면 초기화한다", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state: { shop: { employees: "x" }, periods: [], inputVersion: 1 } }));
    const s = fresh(storage).getState();
    expect(s.shop).toBeNull();
    expect(s.resetNotice).toBe(true);
    // 근무 형태가 없는 매장도 손상으로 본다
    const shop = { name: "", unit: "1w", employees: [], nextEmployeeNo: 1, rules: [], pendingRules: [], pendingConfig: [], unconverted: [] };
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state: { shop, periods: [], view: { screen: "home" }, inputVersion: 1 } }));
    expect(fresh(storage).getState().resetNotice).toBe(true);
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
    startDenShop(store);
    store.getState().addEmployees(rows);
    expect(store.getState().shop!.employees).toHaveLength(2);
  });

  it("쓰기가 예외를 던지면 메모리로 동작한다", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = fresh(storage);
    expect(store.getState().storageAvailable).toBe(false);
    startDenShop(store);
    expect(store.getState().shop).not.toBeNull();
  });
});

// ---- 로그인 저장(ADR-014) ----

const USER = { id: "u1", email: "employee@example.com" };
const SERVER_AT = "2026-10-28T06:00:00.000Z";

/** 가짜 원격 저장소. 호출을 기록하고, save는 resolve를 직접 부를 때까지 기다리게 할 수 있다. */
function fakeRemote(row: { data: unknown; updatedAt: string } | null = null) {
  const calls = { load: 0, save: [] as unknown[], remove: 0 };
  let n = 0;
  let hold = false;
  let failSave = false;
  const held: (() => void)[] = [];
  const remote: ShopRemote = {
    load: async () => {
      calls.load++;
      return row;
    },
    save: (_userId, data) => {
      calls.save.push(structuredClone(data));
      if (failSave) return Promise.reject(new Error("network"));
      const res = { updatedAt: `2026-10-28T07:00:0${n++}.000Z` };
      if (!hold) return Promise.resolve(res);
      return new Promise((resolve) => held.push(() => resolve(res)));
    },
    remove: async () => {
      calls.remove++;
    },
  };
  return {
    remote,
    calls,
    hold: (v: boolean) => (hold = v),
    failSave: (v: boolean) => (failSave = v),
    release: () => held.splice(0).forEach((r) => r()),
  };
}

function synced(remote: ShopRemote, storage: Storage = new MemoryStorage()) {
  return createAppStore(() => storage, () => CONFIRMED_AT, remote);
}

/** 서버 문서: 매장 "서버 매장"(직원 1명) + 기간 없음. */
function serverDoc() {
  const s = fresh();
  startDenShop(s);
  s.getState().setShopName("서버 병동");
  s.getState().addEmployees([rows[0]]);
  const { shop, periods, view, inputVersion } = s.getState();
  return { version: STORAGE_VERSION, state: { shop, periods, view, inputVersion } };
}

const savedState = (doc: unknown) => (doc as { version: number; state: Record<string, unknown> }).state;

describe("로그인 분기", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("초기 sync는 guest, auth와 loginPrompt는 null", () => {
    const s = synced(fakeRemote().remote).getState();
    expect(s.auth).toBeNull();
    expect(s.sync).toEqual({ status: "guest", savedAt: null });
    expect(s.loginPrompt).toBeNull();
  });

  it("서버에 병동이 있고 게스트 입력도 있으면 서버 문서로 바꾸고 안내한다", async () => {
    const f = fakeRemote({ data: serverDoc(), updatedAt: SERVER_AT });
    const store = synced(f.remote);
    addInput(store);
    await store.getState().signedIn(USER);
    const s = store.getState();
    expect(s.shop!.name).toBe("서버 병동");
    expect(s.periods).toEqual([]);
    expect(s.auth).toEqual({ userId: "u1", email: "employee@example.com" });
    expect(s.sync).toEqual({ status: "saved", savedAt: SERVER_AT });
    expect(s.loginPrompt).toEqual({ kind: "server-replaced-guest" });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(f.calls.save).toHaveLength(0);
  });

  it("서버에 병동이 있고 게스트 입력이 없으면 안내 없이 서버 문서로 바꾼다", async () => {
    const f = fakeRemote({ data: serverDoc(), updatedAt: SERVER_AT });
    const store = synced(f.remote);
    const v = store.getState().inputVersion;
    await store.getState().signedIn(USER);
    const s = store.getState();
    expect(s.shop!.name).toBe("서버 병동");
    expect(s.loginPrompt).toBeNull();
    expect(s.inputVersion).toBeGreaterThan(Math.max(v, serverDoc().state.inputVersion));
    expect(f.calls.save).toHaveLength(0);
  });

  it("서버에 없고 게스트 입력이 있으면 그대로 올린다", async () => {
    const f = fakeRemote();
    const { store } = withPeriodSynced(f.remote);
    await store.getState().signedIn(USER);
    expect(store.getState().loginPrompt).toBeNull();
    expect(f.calls.save).toHaveLength(1);
    const state = savedState(f.calls.save[0]);
    expect((state.shop as { employees: unknown[] }).employees).toHaveLength(2);
    expect(state.periods).toHaveLength(1);
    expect(store.getState().sync).toEqual({ status: "saved", savedAt: "2026-10-28T07:00:00.000Z" });
  });

  it("둘 다 없으면 빈 병동을 올리고 처음 설정 ①로 간다", async () => {
    const f = fakeRemote();
    const store = synced(f.remote);
    await store.getState().signedIn(USER);
    const s = store.getState();
    expect(s.shop).toMatchObject({ name: "", employees: [] });
    expect(s.view).toEqual({ screen: "setup", step: 1 });
    expect(f.calls.save).toHaveLength(1);
  });

  it("서버 문서가 손상됐으면 빈 상태 + resetNotice, 바꾸기 전에는 저장하지 않는다", async () => {
    const f = fakeRemote({ data: { version: 3, state: { step: 1 } }, updatedAt: SERVER_AT });
    const store = synced(f.remote);
    await store.getState().signedIn(USER);
    expect(store.getState().shop).toBeNull();
    expect(store.getState().resetNotice).toBe(true);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(f.calls.save).toHaveLength(0);

    startDenShop(store);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(f.calls.save).toHaveLength(1);
  });

  it("서버 문서 버전이 지금과 다르면 변환하지 않고 빈 상태로 시작한다", async () => {
    const { state } = serverDoc();
    const f = fakeRemote({ data: { version: STORAGE_VERSION - 1, state }, updatedAt: SERVER_AT });
    const store = synced(f.remote);
    await store.getState().signedIn(USER);
    expect(store.getState().shop).toBeNull();
    expect(store.getState().resetNotice).toBe(true);
  });

  it("모양이 손상된 서버 문서도 빈 상태로 시작한다", async () => {
    const f = fakeRemote({ data: { version: STORAGE_VERSION, state: { shop: { employees: "x" } } }, updatedAt: SERVER_AT });
    const store = synced(f.remote);
    await store.getState().signedIn(USER);
    expect(store.getState().shop).toBeNull();
    expect(store.getState().resetNotice).toBe(true);
    expect(f.calls.save).toHaveLength(0);
  });
});

/** withPeriod와 같지만 remote를 주입한다. */
function withPeriodSynced(remote: ShopRemote, storage: Storage = new MemoryStorage()) {
  const store = synced(remote, storage);
  startDenShop(store);
  store.getState().addEmployees(rows);
  const id = store.getState().createPeriod(TODAY)!;
  return { store, id };
}

describe("게스트 확정과 다음 기간", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("게스트가 확정하면 버전 1개를 남기고 remote를 부르지 않는다", async () => {
    const f = fakeRemote();
    const { store, id } = withPeriodSynced(f.remote);
    store.getState().setResult(id, result({ e01: fill(30, "D"), e02: fill(30, "O") }), []);
    store.getState().confirm(id);
    const p = store.getState().periods.find((x) => x.id === id)!;
    expect(p.status).toBe("confirmed");
    expect(p.versions).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(f.calls).toMatchObject({ load: 0, save: [] });
    expect(store.getState().sync.status).toBe("guest");
  });

  it("게스트가 확정 기간 뒤에 다음 기간을 만들고 이월을 계산한다", async () => {
    const f = fakeRemote();
    const { store, id } = withPeriodSynced(f.remote);
    const e01 = fill(30, "DDEENNO");
    store.getState().setResult(id, result({ e01, e02: fill(30, "O") }), []);
    store.getState().confirm(id);
    const nextId = store.getState().createPeriod(TODAY)!;
    const next = store.getState().periods.find((p) => p.id === nextId)!;
    expect([next.start_date, next.status]).toEqual(["2026-12-01", "draft"]);
    const req = toScheduleRequest(store.getState().shop!, next, store.getState().periods, TODAY);
    expect(req.carry_over).toEqual([
      { employee_id: "e01", shifts: e01.slice(-7) },
      { employee_id: "e02", shifts: fill(7, "O") },
    ]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(f.calls).toMatchObject({ load: 0, save: [] });
  });
});

describe("옛 pendingAfterLogin 필드", () => {
  it("localStorage에 남아 있어도 resetNotice 없이 불러오고 필드는 버린다", () => {
    const storage = new MemoryStorage();
    const a = fresh(storage);
    addInput(a);
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    saved.state.pendingAfterLogin = { action: "confirm", periodId: a.getState().periods[0].id };
    storage.setItem(STORAGE_KEY, JSON.stringify(saved));

    const b = fresh(storage).getState();
    expect(b.resetNotice).toBe(false);
    expect(b.shop).toEqual(a.getState().shop);
    expect(b.periods).toEqual(a.getState().periods);
    expect(b).not.toHaveProperty("pendingAfterLogin");
  });

  it("서버 문서에 남아 있어도 resetNotice 없이 불러오고 필드는 버린다", async () => {
    const data = serverDoc();
    const f = fakeRemote({ data: { ...data, state: { ...data.state, pendingAfterLogin: { action: "create-period" } } }, updatedAt: SERVER_AT });
    const store = synced(f.remote);
    await store.getState().signedIn(USER);
    const s = store.getState();
    expect(s.resetNotice).toBe(false);
    expect(s.shop!.name).toBe("서버 병동");
    expect(s).not.toHaveProperty("pendingAfterLogin");
    expect(s.periods).toEqual([]);
  });
});

describe("자동 저장", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function signedInStore() {
    const f = fakeRemote();
    const { store, id } = withPeriodSynced(f.remote);
    await store.getState().signedIn(USER);
    f.calls.save.length = 0;
    return { f, store, id };
  }

  it("바뀌면 디바운스 뒤 한 번 저장하고 saved + savedAt", async () => {
    const { f, store } = await signedInStore();
    store.getState().setShopName("가");
    store.getState().setShopName("가나");
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(f.calls.save).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls.save).toHaveLength(1);
    expect((savedState(f.calls.save[0]).shop as { name: string }).name).toBe("가나");
    expect(store.getState().sync).toEqual({ status: "saved", savedAt: "2026-10-28T07:00:01.000Z" });
  });

  it("화면 이동만으로는 저장하지 않는다", async () => {
    const { f, store } = await signedInStore();
    store.getState().go({ screen: "home" });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(f.calls.save).toHaveLength(0);
  });

  it("저장 중이면 saving, 그 사이 바뀌면 끝난 뒤 한 번 더 저장한다", async () => {
    const { f, store } = await signedInStore();
    f.hold(true);
    store.getState().setShopName("가");
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.getState().sync.status).toBe("saving");
    store.getState().setShopName("가나");
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(f.calls.save).toHaveLength(1);
    f.hold(false);
    f.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.save).toHaveLength(2);
    expect((savedState(f.calls.save[1]).shop as { name: string }).name).toBe("가나");
    expect(store.getState().sync.status).toBe("saved");
  });

  it("실패하면 error, localStorage에는 남고, retrySave로 즉시 다시 저장한다", async () => {
    const storage = new MemoryStorage();
    const f = fakeRemote();
    const { store } = withPeriodSynced(f.remote, storage);
    await store.getState().signedIn(USER);
    f.failSave(true);
    store.getState().setShopName("가");
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.getState().sync.status).toBe("error");
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).state.shop.name).toBe("가");

    f.failSave(false);
    const before = f.calls.save.length;
    await store.getState().retrySave();
    expect(f.calls.save).toHaveLength(before + 1);
    expect(store.getState().sync.status).toBe("saved");
  });

  it("게스트 모드에서는 remote를 부르지 않는다", async () => {
    const f = fakeRemote();
    const { store, id } = withPeriodSynced(f.remote);
    store.getState().setShopName("가");
    store.getState().setResult(id, result({ e01: ["D"], e02: ["E"] }), []);
    store.getState().confirm(id);
    await store.getState().retrySave();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    expect(f.calls).toEqual({ load: 0, save: [], remove: 0 });
    expect(store.getState().sync.status).toBe("guest");
  });
});

describe("로그아웃과 데이터 삭제", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("signedOut은 상태를 초기화하고 localStorage 키를 지우며 서버는 건드리지 않는다", async () => {
    const storage = new MemoryStorage();
    const f = fakeRemote();
    const { store } = withPeriodSynced(f.remote, storage);
    await store.getState().signedIn(USER);
    store.getState().setShopName("가");
    store.getState().signedOut();
    const s = store.getState();
    expect(s.shop).toBeNull();
    expect(s.periods).toEqual([]);
    expect(s.auth).toBeNull();
    expect(s.sync.status).toBe("guest");
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(f.calls.save).toHaveLength(1);
    expect(f.calls.remove).toBe(0);
  });

  it("deleteShopData는 서버 문서를 지우고 빈 병동 + 처음 설정 ①, 로그인은 유지한다", async () => {
    const f = fakeRemote();
    const { store } = withPeriodSynced(f.remote);
    await store.getState().signedIn(USER);
    await store.getState().deleteShopData();
    const s = store.getState();
    expect(f.calls.remove).toBe(1);
    expect(s.shop).toMatchObject({ name: "", employees: [] });
    expect(s.periods).toEqual([]);
    expect(s.view).toEqual({ screen: "setup", step: 1 });
    expect(s.auth).toEqual({ userId: "u1", email: "employee@example.com" });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(f.calls.save).toHaveLength(1);
  });

  it("deleteShopData가 실패하면 throw하고 상태를 그대로 둔다", async () => {
    const f = fakeRemote();
    f.remote.remove = () => Promise.reject(new Error("network"));
    const { store } = withPeriodSynced(f.remote);
    await store.getState().signedIn(USER);
    await expect(store.getState().deleteShopData()).rejects.toThrow("network");
    expect(store.getState().periods).toHaveLength(1);
  });
});

describe("병동 준비와 처음 설정 단계", () => {
  const COVERAGE = ["D", "E", "N"] as const;
  function fullCoverage(store: ReturnType<typeof createAppStore>) {
    for (const shift of COVERAGE) {
      store.getState().setCoverage(shift, "weekday", 1, 2);
      store.getState().setCoverage(shift, "weekend", 1, 2);
    }
  }

  it("명단이 없으면 ①, 병동 소개에서 [다음]을 누르지 않았으면 ②, 그 밖은 ③. 필요 인원은 필수가 아니다", () => {
    const store = fresh();
    startDenShop(store);
    const shop = () => store.getState().shop!;
    expect([setupStep(shop()), hasCoverage(shop()), isShopReady(shop())]).toEqual([1, false, false]);
    store.getState().addEmployees(rows);
    expect([setupStep(shop()), isShopReady(shop())]).toEqual([2, true]);
    fullCoverage(store);
    expect([setupStep(shop()), hasCoverage(shop())]).toEqual([2, true]);
    const v = store.getState().inputVersion;
    store.getState().markIntroSeen();
    expect([setupStep(shop()), isShopReady(shop())]).toEqual([3, true]);
    expect(store.getState().inputVersion).toBe(v);
    // 모두 근무표에서 빼면 명단이 없는 것으로 본다
    store.getState().setEmployeeActive("e01", false);
    store.getState().setEmployeeActive("e02", false);
    expect([setupStep(shop()), isShopReady(shop())]).toEqual([1, false]);
  });
});

describe("viewForPeriod", () => {
  it("확정 → 확정 근무표, 결과 있음 → 작성 ②, 그 밖 → 작성 ①", () => {
    const { store, id, period } = withPeriod();
    expect(viewForPeriod(period())).toEqual({ screen: "period", periodId: id, step: 1 });
    store.getState().setResult(id, result({ e01: ["D"], e02: ["O"] }), []);
    expect(viewForPeriod(period())).toEqual({ screen: "period", periodId: id, step: 2 });
    store.getState().confirm(id);
    expect(viewForPeriod(period())).toEqual({ screen: "confirmed", periodId: id });
  });

  it("createPeriod는 결과가 있는 초안을 작성 ②로 연다", () => {
    const { store, id } = withPeriod();
    store.getState().setResult(id, result({ e01: ["D"], e02: ["O"] }), []);
    store.getState().go({ screen: "home" });
    store.getState().createPeriod(TODAY);
    expect(store.getState().view).toEqual({ screen: "period", periodId: id, step: 2 });
  });

  it("currentPeriod는 확정 근무표 화면의 기간도 고른다", () => {
    const { store, id } = withConfirmed();
    store.getState().createPeriod(TODAY);
    store.getState().go({ screen: "confirmed", periodId: id });
    expect(currentPeriod(store.getState())?.id).toBe(id);
  });
});

describe("prepareNeedsReview", () => {
  it("첫 근무표와 변동이 없는 근무표는 접고, 명단이 바뀌거나 이어지는 근무가 바뀌면 펼친다", () => {
    const { store, id } = withConfirmed(fill(30, "D"), fill(30, "O"));
    const nextId = store.getState().createPeriod(TODAY)!;
    const review = () => prepareNeedsReview(store.getState().shop!, store.getState().periods, nextId);
    expect(prepareNeedsReview(store.getState().shop!, store.getState().periods, id)).toBe(false);
    expect(review()).toBe(false);

    store.getState().addEmployees([{ name: "김철수" }]);
    expect(review()).toBe(true);
    store.getState().setEmployeeActive("e03", false);
    expect(review()).toBe(false); // 추가했다가 뺀 사람은 변동이 아니다

    const next = () => store.getState().periods.find((p) => p.id === nextId)!;
    const req = toScheduleRequest(store.getState().shop!, next(), store.getState().periods, TODAY);
    store.getState().setResult(nextId, result({ e01: fill(31, "D"), e02: fill(31, "O") }), req.carry_over ?? []);
    const late = fill(30, "D");
    late[29] = "N";
    store.getState().setResult(id, result({ e01: late, e02: fill(30, "O") }), []);
    store.getState().confirm(id);
    expect(review()).toBe(true);
  });
});

describe("옛 화면 상태 불러오기", () => {
  /** 저장된 문서의 view만 바꿔 localStorage에서 다시 불러온다. */
  function reload(store: ReturnType<typeof createAppStore>, view: unknown) {
    const storage = new MemoryStorage();
    const { shop, periods, inputVersion } = store.getState();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state: { shop, periods, view, inputVersion } }));
    return fresh(storage).getState();
  }

  it("작성 ③은 ②로, 확정된 기간은 확정 근무표로 바꾼다", () => {
    const { store, id } = withConfirmed();
    const nextId = store.getState().createPeriod(TODAY)!;
    expect(reload(store, { screen: "period", periodId: nextId, step: 3 }).view).toEqual({ screen: "period", periodId: nextId, step: 2 });
    expect(reload(store, { screen: "period", periodId: nextId, step: 2 }).view).toEqual({ screen: "period", periodId: nextId, step: 2 });
    expect(reload(store, { screen: "period", periodId: id, step: 3 }).view).toEqual({ screen: "confirmed", periodId: id });
    expect(reload(store, { screen: "period", periodId: id, step: 1 }).view).toEqual({ screen: "confirmed", periodId: id });
    expect(reload(store, { screen: "settings", tab: "rules" }).view).toEqual({ screen: "settings", tab: "rules" });
    expect(reload(store, { screen: "home" }).view).toEqual({ screen: "home" });
    expect(reload(store, { screen: "home" }).resetNotice).toBe(false);
  });

  it("근무표가 없는 병동은 설정·홈 화면을 처음 설정의 못 끝낸 첫 단계로 바꾼다", () => {
    const store = fresh();
    startDenShop(store);
    expect(reload(store, { screen: "settings", tab: "roster" }).view).toEqual({ screen: "setup", step: 1 });
    store.getState().addEmployees(rows);
    expect(reload(store, { screen: "settings", tab: "rules" }).view).toEqual({ screen: "setup", step: 2 });
    expect(reload(store, { screen: "home" }).view).toEqual({ screen: "setup", step: 2 });
    expect(reload(store, { screen: "setup", step: 1 }).view).toEqual({ screen: "setup", step: 2 });
  });

  it("근무표가 있는 병동의 처음 설정, 없는 기간을 가리키는 화면은 홈으로 바꾼다", () => {
    const { store } = withPeriod();
    expect(reload(store, { screen: "setup", step: 3 }).view).toEqual({ screen: "home" });
    expect(reload(store, { screen: "period", periodId: "p-없음", step: 2 }).view).toEqual({ screen: "home" });
    expect(reload(store, { screen: "confirmed", periodId: "p-없음" }).view).toEqual({ screen: "home" });
  });

  it("서버 문서의 옛 화면 상태도 바꾼다", async () => {
    const { store, id } = withConfirmed();
    const { shop, periods, inputVersion } = store.getState();
    const f = fakeRemote({
      data: { version: STORAGE_VERSION, state: { shop, periods, view: { screen: "period", periodId: id, step: 3 }, inputVersion } },
      updatedAt: SERVER_AT,
    });
    const s = synced(f.remote);
    await s.getState().signedIn(USER);
    expect(s.getState().view).toEqual({ screen: "confirmed", periodId: id });
    expect(s.getState().resetNotice).toBe(false);
  });
});

describe("근무 형태", () => {
  const codes = (store: ReturnType<typeof createAppStore>) =>
    store.getState().shop!.config.shifts.map((s) => `${s.code}${s.active === false ? "-" : ""}`);

  it("addShift는 O 앞에 더하고 중복·8개 초과는 무시한다, setShift는 O를 바꾸지 않는다", () => {
    const store = fresh();
    startDenShop(store);
    const v = store.getState().inputVersion;
    store.getState().addShift({ code: "M", name: "미드", hours: 8, start: "11:00" });
    store.getState().addShift({ code: "M", name: "다른 미드", hours: 4 });
    expect(codes(store)).toEqual(["D", "E", "N", "M", "O"]);
    expect(store.getState().inputVersion).toBe(v + 1);
    for (const code of ["S", "X", "Y", "Z"]) store.getState().addShift({ code, name: code, hours: 4 });
    expect(codes(store)).toHaveLength(8);
    expect(codes(store)).not.toContain("Z");
    store.getState().setShift("M", { hours: 9, name: "미드2" });
    store.getState().setShift("O", { hours: 8 });
    const shifts = store.getState().shop!.config.shifts;
    expect(shifts.find((s) => s.code === "M")).toMatchObject({ name: "미드2", hours: 9, start: "11:00" });
    expect(shifts.find((s) => s.code === "O")!.hours).toBe(0);
  });

  it("setShiftActive: 끄면 그 코드를 세는 복합 코드도 끄고, 근무조가 꺼진 복합 코드는 켜지 않는다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addShift({ code: "DE", name: "더블", hours: 16, parts: ["D", "E"] });
    store.getState().setShiftActive("E", false);
    expect(codes(store)).toEqual(["D", "E-", "N", "DE-", "O"]);
    store.getState().setShiftActive("DE", true);
    expect(codes(store)).toEqual(["D", "E-", "N", "DE-", "O"]);
    store.getState().setShiftActive("E", true);
    store.getState().setShiftActive("DE", true);
    store.getState().setShiftActive("O", false);
    expect(codes(store)).toEqual(["D", "E", "N", "DE", "O"]);
  });

  it("removeShift: 쓰인 적 없으면 지우고, 규칙·결과에 쓰였으면 끈다", () => {
    const { store, id } = withPeriod();
    store.getState().addShift({ code: "M", name: "미드", hours: 8 });
    store.getState().addShift({ code: "S", name: "짧은", hours: 4 });
    store.getState().addPendingRules([countCard("m", { shifts: { in: ["M"] }, per: "day", min: 1 })]);
    store.getState().removeShift("S");
    store.getState().removeShift("M");
    expect(codes(store)).toEqual(["D", "E", "N", "M-", "O"]);
    const { shop, periods } = store.getState();
    expect(isShiftUsed("M", shop!, periods)).toBe(true);
    expect(isShiftUsed("N", shop!, periods)).toBe(false); // 어떤 규칙도 쓰지 않는다
    store.getState().addShift({ code: "S", name: "짧은", hours: 4 });
    store.getState().setResult(id, result({ e01: ["S"], e02: ["O"] }), []);
    store.getState().removeShift("S");
    expect(codes(store)).toContain("S-");
  });

  it("dismissUnconverted는 옮기지 못한 옛 규칙 원문 하나를 지우고 입력 버전은 그대로 둔다", () => {
    const store = fresh();
    startDenShop(store);
    store.setState((s) => ({ shop: { ...s.shop!, unconverted: [{ source_text: "가" }, { source_text: "나" }] } }));
    const v = store.getState().inputVersion;
    store.getState().dismissUnconverted(0);
    expect(store.getState().shop!.unconverted).toEqual([{ source_text: "나" }]);
    expect(store.getState().inputVersion).toBe(v);
  });

  it("필요 인원 행은 활성 기본 코드를 따른다(복합·휴무 제외)", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addEmployees(rows);
    for (const code of ["D", "E", "N"]) {
      store.getState().setCoverage(code, "weekday", 1, 1);
      store.getState().setCoverage(code, "weekend", 1, 1);
    }
    const shop = () => store.getState().shop!;
    expect(hasCoverage(shop())).toBe(true);
    store.getState().addShift({ code: "DE", name: "더블", hours: 16, parts: ["D", "E"] });
    expect(hasCoverage(shop())).toBe(true);
    store.getState().addShift({ code: "M", name: "미드", hours: 8 });
    expect(hasCoverage(shop())).toBe(false);
    store.getState().setCoverage("M", "weekday", 1, 1);
    store.getState().setCoverage("M", "weekend", 0, 0);
    expect(hasCoverage(shop())).toBe(true);
    store.getState().setShiftActive("M", false);
    store.getState().removeRule("cov-weekend-M");
    expect(hasCoverage(shop())).toBe(true);
  });
  it("꺼진 근무 코드의 필요 인원 규칙은 요청에서 꺼서 보낸다(규칙 원본은 그대로)", () => {
    const { store, period } = withPeriod();
    store.getState().addShift({ code: "M", name: "미드", hours: 8 });
    store.getState().setCoverage("M", "weekday", 1, 1);
    store.getState().setCoverage("D", "weekday", 2, 2);
    store.getState().setShiftActive("M", false);
    const req = toScheduleRequest(store.getState().shop!, period(), store.getState().periods, TODAY);
    const byId = (id: string) => req.constraints!.find((c) => c.id === id)!;
    expect(byId("cov-weekday-M").enabled).toBe(false);
    expect(byId("cov-weekday-D").enabled).not.toBe(false);
    expect(store.getState().shop!.rules.find((c) => c.id === "cov-weekday-M")!.enabled).not.toBe(false);
  });
});

describe("태그", () => {
  it("addTag는 공백을 지우고 중복·빈 값·10자 초과·5개 초과를 무시한다, removeTag는 지운다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addEmployees([{ name: "이영희", tags: ["책임"] }]);
    const tags = () => store.getState().shop!.employees[0].tags;
    expect(tags()).toEqual(["책임"]);
    const v = store.getState().inputVersion;
    store.getState().addTag("e01", "  신규 ");
    store.getState().addTag("e01", "책임");
    store.getState().addTag("e01", " ");
    store.getState().addTag("e01", "열한글자가넘는긴태그입니다");
    expect(tags()).toEqual(["책임", "신규"]);
    expect(store.getState().inputVersion).toBe(v + 1);
    for (const t of ["a", "b", "c", "d"]) store.getState().addTag("e01", t);
    expect(tags()).toEqual(["책임", "신규", "a", "b", "c"]);
    store.getState().removeTag("e01", "신규");
    store.getState().removeTag("e01", "없음");
    expect(tags()).toEqual(["책임", "a", "b", "c"]);
    store.getState().updateEmployee("e01", { name: "이영희A" });
    expect(tags()).toEqual(["책임", "a", "b", "c"]);
  });
});

describe("설정 변경 카드", () => {
  const double = { action: "add" as const, shift: { code: "DE", name: "더블", hours: 16, parts: ["D", "E"] } };
  const deLimit = countCard("de2", { shifts: { in: ["DE"] }, per: "person", max: 2 }, { source_text: "더블 월 2회" });
  const other = maxWork("w5", 5);

  function withConfigCard() {
    const store = fresh();
    startDenShop(store);
    store.getState().addPendingRules([deLimit, other], [double]);
    return store;
  }

  it("config_changes는 대기 설정 카드가 되고, 새 코드를 쓰는 규칙 카드가 딸린다", () => {
    const store = withConfigCard();
    const w = store.getState().shop!;
    expect(w.pendingConfig).toEqual([{ id: "cfg-DE", source_text: "더블 월 2회", change: double, ruleIds: ["de2"] }]);
    expect(w.pendingRules.map((c) => c.id)).toEqual(["de2", "w5"]);
    expect(w.cardOrder).toEqual(["cfg-DE", "de2", "w5"]);
    store.getState().addPendingRules([], [double]);
    expect(store.getState().shop!.pendingConfig.map((c) => c.id)).toEqual(["cfg-DE", "cfg-DE-2"]);
  });

  it("딸린 규칙 카드를 적용하면 설정 카드도 함께 적용한다", () => {
    const store = withConfigCard();
    const v = store.getState().inputVersion;
    store.getState().applyRule("de2");
    const w = store.getState().shop!;
    expect(w.config.shifts.map((s) => s.code)).toEqual(["D", "E", "N", "DE", "O"]);
    expect(w.config.shifts.find((s) => s.code === "DE")).toMatchObject({ parts: ["D", "E"], active: true });
    expect(w.pendingConfig).toEqual([]);
    expect(ruleIds(w.rules)).toEqual(["de2"]);
    expect(store.getState().inputVersion).toBe(v + 1);
  });

  it("설정 카드만 적용하면 근무 형태만 바뀌고, 설정 카드를 지우면 딸린 카드도 지운다", () => {
    const store = withConfigCard();
    store.getState().applyRule("cfg-DE");
    expect(store.getState().shop!.config.shifts.map((s) => s.code)).toContain("DE");
    expect(store.getState().shop!.pendingRules.map((c) => c.id)).toEqual(["de2", "w5"]);

    const other = withConfigCard();
    const v = other.getState().inputVersion;
    other.getState().removeRule("cfg-DE");
    const w = other.getState().shop!;
    expect(w.pendingConfig).toEqual([]);
    expect(w.pendingRules.map((c) => c.id)).toEqual(["w5"]);
    expect(w.config).toEqual(DEN_CONFIG);
    expect(other.getState().inputVersion).toBe(v);
  });

  it("update 설정 카드는 같은 코드를 바꾸고 딸린 카드가 없다", () => {
    const store = fresh();
    startDenShop(store);
    store.getState().addPendingRules([], [{ action: "update", shift: { code: "E", name: "이브닝", hours: 9 } }]);
    expect(store.getState().shop!.pendingConfig[0].ruleIds).toEqual([]);
    store.getState().applyRule("cfg-E");
    expect(store.getState().shop!.config.shifts.find((s) => s.code === "E")!.hours).toBe(9);
  });
});

describe("시작일", () => {
  it("첫 근무표는 고른 시작일에서 시작하고, 달력 월인데 29~31일이면 만들지 않는다", () => {
    const store = fresh();
    startDenShop(store);
    expect(store.getState().createPeriod(TODAY, "2026-11-29")).toBeNull();
    expect(store.getState().periods).toEqual([]);
    store.getState().createPeriod(TODAY, "2026-11-15");
    expect(store.getState().periods.map((p) => [p.start_date, p.length])).toEqual([["2026-11-15", 30]]);

    const weekly = fresh();
    startDenShop(weekly);
    weekly.getState().setUnit("2w");
    weekly.getState().createPeriod(TODAY, "2026-11-04");
    expect(weekly.getState().periods.map((p) => [p.start_date, p.length])).toEqual([["2026-11-04", 14]]);
  });

  it("다음 근무표는 시작일 인자와 무관하게 직전 다음 날부터", () => {
    const { store } = withConfirmed();
    store.getState().createPeriod(TODAY, "2026-12-10");
    expect(store.getState().periods.map((p) => p.start_date)).toEqual(["2026-11-01", "2026-12-01"]);
  });

  it("postponeStart: 뒤로만 미루고 공휴일은 같은 날짜로 옮기며 결과를 지운다", () => {
    const { store } = withConfirmed();
    const nextId = store.getState().createPeriod(TODAY)!;
    const next = () => store.getState().periods.find((p) => p.id === nextId)!;
    store.getState().toggleHoliday(nextId, 25); // 12/25
    store.getState().setResult(nextId, result({ e01: fill(31, "D") }), []);
    expect(store.getState().postponeStart(nextId, "2026-11-30")).toBe(false);
    expect(store.getState().postponeStart(nextId, "2026-12-29")).toBe(false); // 달력 월은 1~28일
    const v = store.getState().inputVersion;
    expect(store.getState().postponeStart(nextId, "2026-12-08")).toBe(true);
    expect(next()).toMatchObject({ start_date: "2026-12-08", length: 31, holidays: [18], result: null, resultVersion: null });
    expect(store.getState().inputVersion).toBe(v + 1);
    // 이어지지 않으므로 지난 근무가 자동으로 채워지지 않는다
    expect(toScheduleRequest(store.getState().shop!, next(), store.getState().periods, TODAY).carry_over).toEqual([]);
    // 확정한 근무표는 바꾸지 않는다
    expect(store.getState().postponeStart(store.getState().periods[0].id, "2026-11-02")).toBe(false);
  });

  it("첫 근무표의 시작일은 앞으로도 바꿀 수 있다", () => {
    const { store, id, period } = withPeriod();
    expect(store.getState().postponeStart(id, "2026-10-20")).toBe(true);
    expect([period().start_date, period().length]).toEqual(["2026-10-20", 31]);
  });
});
