// 클라이언트의 유일한 저장소. Zustand + persist(localStorage), 쓸 수 없으면 메모리로 동작한다.
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import sample from "./samples/ward-15.json";
import type { CarryOverRow, ConstraintChange, ConstraintSpec, Nurse, Period, ScheduleResult } from "./types.gen";

export const STORAGE_KEY = "nurse-scheduler";
const STORAGE_VERSION = 1;
const COVERAGE_SOURCE_TEXT = "필요 인원 설정";
const COVERAGE_WEIGHT = 10; // backend/domain/constants.py DEFAULT_WEIGHT
// backend/llm/translator.py _weight와 같은 규칙: soft는 템플릿 기본값(없으면 DEFAULT_WEIGHT), hard는 1
const SOFT_WEIGHTS: Record<string, number> = { shift_preference: 10, night_fairness: 5, weekend_fairness: 5 };
const ALWAYS_HARD = ["leave", "fixed_assignment"];

export type Step = 1 | 2 | 3 | 4;
export type Shift = "D" | "E" | "N";
export type DayKind = "weekday" | "weekend";
export type Assignments = ScheduleResult["assignments"];
export type Hardness = "hard" | "soft";
export type Code = "D" | "E" | "N" | "O";
export interface CardPatch {
  hardness?: Hardness;
  params?: ConstraintSpec["params"];
}

interface Data {
  step: Step;
  period: Period;
  holidays: number[];
  nurses: Nurse[];
  constraints: ConstraintSpec[];
  pendingCards: ConstraintSpec[];
  carryOver: CarryOverRow[];
  result: ScheduleResult | null;
  confirmed: Assignments | null;
  inputVersion: number;
  /** result를 만든 요청의 inputVersion. 현재와 다르면 stale. */
  resultVersion: number | null;
}

export interface AppState extends Data {
  storageAvailable: boolean;
  resetNotice: boolean;
  setStep: (step: Step) => void;
  setPeriod: (period: Period) => void;
  toggleHoliday: (day: number) => void;
  setNurses: (nurses: Nurse[]) => void;
  setCarryOver: (rows: CarryOverRow[]) => void;
  setCoverage: (shift: Shift, dayKind: DayKind, min: number, max: number) => void;
  addPendingCards: (cards: ConstraintSpec[]) => void;
  applyCard: (id: string) => void;
  /** 대기 카드는 그대로, 적용된 제약은 inputVersion을 올리며 바꾼다. */
  updateCard: (id: string, patch: CardPatch) => void;
  removeCard: (id: string) => void;
  orphanConstraintIds: () => string[];
  /** 응답 버전이 현재와 같을 때만 부른다. resultVersion = 지금의 inputVersion. */
  setResult: (result: ScheduleResult) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  /** 검증된 제안의 변경: disable → enabled=false, update → params·hardness 교체. */
  applyChanges: (changes: ConstraintChange[]) => void;
  /** 그 칸의 기존 고정 배정을 지우고 수동 고정 제약을 추가한다. */
  setFixed: (nurseId: string, day: number, shift: Code) => void;
  clearFixed: (nurseId: string, day: number) => void;
  confirm: () => void;
  loadSample: () => void;
  /** 명단·공휴일·제약·대기 카드·이월 중 하나라도 있으면 true. 단계와 대상 월은 입력으로 보지 않는다. */
  hasInput: () => boolean;
  /** 초기 상태로 되돌린다. 진행 중 요청의 응답을 버리도록 inputVersion은 올린다. */
  reset: () => void;
  dismissResetNotice: () => void;
}

function nextMonth(now: Date): Period {
  const m = now.getMonth() + 1; // 0-based → 다음 달(1-based)
  return m === 12 ? { year: now.getFullYear() + 1, month: 1 } : { year: now.getFullYear(), month: m + 1 };
}

function initialData(now: Date): Data {
  return {
    step: 1,
    period: nextMonth(now),
    holidays: [],
    nurses: [],
    constraints: [],
    pendingCards: [],
    carryOver: [],
    result: null,
    confirmed: null,
    inputVersion: 0,
    resultVersion: null,
  };
}

/**
 * 교체 기준: 같은 type·scope·대상. 대상은 nurse_id(고정 배정은 nurse_id·day, 희망 근무는 nurse_id·shift·대상 날짜),
 * 없으면 shift·day_kind(금지 순서는 first·second). 휴가는 날짜별 요청이 공존해야 하므로 교체하지 않는다(null).
 */
function replaceKey(c: ConstraintSpec): string | null {
  if (c.type === "leave") return null;
  const p = (c.params ?? {}) as Record<string, unknown>;
  const target =
    c.type === "fixed_assignment"
      ? `${p.nurse_id}@${p.day}`
      : c.type === "shift_preference"
        ? `${p.nurse_id}|${p.shift}|${[...((p.days as number[] | null) ?? [])].sort((a, b) => a - b)}|${p.weekends_only === true}`
        : "nurse_id" in p
        ? p.nurse_id
        : "first" in p
          ? `${p.first}>${p.second}`
          : `${p.shift ?? ""}|${p.day_kind ?? ""}`;
  return `${c.type}|${c.scope}|${target}`;
}

function upsert(list: ConstraintSpec[], card: ConstraintSpec): ConstraintSpec[] {
  const key = replaceKey(card);
  const i = key === null ? -1 : list.findIndex((c) => replaceKey(c) === key);
  return i === -1 ? [...list, card] : list.map((c, j) => (j === i ? card : c));
}

/** card가 적용되면 대체할 기존 제약(같은 type·scope·대상, 다른 id). */
export function findReplaced(constraints: ConstraintSpec[], card: ConstraintSpec): ConstraintSpec | undefined {
  const key = replaceKey(card);
  if (key === null) return undefined;
  return constraints.find((c) => c.id !== card.id && replaceKey(c) === key);
}

function patched(c: ConstraintSpec, patch: CardPatch): ConstraintSpec {
  const next = { ...c, ...(patch.params !== undefined && { params: patch.params }) } as ConstraintSpec;
  if (patch.hardness === undefined || ALWAYS_HARD.includes(c.type)) return next;
  const weight = patch.hardness === "soft" ? (SOFT_WEIGHTS[c.type] ?? COVERAGE_WEIGHT) : 1;
  return { ...next, hardness: patch.hardness, weight };
}

function isFixedCell(c: ConstraintSpec, nurseId: string, day: number): boolean {
  return c.type === "fixed_assignment" && c.params.nurse_id === nurseId && c.params.day === day;
}

function isData(v: unknown): v is Data {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  const p = d.period as Record<string, unknown> | undefined;
  return (
    [1, 2, 3, 4].includes(d.step as number) &&
    typeof p?.year === "number" &&
    typeof p?.month === "number" &&
    ["holidays", "nurses", "constraints", "pendingCards", "carryOver"].every((k) => Array.isArray(d[k])) &&
    typeof d.inputVersion === "number"
  );
}

/** localStorage를 감싼 저장소. 접근·쓰기가 예외를 던지면 메모리로 바꾸고 onFail을 부른다. */
function safeStorage(
  getStorage: () => Storage,
  onFail: () => void,
): { storage: PersistStorage<Data>; available: boolean } {
  const memory = new Map<string, string>();
  let storage: Storage | null = null;
  try {
    storage = getStorage();
    storage.setItem(`${STORAGE_KEY}:probe`, "1");
    storage.removeItem(`${STORAGE_KEY}:probe`);
  } catch {
    storage = null;
  }

  const run = <T>(fn: (s: Storage) => T, fallback: () => T): T => {
    if (storage) {
      try {
        return fn(storage);
      } catch {
        storage = null;
        onFail();
      }
    }
    return fallback();
  };

  const persistStorage: PersistStorage<Data> = {
    getItem: (name) => {
      const raw = run((s) => s.getItem(name), () => memory.get(name) ?? null);
      if (raw === null) return null;
      try {
        const v = JSON.parse(raw);
        if (typeof v === "object" && v !== null && typeof v.version === "number") return v;
      } catch {
        // 손상된 데이터는 아래에서 버전 불일치로 처리해 초기화한다
      }
      return { state: null, version: -1 } as unknown as StorageValue<Data>;
    },
    setItem: (name, value) => {
      const raw = JSON.stringify(value);
      run((s) => s.setItem(name, raw), () => void memory.set(name, raw));
    },
    removeItem: (name) => run((s) => s.removeItem(name), () => void memory.delete(name)),
  };
  return { storage: persistStorage, available: storage !== null };
}

export function createAppStore(getStorage: () => Storage, now: Date = new Date()) {
  let markUnavailable = () => {};
  const { storage, available } = safeStorage(getStorage, () => markUnavailable());

  const store = create<AppState>()(
    persist(
      (set, get) => {
        const bump = (patch: Partial<Data>) => set((s) => ({ ...patch, inputVersion: s.inputVersion + 1 }));
        return {
          ...initialData(now),
          storageAvailable: available,
          resetNotice: false,
          setStep: (step) => set({ step }),
          setPeriod: (period) => bump({ period, holidays: [] }),
          toggleHoliday: (day) => {
            const { holidays } = get();
            bump({
              holidays: holidays.includes(day) ? holidays.filter((d) => d !== day) : [...holidays, day].sort((a, b) => a - b),
            });
          },
          setNurses: (nurses) => bump({ nurses }),
          setCarryOver: (carryOver) => bump({ carryOver }),
          setCoverage: (shift, dayKind, min, max) =>
            bump({
              constraints: upsert(get().constraints, {
                id: `cov-${dayKind}-${shift}`,
                type: "daily_coverage",
                scope: "ward",
                hardness: "hard",
                weight: COVERAGE_WEIGHT,
                source_text: COVERAGE_SOURCE_TEXT,
                enabled: true,
                params: { shift, day_kind: dayKind, min, max },
              }),
            }),
          addPendingCards: (cards) => set((s) => ({ pendingCards: [...s.pendingCards, ...cards] })),
          applyCard: (id) => {
            const { pendingCards, constraints } = get();
            const card = pendingCards.find((c) => c.id === id);
            if (!card) return;
            bump({ pendingCards: pendingCards.filter((c) => c.id !== id), constraints: upsert(constraints, card) });
          },
          updateCard: (id, patch) => {
            const { pendingCards, constraints } = get();
            if (pendingCards.some((c) => c.id === id)) {
              set({ pendingCards: pendingCards.map((c) => (c.id === id ? patched(c, patch) : c)) });
            } else if (constraints.some((c) => c.id === id)) {
              bump({ constraints: constraints.map((c) => (c.id === id ? patched(c, patch) : c)) });
            }
          },
          removeCard: (id) => {
            const { pendingCards, constraints } = get();
            if (pendingCards.some((c) => c.id === id)) {
              set({ pendingCards: pendingCards.filter((c) => c.id !== id) });
            } else if (constraints.some((c) => c.id === id)) {
              bump({ constraints: constraints.filter((c) => c.id !== id) });
            }
          },
          orphanConstraintIds: () => {
            const ids = new Set(get().nurses.map((n) => n.id));
            return get()
              .constraints.filter((c) => {
                const p = (c.params ?? {}) as { nurse_id?: string };
                return p.nurse_id !== undefined && !ids.has(p.nurse_id);
              })
              .map((c) => c.id);
          },
          setResult: (result) => set((s) => ({ result, resultVersion: s.inputVersion })),
          setEnabled: (id, enabled) => {
            const { constraints } = get();
            if (constraints.some((c) => c.id === id))
              bump({ constraints: constraints.map((c) => (c.id === id ? { ...c, enabled } : c)) });
          },
          applyChanges: (changes) => {
            const byId = new Map(changes.map((ch) => [ch.constraint_id, ch]));
            bump({
              constraints: get().constraints.map((c) => {
                const ch = byId.get(c.id);
                if (!ch) return c;
                if (ch.action === "disable") return { ...c, enabled: false };
                return patched(c, {
                  ...(ch.params && { params: ch.params as ConstraintSpec["params"] }),
                  ...(ch.hardness && { hardness: ch.hardness }),
                });
              }),
            });
          },
          setFixed: (nurseId, day, shift) => {
            const { constraints, nurses, period } = get();
            const name = nurses.find((n) => n.id === nurseId)?.name ?? nurseId;
            bump({
              constraints: [
                ...constraints.filter((c) => !isFixedCell(c, nurseId, day)),
                {
                  id: `fix-${nurseId}-${day}`,
                  type: "fixed_assignment",
                  scope: "month",
                  hardness: "hard",
                  weight: 1,
                  source_text: `수동 고정: ${name} ${period.month}/${day} ${shift}`,
                  enabled: true,
                  params: { nurse_id: nurseId, day, shift },
                },
              ],
            });
          },
          clearFixed: (nurseId, day) =>
            bump({ constraints: get().constraints.filter((c) => !isFixedCell(c, nurseId, day)) }),
          confirm: () => {
            const { result } = get();
            if (result) set({ confirmed: result.assignments });
          },
          loadSample: () =>
            bump({
              nurses: sample.nurses,
              holidays: sample.holidays,
              constraints: sample.constraints as ConstraintSpec[],
              pendingCards: [],
              carryOver: sample.carry_over as CarryOverRow[],
              result: null,
              resultVersion: null,
              confirmed: null,
            }),
          hasInput: () => {
            const s = get();
            return [s.nurses, s.holidays, s.constraints, s.pendingCards, s.carryOver].some((list) => list.length > 0);
          },
          reset: () => bump(initialData(now)),
          dismissResetNotice: () => set({ resetNotice: false }),
        };
      },
      {
        name: STORAGE_KEY,
        version: STORAGE_VERSION,
        storage,
        partialize: (s): Data => ({
          step: s.step,
          period: s.period,
          holidays: s.holidays,
          nurses: s.nurses,
          constraints: s.constraints,
          pendingCards: s.pendingCards,
          carryOver: s.carryOver,
          result: s.result,
          confirmed: s.confirmed,
          inputVersion: s.inputVersion,
          resultVersion: s.resultVersion,
        }),
        // 버전이 다르거나 파싱에 실패하면 버리고, merge에서 초기 상태 + resetNotice로 처리한다
        migrate: () => null as unknown as Data,
        merge: (persisted, current) =>
          persisted === undefined
            ? current
            : isData(persisted)
              ? { ...current, ...persisted }
              : { ...current, resetNotice: true },
      },
    ),
  );

  markUnavailable = () => store.setState({ storageAvailable: false });
  return store;
}

export const useAppStore = createAppStore(() => window.localStorage);
