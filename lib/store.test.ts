import { describe, expect, it } from "vitest";

import sample from "./samples/ward-15.json";
import { createAppStore, findReplaced, STORAGE_KEY } from "./store";
import type { ConstraintSpec, Nurse, ScheduleResult } from "./types.gen";

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

const NOW = new Date(2026, 9, 26); // 2026-10-26
const nurses: Nurse[] = [
  { id: "n01", name: "이영희", years: 12, night_only: false },
  { id: "n02", name: "박민수", years: 9, night_only: false },
];

function card(over: Partial<ConstraintSpec> & Pick<ConstraintSpec, "id" | "type" | "params">) {
  return { scope: "ward", hardness: "hard", weight: 1, source_text: "원문", enabled: true, ...over } as ConstraintSpec;
}

function fresh(storage: Storage = new MemoryStorage()) {
  return createAppStore(() => storage, NOW);
}

describe("초기 상태", () => {
  it("대상 월은 다음 달이고 1단계에서 시작한다", () => {
    const s = fresh().getState();
    expect(s.period).toEqual({ year: 2026, month: 11 });
    expect(s.step).toBe(1);
    expect(s.inputVersion).toBe(0);
    expect(s.storageAvailable).toBe(true);
    expect(s.resetNotice).toBe(false);
    expect(createAppStore(() => new MemoryStorage(), new Date(2026, 11, 5)).getState().period).toEqual({
      year: 2027,
      month: 1,
    });
  });
});

describe("inputVersion", () => {
  it("병동·제약·이월을 바꾸는 액션마다 1씩 증가한다", () => {
    const store = fresh();
    const v = () => store.getState().inputVersion;
    store.getState().setNurses(nurses);
    expect(v()).toBe(1);
    store.getState().setPeriod({ year: 2026, month: 12 });
    expect(v()).toBe(2);
    store.getState().toggleHoliday(25);
    expect(v()).toBe(3);
    store.getState().setCoverage("D", "weekday", 3, 4);
    expect(v()).toBe(4);
    store.getState().setCarryOver([{ nurse_id: "n01", shifts: ["N"] }]);
    expect(v()).toBe(5);
    store.getState().addPendingCards([card({ id: "c1", type: "night_fairness", params: {} })]);
    expect(v()).toBe(5); // 제안 대기는 입력이 아니다
    store.getState().applyCard("c1");
    expect(v()).toBe(6);
    store.getState().loadSample();
    expect(v()).toBe(7);
    store.getState().setStep(2);
    expect(v()).toBe(7);
  });

  it("대상 월을 바꾸면 공휴일을 비운다", () => {
    const store = fresh();
    store.getState().toggleHoliday(3);
    store.getState().toggleHoliday(9);
    store.getState().toggleHoliday(3);
    expect(store.getState().holidays).toEqual([9]);
    store.getState().setPeriod({ year: 2026, month: 12 });
    expect(store.getState().holidays).toEqual([]);
  });
});

describe("applyCard", () => {
  it("대기 카드를 적용 목록으로 옮긴다", () => {
    const store = fresh();
    store.getState().addPendingCards([card({ id: "c1", type: "max_consecutive_work", params: { days: 5 } })]);
    store.getState().applyCard("c1");
    expect(store.getState().pendingCards).toEqual([]);
    expect(store.getState().constraints.map((c) => c.id)).toEqual(["c1"]);
  });

  it("같은 type·scope·대상이면 교체하고, 대상이 다르면 추가한다", () => {
    const store = fresh();
    const { addPendingCards, applyCard } = store.getState();
    addPendingCards([
      card({ id: "a", type: "leave", scope: "month", params: { nurse_id: "n01", days: [3] } }),
      card({ id: "b", type: "leave", scope: "month", params: { nurse_id: "n02", days: [4] } }),
      card({ id: "c", type: "leave", scope: "month", params: { nurse_id: "n01", days: [5, 6] } }),
      card({ id: "d", type: "max_consecutive_work", params: { days: 5 } }),
      card({ id: "e", type: "max_consecutive_work", params: { days: 6 } }),
      card({ id: "f", type: "skill_mix", params: { shift: "N", min_years: 3, min_count: 1 } }),
      card({ id: "g", type: "skill_mix", params: { shift: "D", min_years: 3, min_count: 1 } }),
      card({ id: "h", type: "forbidden_sequence", params: { first: "N", second: "D" } }),
      card({ id: "i", type: "forbidden_sequence", params: { first: "E", second: "D" } }),
    ]);
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) applyCard(id);
    expect(store.getState().constraints.map((c) => c.id).sort()).toEqual(["a", "b", "c", "e", "f", "g", "h", "i"]);
  });

  it("같은 간호사의 휴가는 교체하지 않고 날짜별 요청을 모두 남긴다", () => {
    const store = fresh();
    store.getState().addPendingCards([
      card({ id: "l1", type: "leave", scope: "month", params: { nurse_id: "n01", days: [15, 16, 17] } }),
      card({ id: "l2", type: "leave", scope: "month", params: { nurse_id: "n01", days: [20] } }),
    ]);
    store.getState().applyCard("l1");
    store.getState().applyCard("l2");
    expect(store.getState().constraints.map((c) => c.params)).toEqual([
      { nurse_id: "n01", days: [15, 16, 17] },
      { nurse_id: "n01", days: [20] },
    ]);
  });

  it("고정 배정은 같은 간호사·같은 날이면 교체하고, 날이 다르면 추가한다", () => {
    const store = fresh();
    store.getState().addPendingCards([
      card({ id: "f5", type: "fixed_assignment", scope: "month", params: { nurse_id: "n01", day: 5, shift: "D" } }),
      card({ id: "f6", type: "fixed_assignment", scope: "month", params: { nurse_id: "n01", day: 6, shift: "E" } }),
      card({ id: "f5b", type: "fixed_assignment", scope: "month", params: { nurse_id: "n01", day: 5, shift: "N" } }),
    ]);
    for (const id of ["f5", "f6", "f5b"]) store.getState().applyCard(id);
    expect(store.getState().constraints.map((c) => c.id)).toEqual(["f5b", "f6"]);
  });

  it("scope가 다르면 교체하지 않는다", () => {
    const store = fresh();
    store.getState().addPendingCards([
      card({ id: "w", type: "max_consecutive_work", params: { days: 5 } }),
      card({ id: "m", type: "max_consecutive_work", scope: "month", params: { days: 4 } }),
    ]);
    store.getState().applyCard("w");
    store.getState().applyCard("m");
    expect(store.getState().constraints.map((c) => c.id)).toEqual(["w", "m"]);
  });
});

describe("findReplaced", () => {
  it("같은 type·scope·대상의 다른 제약을 찾는다", () => {
    const existing = [
      card({ id: "a", type: "leave", scope: "month", params: { nurse_id: "n01", days: [3] } }),
      card({ id: "b", type: "max_consecutive_work", params: { days: 5 } }),
    ];
    expect(findReplaced(existing, card({ id: "c", type: "max_consecutive_work", params: { days: 4 } }))?.id).toBe("b");
    expect(findReplaced(existing, card({ id: "e", type: "max_consecutive_work", scope: "month", params: { days: 4 } }))).toBeUndefined();
    expect(findReplaced(existing, existing[1])).toBeUndefined();
  });

  it("휴가는 같은 간호사여도 대체 대상이 없다", () => {
    const existing = [card({ id: "a", type: "leave", scope: "month", params: { nurse_id: "n01", days: [3] } })];
    expect(findReplaced(existing, card({ id: "c", type: "leave", scope: "month", params: { nurse_id: "n01", days: [9] } }))).toBeUndefined();
  });
});

describe("updateCard", () => {
  it("대기 카드는 inputVersion 없이 바꾸고, 적용된 제약은 inputVersion을 올린다", () => {
    const store = fresh();
    store.getState().addPendingCards([
      card({ id: "p", type: "max_consecutive_work", params: { days: 5 } }),
      card({ id: "q", type: "min_days_off", params: { days: 8 } }),
    ]);
    store.getState().applyCard("q");
    const v = store.getState().inputVersion;

    store.getState().updateCard("p", { params: { days: 4 } });
    expect(store.getState().pendingCards[0].params).toEqual({ days: 4 });
    expect(store.getState().inputVersion).toBe(v);

    store.getState().updateCard("q", { params: { days: 9 } });
    expect(store.getState().constraints[0].params).toEqual({ days: 9 });
    expect(store.getState().inputVersion).toBe(v + 1);
  });

  it("hardness를 바꾸면 weight를 템플릿 기본값으로 맞춘다", () => {
    const store = fresh();
    store.getState().addPendingCards([
      card({ id: "p", type: "max_consecutive_work", params: { days: 5 } }),
      card({ id: "f", type: "night_fairness", hardness: "soft", weight: 5, params: {} }),
    ]);
    store.getState().updateCard("p", { hardness: "soft" });
    expect(store.getState().pendingCards[0]).toMatchObject({ hardness: "soft", weight: 10 });
    store.getState().updateCard("f", { hardness: "hard" });
    expect(store.getState().pendingCards[1]).toMatchObject({ hardness: "hard", weight: 1 });
    store.getState().updateCard("f", { hardness: "soft" });
    expect(store.getState().pendingCards[1]).toMatchObject({ hardness: "soft", weight: 5 });
  });

  it("휴가와 고정 배정은 항상 hard다", () => {
    const store = fresh();
    store.getState().addPendingCards([
      card({ id: "l", type: "leave", scope: "month", params: { nurse_id: "n01", days: [3] } }),
    ]);
    store.getState().updateCard("l", { hardness: "soft", params: { nurse_id: "n01", days: [3, 4] } });
    expect(store.getState().pendingCards[0]).toMatchObject({ hardness: "hard", params: { days: [3, 4] } });
  });
});

describe("removeCard", () => {
  it("대기 카드는 inputVersion 없이, 적용된 제약은 inputVersion을 올리며 지운다", () => {
    const store = fresh();
    store.getState().addPendingCards([
      card({ id: "p", type: "max_consecutive_work", params: { days: 5 } }),
      card({ id: "q", type: "min_days_off", params: { days: 8 } }),
    ]);
    store.getState().applyCard("q");
    const v = store.getState().inputVersion;
    store.getState().removeCard("p");
    expect(store.getState().pendingCards).toEqual([]);
    expect(store.getState().inputVersion).toBe(v);
    store.getState().removeCard("q");
    expect(store.getState().constraints).toEqual([]);
    expect(store.getState().inputVersion).toBe(v + 1);
  });
});

describe("setCoverage", () => {
  it("daily_coverage 제약을 만들고 같은 근무·요일 종류면 교체한다", () => {
    const store = fresh();
    store.getState().setCoverage("D", "weekday", 3, 4);
    store.getState().setCoverage("D", "weekend", 2, 2);
    store.getState().setCoverage("D", "weekday", 4, 5);
    const cov = store.getState().constraints;
    expect(cov).toHaveLength(2);
    expect(cov.find((c) => c.type === "daily_coverage" && c.params.day_kind === "weekday")).toMatchObject({
      type: "daily_coverage",
      scope: "ward",
      hardness: "hard",
      source_text: "필요 인원 설정",
      enabled: true,
      params: { shift: "D", day_kind: "weekday", min: 4, max: 5 },
    });
  });
});

describe("orphanConstraintIds", () => {
  it("명단에 없는 nurse_id를 참조하는 제약 id를 돌려준다", () => {
    const store = fresh();
    store.getState().setNurses(nurses);
    store.getState().addPendingCards([
      card({ id: "ok", type: "leave", scope: "month", params: { nurse_id: "n01", days: [3] } }),
      card({ id: "gone", type: "fixed_assignment", scope: "month", params: { nurse_id: "n09", day: 2, shift: "D" } }),
      card({ id: "ward", type: "night_fairness", params: {} }),
    ]);
    for (const id of ["ok", "gone", "ward"]) store.getState().applyCard(id);
    expect(store.getState().orphanConstraintIds()).toEqual(["gone"]);
    store.getState().setNurses(nurses.slice(1));
    expect(store.getState().orphanConstraintIds()).toEqual(["ok", "gone"]);
  });
});

describe("근무표 결과와 수동 고정", () => {
  const result = {
    assignments: { n01: ["D", "E"], n02: ["N", "O"] },
    summary: { preferences_total: 0, preferences_met: 0, soft_violation_count: 0 },
    stats: {},
    soft_violations: [],
    diff: null,
    optimal: true,
  } as unknown as ScheduleResult;

  it("setResult는 inputVersion을 바꾸지 않고, confirm은 현재 배정을 확정본으로 저장한다", () => {
    const store = fresh();
    store.getState().confirm();
    expect(store.getState().confirmed).toBeNull();
    store.getState().setResult(result);
    store.getState().confirm();
    expect(store.getState().result).toEqual(result);
    expect(store.getState().confirmed).toEqual(result.assignments);
    expect(store.getState().inputVersion).toBe(0);
  });

  it("setFixed는 같은 칸의 기존 고정을 교체하고 inputVersion을 올린다", () => {
    const store = fresh();
    store.getState().setNurses(nurses);
    store.getState().setFixed("n01", 5, "D");
    store.getState().setFixed("n01", 6, "E");
    store.getState().setFixed("n01", 5, "N");
    const fixed = store.getState().constraints.filter((c) => c.type === "fixed_assignment");
    expect(fixed.map((c) => c.params)).toEqual([
      { nurse_id: "n01", day: 6, shift: "E" },
      { nurse_id: "n01", day: 5, shift: "N" },
    ]);
    expect(fixed[1]).toMatchObject({ scope: "month", hardness: "hard", enabled: true, source_text: "수동 고정: 이영희 11/5 N" });
    expect(store.getState().inputVersion).toBe(4);
  });

  it("setFixed는 번역으로 만든 같은 칸의 고정 배정도 교체한다", () => {
    const store = fresh();
    store.getState().setNurses(nurses);
    store.setState({
      constraints: [card({ id: "x", type: "fixed_assignment", scope: "month", params: { nurse_id: "n01", day: 5, shift: "E" } })],
    });
    store.getState().setFixed("n01", 5, "D");
    expect(store.getState().constraints.map((c) => c.params)).toEqual([{ nurse_id: "n01", day: 5, shift: "D" }]);
  });

  it("clearFixed는 그 칸의 고정 배정만 지운다", () => {
    const store = fresh();
    store.getState().setNurses(nurses);
    store.getState().setFixed("n01", 5, "D");
    store.getState().setFixed("n02", 5, "D");
    store.getState().clearFixed("n01", 5);
    expect(store.getState().constraints.map((c) => c.params)).toEqual([{ nurse_id: "n02", day: 5, shift: "D" }]);
    expect(store.getState().inputVersion).toBe(4);
  });
});

describe("충돌 대응", () => {
  const result = {
    assignments: { n01: ["D", "E"] },
    summary: { preferences_total: 0, preferences_met: 0, soft_violation_count: 0 },
    stats: {},
    soft_violations: [],
    diff: null,
    optimal: true,
  } as unknown as ScheduleResult;

  it("setResult는 그때의 inputVersion을 resultVersion으로 남기고, 입력이 바뀌면 달라진다", () => {
    const store = fresh();
    expect(store.getState().resultVersion).toBeNull();
    store.getState().setNurses(nurses);
    store.getState().setResult(result);
    expect(store.getState().resultVersion).toBe(1);
    store.getState().toggleHoliday(3);
    expect(store.getState().resultVersion).toBe(1);
    expect(store.getState().inputVersion).toBe(2);
  });

  it("setEnabled는 제약의 enabled를 바꾸고 inputVersion을 올린다", () => {
    const store = fresh();
    store.setState({ constraints: [card({ id: "a", type: "max_consecutive_work", params: { days: 5 } })] });
    store.getState().setEnabled("a", false);
    expect(store.getState().constraints[0].enabled).toBe(false);
    expect(store.getState().inputVersion).toBe(1);
    store.getState().setEnabled("a", true);
    expect(store.getState().constraints[0].enabled).toBe(true);
    store.getState().setEnabled("없음", false);
    expect(store.getState().inputVersion).toBe(2);
  });

  it("applyChanges는 disable을 enabled=false로, update를 params·hardness 교체로 한 번에 반영한다", () => {
    const store = fresh();
    store.setState({
      constraints: [
        card({ id: "a", type: "leave", scope: "month", params: { nurse_id: "n01", days: [3, 4] } }),
        card({ id: "b", type: "max_consecutive_nights", params: { days: 3 } }),
        card({ id: "c", type: "night_fairness", hardness: "soft", weight: 5, params: {} }),
      ],
    });
    store.getState().applyChanges([
      { action: "disable", constraint_id: "a" },
      { action: "update", constraint_id: "b", params: { days: 4 }, hardness: "soft" },
      { action: "update", constraint_id: "없음", params: { days: 1 } },
    ]);
    const [a, b, c] = store.getState().constraints;
    expect(a.enabled).toBe(false);
    expect(a.params).toEqual({ nurse_id: "n01", days: [3, 4] });
    expect(b).toMatchObject({ params: { days: 4 }, hardness: "soft", weight: 10, enabled: true });
    expect(c).toMatchObject({ hardness: "soft", weight: 5 });
    expect(store.getState().inputVersion).toBe(1);
  });
});

describe("loadSample", () => {
  it("샘플 명단과 제약을 불러온다", () => {
    const store = fresh();
    store.getState().loadSample();
    const s = store.getState();
    expect(s.nurses).toEqual(sample.nurses);
    expect(s.constraints).toHaveLength(sample.constraints.length);
    expect(s.result).toBeNull();
  });
});

describe("hasInput", () => {
  it("초기 상태는 입력이 없고, 명단·공휴일·제약·대기 카드·이월 중 하나라도 있으면 입력이 있다", () => {
    expect(fresh().getState().hasInput()).toBe(false);
    const cases: ((s: ReturnType<ReturnType<typeof fresh>["getState"]>) => void)[] = [
      (s) => s.setNurses(nurses),
      (s) => s.toggleHoliday(25),
      (s) => s.setCoverage("D", "weekday", 3, 4),
      (s) => s.addPendingCards([card({ id: "c1", type: "night_fairness", params: {} })]),
      (s) => s.setCarryOver([{ nurse_id: "n01", shifts: ["N"] }]),
    ];
    for (const act of cases) {
      const store = fresh();
      act(store.getState());
      expect(store.getState().hasInput()).toBe(true);
    }
  });

  it("단계 이동이나 대상 월 변경만으로는 입력이 생기지 않는다", () => {
    const store = fresh();
    store.getState().setStep(3);
    store.getState().setPeriod({ year: 2026, month: 12 });
    expect(store.getState().hasInput()).toBe(false);
  });
});

describe("reset", () => {
  it("입력과 결과를 모두 지우고 1단계로 돌아가며 inputVersion은 올린다", () => {
    const store = fresh();
    store.getState().loadSample();
    store.getState().setResult({ assignments: { n01: ["D"] } } as unknown as ScheduleResult);
    store.getState().confirm();
    store.getState().setStep(4);
    const before = store.getState().inputVersion;

    store.getState().reset();
    const s = store.getState();
    expect(s.hasInput()).toBe(false);
    expect(s.step).toBe(1);
    expect(s.period).toEqual({ year: 2026, month: 11 });
    expect(s.result).toBeNull();
    expect(s.confirmed).toBeNull();
    expect(s.resultVersion).toBeNull();
    // 진행 중이던 요청의 응답을 버리도록 버전은 되돌리지 않는다
    expect(s.inputVersion).toBe(before + 1);
  });
});

describe("persist", () => {
  it("localStorage에 저장하고 다시 만들면 복원한다", () => {
    const storage = new MemoryStorage();
    const a = fresh(storage);
    a.getState().setNurses(nurses);
    a.getState().setStep(2);
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(saved.version).toBe(1);
    expect(saved.state).not.toHaveProperty("storageAvailable");

    const b = fresh(storage).getState();
    expect(b.nurses).toEqual(nurses);
    expect(b.step).toBe(2);
    expect(b.inputVersion).toBe(1);
    expect(b.resetNotice).toBe(false);
  });

  it("버전이 다르면 초기 상태로 되돌리고 resetNotice를 켠다", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 0, state: { nurses, step: 3, inputVersion: 9 } }));
    const s = fresh(storage).getState();
    expect(s.nurses).toEqual([]);
    expect(s.step).toBe(1);
    expect(s.resetNotice).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).state.nurses).toEqual([]);
  });

  it("JSON 파싱에 실패하면 초기화한다", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    const s = fresh(storage).getState();
    expect(s.nurses).toEqual([]);
    expect(s.resetNotice).toBe(true);
  });

  it("모양이 손상되면 초기화한다", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: { nurses: "x", step: 1 } }));
    const s = fresh(storage).getState();
    expect(s.nurses).toEqual([]);
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
    }, NOW);
    expect(store.getState().storageAvailable).toBe(false);
    store.getState().setNurses(nurses);
    expect(store.getState().nurses).toEqual(nurses);
  });

  it("쓰기가 예외를 던지면 메모리로 동작한다", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = fresh(storage);
    expect(store.getState().storageAvailable).toBe(false);
    store.getState().setNurses(nurses);
    expect(store.getState().nurses).toEqual(nurses);
  });
});
