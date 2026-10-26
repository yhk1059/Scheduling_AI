import { describe, expect, it } from "vitest";

import sample from "./samples/ward-15.json";
import { createAppStore, STORAGE_KEY } from "./store";
import type { ConstraintSpec, Nurse } from "./types.gen";

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
    expect(store.getState().constraints.map((c) => c.id).sort()).toEqual(["b", "c", "e", "f", "g", "h", "i"]);
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
