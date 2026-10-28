// 클라이언트의 유일한 저장소. Zustand + persist(localStorage), 쓸 수 없으면 메모리로 동작한다.
// 상태는 병동 1개 + 기간 목록(ARCHITECTURE "상태 관리"). 이력은 확정된 기간이다.
// 로그인하면 같은 문서를 remote(wards.data)에도 저장한다(ADR-014). 서버 우선, 마지막 저장이 이긴다.
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import {
  carryOverFrom,
  diffAssignments,
  historyLoadFor,
  isOperating,
  pastDayLocks,
  previousConfirmedPeriod,
  rosterChanges,
  sameCarryOver,
} from "./continuity";
import { firstPeriodStart, monthDay, nextPeriod, periodFrom, type PeriodRange, type PeriodUnit } from "./period";
import { buildSample } from "./sample";
import { deleteWard, loadWard, saveWard, supabaseConfigured, type AuthUser } from "./supabase";
import type {
  CarryOverRow,
  ConstraintChange,
  ConstraintSpec,
  DiffCell,
  Nurse,
  ScheduleRequest,
  ScheduleResult,
} from "./types.gen";

export const STORAGE_KEY = "nurse-scheduler";
const STORAGE_VERSION = 4;
const COVERAGE_SOURCE_TEXT = "필요 인원 설정";
const COVERAGE_WEIGHT = 10; // backend/domain/constants.py DEFAULT_WEIGHT
// backend/llm/translator.py _weight와 같은 규칙: soft는 템플릿 기본값(없으면 DEFAULT_WEIGHT), hard는 1
const SOFT_WEIGHTS: Record<string, number> = { shift_preference: 10, night_fairness: 5, weekend_fairness: 5 };
const ALWAYS_HARD = ["leave", "fixed_assignment"];
export const SAVE_DEBOUNCE_MS = 1000;

export type Shift = "D" | "E" | "N";
export type DayKind = "weekday" | "weekend";
export type Assignments = ScheduleResult["assignments"];
export type Hardness = "hard" | "soft";
export type Code = "D" | "E" | "N" | "O";
export interface CardPatch {
  hardness?: Hardness;
  params?: ConstraintSpec["params"];
}

export interface WardNurse extends Nurse {
  active: boolean;
}
export type NurseRow = Omit<Nurse, "id">;

export interface Ward {
  name: string;
  unit: PeriodUnit;
  nurses: WardNurse[];
  /** 다음에 부여할 번호. 줄어들지 않는다 */
  nextNurseNo: number;
  /** scope "ward". 필요 인원(daily_coverage)도 여기 */
  rules: ConstraintSpec[];
  pendingRules: ConstraintSpec[];
  /** 카드 표시 순서(새 카드가 앞). 적용해도 바뀌지 않는다. 옛 저장본에는 없다 */
  cardOrder?: string[];
  /** 샘플에서 시작했는지(로그인 시 질문에 쓴다) */
  isSample: boolean;
}

export interface PeriodVersion {
  confirmed_at: string;
  assignments: Assignments;
  /** 직전 버전 대비 바뀐 칸 */
  changed: DiffCell[];
}

export interface WorkPeriod extends PeriodRange {
  id: string;
  holidays: number[];
  /** scope "period" (요청, 수동 고정) */
  requests: ConstraintSpec[];
  pendingRequests: ConstraintSpec[];
  /** 카드 표시 순서(새 카드가 앞). 적용해도 바뀌지 않는다. 옛 저장본에는 없다 */
  cardOrder?: string[];
  /** [이번 기간만 끄기] */
  disabledIds: string[];
  /** 이 기간에만 바뀐 병동 규칙(제안 수락 update) */
  ruleOverrides: Record<string, ConstraintSpec>;
  /** 수동 입력 이월(첫 기간) */
  carryOver: CarryOverRow[];
  /** result를 만든 요청에 쓴 carry_over. 이월 변경 판정에 쓴다. */
  carryOverUsed: CarryOverRow[] | null;
  result: ScheduleResult | null;
  /** result를 만든 요청의 inputVersion. 현재와 다르면 stale. */
  resultVersion: number | null;
  status: "draft" | "confirmed";
  versions: PeriodVersion[];
  /** 확정 시점의 명단·병동 규칙 */
  snapshot: { nurses: WardNurse[]; rules: ConstraintSpec[] } | null;
}

export type View =
  | { screen: "home" }
  | { screen: "settings"; tab: "roster" | "rules" }
  | { screen: "period"; periodId: string; step: 1 | 2 | 3 };

interface Data {
  ward: Ward | null;
  /** start_date 오름차순 */
  periods: WorkPeriod[];
  view: View;
  inputVersion: number;
}

/** 원격 병동 문서(wards 1행). 테스트에서 가짜로 주입한다. */
export interface WardRemote {
  load(): Promise<{ data: unknown; updatedAt: string } | null>;
  save(userId: string, data: unknown): Promise<{ updatedAt: string }>;
  remove(): Promise<void>;
}

export type SyncStatus = "guest" | "loading" | "saving" | "saved" | "error";
export type LoginPrompt = null | { kind: "sample-choice" } | { kind: "server-replaced-guest" };

export interface AppState extends Data {
  storageAvailable: boolean;
  resetNotice: boolean;
  // 로그인 저장 (persist 대상 아님)
  auth: { userId: string; email: string | null } | null;
  sync: { status: SyncStatus; savedAt: string | null };
  /** 화면이 대화상자로 보여 줄 것 */
  loginPrompt: LoginPrompt;
  /** 로그인 직후(세션 복원 포함) 한 번. 서버 문서가 있으면 서버 우선, 없으면 게스트 상태를 올린다. */
  signedIn: (user: AuthUser) => Promise<void>;
  /** sample-choice 답. keep이면 샘플을 내 병동으로, 아니면 빈 병동으로 올린다. */
  chooseSample: (keep: boolean) => Promise<void>;
  dismissLoginPrompt: () => void;
  retrySave: () => Promise<void>;
  /** 이 브라우저의 상태와 localStorage 키를 지운다. 서버 문서는 그대로 둔다. */
  signedOut: () => void;
  /** 서버 문서를 지우고 빈 병동으로(로그인 유지). 실패하면 throw한다. */
  deleteWardData: () => Promise<void>;
  // 병동
  startWard: () => void;
  /** 샘플 병동(운영 중인 이번 달 확정본 + 다음 달 초안)을 만들고 홈으로 간다. */
  loadSample: (today: string) => void;
  setWardName: (name: string) => void;
  setUnit: (unit: PeriodUnit) => void;
  setCoverage: (shift: Shift, dayKind: DayKind, min: number, max: number) => void;
  addPendingRules: (cards: ConstraintSpec[]) => void;
  applyRule: (id: string) => void;
  /** 대기 카드는 그대로, 적용된 규칙은 inputVersion을 올리며 바꾼다. */
  updateRule: (id: string, patch: CardPatch) => void;
  removeRule: (id: string) => void;
  // 명단
  addNurses: (rows: NurseRow[]) => void;
  updateNurse: (id: string, patch: Partial<NurseRow>) => void;
  setNurseActive: (id: string, active: boolean) => void;
  /** 같은 이름은 id를 유지하고, 새 이름에만 새 id, 빠진 사람은 비활성. */
  replaceRoster: (rows: NurseRow[]) => void;
  /** 어떤 기간에서도 쓰이지 않은 간호사만 지운다. 아니면 비활성으로 바꾼다. */
  removeNurse: (id: string) => void;
  // 기간
  /** 초안이 있으면 그 기간을, 없으면 새 기간을 만들어 ①로 간다. 병동이 없으면 null. */
  createPeriod: (today: string) => string | null;
  toggleHoliday: (periodId: string, day: number) => void;
  setCarryOver: (periodId: string, rows: CarryOverRow[]) => void;
  addPendingRequests: (periodId: string, cards: ConstraintSpec[]) => void;
  applyRequest: (periodId: string, id: string) => void;
  updateRequest: (periodId: string, id: string, patch: CardPatch) => void;
  removeRequest: (periodId: string, id: string) => void;
  /** 이 기간의 disabledIds만 바꾼다. 병동 규칙·요청 원본은 그대로 둔다. */
  setDisabled: (periodId: string, constraintId: string, disabled: boolean) => void;
  /** 검증된 제안: disable → disabledIds, update → 요청은 직접, 병동 규칙은 ruleOverrides. */
  applyChanges: (periodId: string, changes: ConstraintChange[]) => void;
  /** 그 칸의 기존 고정 배정을 지우고 수동 고정 제약을 추가한다. */
  setFixed: (periodId: string, nurseId: string, day: number, shift: Code) => void;
  clearFixed: (periodId: string, nurseId: string, day: number) => void;
  /** 응답 버전이 현재와 같을 때만 부른다. resultVersion = 지금의 inputVersion. usedCarryOver = 그 요청의 carry_over. */
  setResult: (periodId: string, result: ScheduleResult, usedCarryOver: CarryOverRow[]) => void;
  /** 첫 확정은 버전 1개, 이미 확정된 기간은 바뀐 칸이 있을 때만 버전을 추가한다([다시 확정]). */
  confirm: (periodId: string) => void;
  // 화면
  go: (view: View) => void;
  /** 병동이 있거나 기간이 하나라도 있으면 true. */
  hasInput: () => boolean;
  /** 초기 상태로 되돌린다. 진행 중 요청의 응답을 버리도록 inputVersion은 올린다. */
  reset: () => void;
  dismissResetNotice: () => void;
}

function initialData(): Data {
  return { ward: null, periods: [], view: { screen: "home" }, inputVersion: 0 };
}

function emptyWard(): Ward {
  return { name: "", unit: "month", nurses: [], nextNurseNo: 1, rules: [], pendingRules: [], isSample: false };
}

function newPeriod(range: PeriodRange): WorkPeriod {
  return {
    ...range,
    id: `p-${range.start_date}`,
    holidays: [],
    requests: [],
    pendingRequests: [],
    disabledIds: [],
    ruleOverrides: {},
    carryOver: [],
    carryOverUsed: null,
    result: null,
    resultVersion: null,
    status: "draft",
    versions: [],
    snapshot: null,
  };
}

const nurseId = (no: number) => `n${String(no).padStart(2, "0")}`;

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

/** 대기·적용 카드를 한 목록으로. order에 있는 카드가 그 순서로 앞에, 없는 카드는 대기 → 적용 순으로 뒤에 둔다. */
export function cardsInOrder(
  pending: ConstraintSpec[],
  applied: ConstraintSpec[],
  order: string[] = [],
): { card: ConstraintSpec; pending: boolean }[] {
  const all = [...pending.map((card) => ({ card, pending: true })), ...applied.map((card) => ({ card, pending: false }))];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  return all.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x.card.id) - rank(b.x.card.id) || a.i - b.i).map(({ x }) => x);
}

/** 새 카드 id를 순서 맨 앞에 붙인다. */
const prependOrder = (order: string[] | undefined, cards: ConstraintSpec[]) => [...cards.map((c) => c.id), ...(order ?? [])];

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

function changePatch(ch: ConstraintChange): CardPatch {
  return {
    ...(ch.params && { params: ch.params as ConstraintSpec["params"] }),
    ...(ch.hardness && { hardness: ch.hardness }),
  };
}

function isFixedCell(c: ConstraintSpec, nurseId: string, day: number): boolean {
  return c.type === "fixed_assignment" && c.params.nurse_id === nurseId && c.params.day === day;
}

function refNurse(c: ConstraintSpec): string | undefined {
  return (c.params as { nurse_id?: string } | undefined)?.nurse_id;
}

/** 이 기간을 풀 때 쓰는 명단과 병동 규칙 원본. 확정된 기간은 확정 시점의 것을 쓴다(PRD J1). */
function basis(ward: Ward, period: WorkPeriod): { nurses: WardNurse[]; rules: ConstraintSpec[] } {
  return period.status === "confirmed" && period.snapshot ? period.snapshot : ward;
}

/**
 * 기간 하나의 /solve·/explain 요청 본문(input_version 제외).
 * 이월·누적 부담·지난 날짜 잠금은 요청할 때마다 periods와 today로 다시 계산한다(ADR-015).
 */
export function toScheduleRequest(
  ward: Ward,
  period: WorkPeriod,
  periods: WorkPeriod[],
  today: string,
): Omit<ScheduleRequest, "input_version"> {
  const { nurses, rules } = basis(ward, period);
  const active = nurses.filter((n) => n.active);
  const activeIds = active.map((n) => n.id);
  const ids = new Set(activeIds);
  const locks = isOperating(period, today) ? pastDayLocks(period, active, today) : [];
  const locked = new Set(locks.map((c) => `${refNurse(c)}@${(c.params as { day: number }).day}`));
  const constraints = [...rules.map((r) => period.ruleOverrides[r.id] ?? r), ...period.requests]
    .filter((c) => {
      const ref = refNurse(c);
      return ref === undefined || ids.has(ref);
    })
    // 지난 날짜 잠금이 같은 칸의 수동 고정보다 우선한다
    .filter((c) => !(c.type === "fixed_assignment" && locked.has(`${c.params.nurse_id}@${c.params.day}`)))
    .map((c) => (period.disabledIds.includes(c.id) ? { ...c, enabled: false } : c));
  const previous = period.result
    ? Object.fromEntries(Object.entries(period.result.assignments).filter(([id]) => ids.has(id)))
    : null;
  const prev = previousConfirmedPeriod(periods, period);
  return {
    nurses: active.map(({ id, name, years, night_only }) => ({ id, name, years, night_only })) as ScheduleRequest["nurses"],
    period: { start_date: period.start_date, length: period.length },
    holidays: period.holidays,
    constraints: [...constraints, ...locks],
    carry_over: prev ? carryOverFrom(prev, activeIds) : period.carryOver.filter((r) => ids.has(r.nurse_id)),
    history_load: historyLoadFor(periods, period, activeIds),
    ...(previous && { previous }),
  };
}

/** 마지막 생성에 쓴 이월과 지금 지난 확정본에서 계산한 이월이 다른지(초안·확정 모두, PRD J4). */
export function carryOverChanged(period: WorkPeriod, periods: WorkPeriod[]): boolean {
  if (!period.carryOverUsed) return false;
  const prev = previousConfirmedPeriod(periods, period);
  if (!prev) return false;
  const ids = period.result ? Object.keys(period.result.assignments) : period.carryOverUsed.map((r) => r.nurse_id);
  return !sameCarryOver(period.carryOverUsed, carryOverFrom(prev, ids));
}

/** 확정된 기간에서 현재 결과가 최신 확정본과 다른지([다시 확정] 활성화). */
export function hasUnconfirmedChanges(period: WorkPeriod): boolean {
  const last = period.versions.at(-1);
  if (period.status !== "confirmed" || !period.result || !last) return false;
  return diffAssignments(last.assignments, period.result.assignments).length > 0;
}

/** 새로 만들 기간 범위. 마지막 기간 다음, 기간이 없으면 today 이후 첫 기간. */
export function upcomingRange(unit: PeriodUnit, periods: WorkPeriod[], today: string): PeriodRange {
  const last = periods.at(-1);
  // nextPeriod는 마지막 끝 + 1일 이후의 새 단위 첫 시작일이다(단위를 바꿨어도 맞춰진다)
  return last ? nextPeriod(unit, last) : periodFrom(unit, firstPeriodStart(unit, today));
}

export type NextPeriodState = { state: "none" } | { state: "draft" | "confirmed"; period: WorkPeriod };

/** 병동 홈: 운영 중 기간, 오늘 이후 시작하는 가장 이른 기간, 최근 기간(시작일 내림차순). */
export function homeSummary(
  periods: WorkPeriod[],
  today: string,
): { operating: WorkPeriod | null; next: NextPeriodState; recent: WorkPeriod[] } {
  const recent = [...periods].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const upcoming = recent.filter((p) => p.start_date > today).at(-1);
  return {
    operating: periods.find((p) => isOperating(p, today)) ?? null,
    next: upcoming ? { state: upcoming.status, period: upcoming } : { state: "none" },
    recent,
  };
}

/** ① 준비의 명단 점검: 이 기간 이전 마지막 확정 기간의 snapshot 대비 추가·비활성화된 간호사. */
export function rosterChangesFor(
  ward: Ward,
  periods: WorkPeriod[],
  periodId: string,
): ReturnType<typeof rosterChanges> {
  const period = periods.find((p) => p.id === periodId);
  const prev = period
    ? (periods.filter((p) => p.status === "confirmed" && p.start_date < period.start_date).at(-1) ?? null)
    : null;
  return rosterChanges(prev, ward.nurses);
}

/** 활성 명단에 없는 간호사를 가리키는 병동 규칙·요청 id. */
export function orphanConstraintIds(ward: Ward, period: WorkPeriod | null): string[] {
  const ids = new Set(ward.nurses.filter((n) => n.active).map((n) => n.id));
  return [...ward.rules, ...(period?.requests ?? [])]
    .filter((c) => {
      const ref = refNurse(c);
      return ref !== undefined && !ids.has(ref);
    })
    .map((c) => c.id);
}

/** 지금 화면의 기간. 기간 화면이 아니면 첫 초안, 없으면 마지막 기간. */
export function currentPeriod(s: Pick<Data, "periods" | "view">): WorkPeriod | null {
  if (s.view.screen === "period") {
    const { periodId } = s.view;
    const found = s.periods.find((p) => p.id === periodId);
    if (found) return found;
  }
  return s.periods.find((p) => p.status === "draft") ?? s.periods.at(-1) ?? null;
}

/** 어떤 기간의 요청·결과·확정본·이월에서 쓰이거나, 병동 규칙이 참조하는 간호사인지. */
export function isNurseUsed(id: string, ward: Ward, periods: WorkPeriod[]): boolean {
  const refs = (list: ConstraintSpec[]) => list.some((c) => refNurse(c) === id);
  if (refs(ward.rules) || refs(ward.pendingRules)) return true;
  return periods.some(
    (p) =>
      refs(p.requests) ||
      refs(p.pendingRequests) ||
      p.carryOver.some((r) => r.nurse_id === id) ||
      (p.result !== null && id in p.result.assignments) ||
      p.versions.some((v) => id in v.assignments) ||
      (p.snapshot?.nurses.some((n) => n.id === id) ?? false),
  );
}

function isData(v: unknown): v is Data {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  const w = d.ward as Record<string, unknown> | null | undefined;
  const view = d.view as Record<string, unknown> | undefined;
  const wardOk =
    w === null ||
    (typeof w === "object" &&
      w !== undefined &&
      ["nurses", "rules", "pendingRules"].every((k) => Array.isArray(w[k])) &&
      typeof w.nextNurseNo === "number" &&
      typeof w.unit === "string");
  const periodsOk =
    Array.isArray(d.periods) &&
    d.periods.every(
      (p: Record<string, unknown>) =>
        typeof p?.id === "string" &&
        typeof p.start_date === "string" &&
        typeof p.length === "number" &&
        ["holidays", "requests", "pendingRequests", "disabledIds", "carryOver", "versions"].every((k) =>
          Array.isArray(p[k]),
        ) &&
        (p.carryOverUsed === null || Array.isArray(p.carryOverUsed)),
    );
  return wardOk && periodsOk && typeof view?.screen === "string" && typeof d.inputVersion === "number";
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

const persisted = (s: Data): Data => ({
  ward: s.ward,
  periods: s.periods,
  view: s.view,
  inputVersion: s.inputVersion,
});

export function createAppStore(getStorage: () => Storage, now: () => Date = () => new Date(), remote?: WardRemote) {
  let markUnavailable = () => {};
  const { storage, available } = safeStorage(getStorage, () => markUnavailable());
  // 서버 상태를 확인한 뒤에만 자동 저장한다(로딩·샘플 선택 중에는 서버 문서를 덮어쓰지 않게)
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  let dirty = false;
  const cancelTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const store = create<AppState>()(
    persist(
      (set, get) => {
        const bump = (patch: Partial<Data>) => set((s) => ({ ...patch, inputVersion: s.inputVersion + 1 }));
        /** 병동이 있을 때만 바꾼다. */
        const editWard = (fn: (w: Ward) => Ward, version = true) => {
          const { ward } = get();
          if (!ward) return;
          if (version) bump({ ward: fn(ward) });
          else set({ ward: fn(ward) });
        };
        const editPeriod = (periodId: string, fn: (p: WorkPeriod) => WorkPeriod, version = true) => {
          const { periods } = get();
          if (!periods.some((p) => p.id === periodId)) return;
          const next = periods.map((p) => (p.id === periodId ? fn(p) : p));
          if (version) bump({ periods: next });
          else set({ periods: next });
        };
        const withIds = (w: Ward, rows: NurseRow[]): Ward => ({
          ...w,
          nurses: [
            ...w.nurses,
            ...rows.map(({ name, years, night_only }, i) => ({
              id: nurseId(w.nextNurseNo + i),
              name,
              years,
              night_only,
              active: true,
            })),
          ],
          nextNurseNo: w.nextNurseNo + rows.length,
        });

        /** 서버에 저장하는 문서. persist와 같은 모양이다. */
        const doc = () => ({ version: STORAGE_VERSION, state: persisted(get()) });
        const save = async (): Promise<void> => {
          const userId = get().auth?.userId;
          if (!remote || !userId || !ready) return;
          cancelTimer();
          if (saving) {
            dirty = true;
            return;
          }
          saving = true;
          dirty = false;
          set((s) => ({ sync: { ...s.sync, status: "saving" } }));
          try {
            const { updatedAt } = await remote.save(userId, doc());
            if (get().auth?.userId === userId) set({ sync: { status: "saved", savedAt: updatedAt } });
          } catch {
            // localStorage에는 남아 있다. [다시 시도]나 다음 변경으로 다시 저장한다(PRD J8)
            if (get().auth?.userId === userId) set((s) => ({ sync: { ...s.sync, status: "error" } }));
          } finally {
            saving = false;
          }
          if (dirty) await save();
        };
        /** 상태를 통째로 바꾼다. 진행 중 요청의 응답을 버리도록 inputVersion은 지금보다 크게 한다. */
        const replace = (data: Data, extra: Partial<AppState> = {}) =>
          set((s) => ({ ...data, inputVersion: Math.max(s.inputVersion, data.inputVersion) + 1, ...extra }));
        const emptyWardData = (): Data => ({ ...initialData(), ward: emptyWard(), view: { screen: "settings", tab: "roster" } });
        /** 게스트 상태를 올린다. */
        const upload = async () => {
          ready = true;
          await save();
        };

        return {
          ...initialData(),
          storageAvailable: available,
          resetNotice: false,
          auth: null,
          sync: { status: "guest", savedAt: null },
          loginPrompt: null,

          signedIn: async (user) => {
            if (!remote) return;
            ready = false;
            cancelTimer();
            set({ auth: { userId: user.id, email: user.email }, sync: { status: "loading", savedAt: null }, loginPrompt: null });
            let row: Awaited<ReturnType<WardRemote["load"]>>;
            try {
              row = await remote.load();
            } catch {
              set((s) => ({ sync: { ...s.sync, status: "error" } }));
              return;
            }
            if (get().auth?.userId !== user.id) return;
            const guest = get().hasInput();
            if (row) {
              // 서버 우선
              const d = row.data as { version?: unknown; state?: unknown } | null;
              const ok = d?.version === STORAGE_VERSION && isData(d.state);
              replace(ok ? persisted(d.state as Data) : initialData(), {
                sync: { status: "saved", savedAt: row.updatedAt },
                loginPrompt: guest ? { kind: "server-replaced-guest" } : null,
                ...(!ok && { resetNotice: true }),
              });
              ready = true;
              return;
            }
            const { ward } = get();
            if (ward?.isSample) {
              set({ loginPrompt: { kind: "sample-choice" } });
              return;
            }
            if (guest) set({ ward: ward && { ...ward, isSample: false } });
            else replace(emptyWardData());
            await upload();
          },
          chooseSample: async (keep) => {
            const { ward, auth } = get();
            if (!remote || !auth || ready) return;
            if (keep) set({ ward: ward && { ...ward, isSample: false }, loginPrompt: null });
            else replace(emptyWardData(), { loginPrompt: null });
            await upload();
          },
          dismissLoginPrompt: () => set({ loginPrompt: null }),
          retrySave: async () => {
            const { auth } = get();
            if (!remote || !auth) return;
            // 서버 문서를 읽지 못했으면 덮어쓰지 않고 다시 읽는다
            if (!ready) return get().signedIn({ id: auth.userId, email: auth.email });
            await save();
          },
          signedOut: () => {
            ready = false;
            cancelTimer();
            dirty = false;
            replace(initialData(), { auth: null, sync: { status: "guest", savedAt: null }, loginPrompt: null });
            storage.removeItem(STORAGE_KEY);
          },
          deleteWardData: async () => {
            if (!remote || !get().auth) return;
            cancelTimer();
            await remote.remove();
            // 지운 직후 빈 병동을 다시 올리지 않는다. 사용자가 바꾸면 그때 저장한다
            ready = false;
            replace(emptyWardData(), { sync: { status: "saved", savedAt: null } });
            ready = true;
          },

          startWard: () => bump({ ward: emptyWard(), periods: [], view: { screen: "settings", tab: "roster" } }),
          loadSample: (today) => {
            let n = 0;
            const { ward, periods } = buildSample(today, () => `p-sample-${++n}`);
            bump({ ward, periods, view: { screen: "home" } });
          },
          setWardName: (name) => editWard((w) => ({ ...w, name })),
          setUnit: (unit) => editWard((w) => ({ ...w, unit })),
          setCoverage: (shift, dayKind, min, max) =>
            editWard((w) => ({
              ...w,
              rules: upsert(w.rules, {
                id: `cov-${dayKind}-${shift}`,
                type: "daily_coverage",
                scope: "ward",
                hardness: "hard",
                weight: COVERAGE_WEIGHT,
                source_text: COVERAGE_SOURCE_TEXT,
                enabled: true,
                params: { shift, day_kind: dayKind, min, max },
              }),
            })),
          addPendingRules: (cards) =>
            editWard(
              (w) => ({ ...w, pendingRules: [...w.pendingRules, ...cards], cardOrder: prependOrder(w.cardOrder, cards) }),
              false,
            ),
          applyRule: (id) => {
            const card = get().ward?.pendingRules.find((c) => c.id === id);
            if (!card) return;
            editWard((w) => ({ ...w, pendingRules: w.pendingRules.filter((c) => c.id !== id), rules: upsert(w.rules, card) }));
          },
          updateRule: (id, patch) => {
            const w = get().ward;
            if (w?.pendingRules.some((c) => c.id === id)) {
              editWard((w) => ({ ...w, pendingRules: w.pendingRules.map((c) => (c.id === id ? patched(c, patch) : c)) }), false);
            } else if (w?.rules.some((c) => c.id === id)) {
              editWard((w) => ({ ...w, rules: w.rules.map((c) => (c.id === id ? patched(c, patch) : c)) }));
            }
          },
          removeRule: (id) => {
            const w = get().ward;
            if (w?.pendingRules.some((c) => c.id === id)) {
              editWard((w) => ({ ...w, pendingRules: w.pendingRules.filter((c) => c.id !== id) }), false);
            } else if (w?.rules.some((c) => c.id === id)) {
              editWard((w) => ({ ...w, rules: w.rules.filter((c) => c.id !== id) }));
            }
          },

          addNurses: (rows) => editWard((w) => withIds(w, rows)),
          updateNurse: (id, patch) =>
            editWard((w) => ({ ...w, nurses: w.nurses.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),
          setNurseActive: (id, active) =>
            editWard((w) => ({ ...w, nurses: w.nurses.map((n) => (n.id === id ? { ...n, active } : n)) })),
          replaceRoster: (rows) =>
            editWard((w) => {
              const byName = new Map(w.nurses.map((n) => [n.name, n]));
              let no = w.nextNurseNo;
              // 붙여넣은 순서를 따르고, 빠진 사람은 뒤에 비활성으로 남긴다
              const listed = rows.map(({ name, years, night_only }) => ({
                id: byName.get(name)?.id ?? nurseId(no++),
                name,
                years,
                night_only,
                active: true,
              }));
              const listedIds = new Set(listed.map((n) => n.id));
              const missing = w.nurses.filter((n) => !listedIds.has(n.id)).map((n) => ({ ...n, active: false }));
              return { ...w, nurses: [...listed, ...missing], nextNurseNo: no };
            }),
          removeNurse: (id) => {
            const { ward, periods } = get();
            if (!ward) return;
            if (isNurseUsed(id, ward, periods)) get().setNurseActive(id, false);
            else editWard((w) => ({ ...w, nurses: w.nurses.filter((n) => n.id !== id) }));
          },

          createPeriod: (today) => {
            const { ward, periods } = get();
            if (!ward) return null;
            const draft = periods.find((p) => p.status === "draft");
            if (draft) {
              set({ view: { screen: "period", periodId: draft.id, step: 1 } });
              return draft.id;
            }
            const period = newPeriod(upcomingRange(ward.unit, periods, today));
            bump({ periods: [...periods, period], view: { screen: "period", periodId: period.id, step: 1 } });
            return period.id;
          },
          toggleHoliday: (periodId, day) =>
            editPeriod(periodId, (p) => ({
              ...p,
              holidays: p.holidays.includes(day)
                ? p.holidays.filter((d) => d !== day)
                : [...p.holidays, day].sort((a, b) => a - b),
            })),
          setCarryOver: (periodId, carryOver) => editPeriod(periodId, (p) => ({ ...p, carryOver })),
          addPendingRequests: (periodId, cards) =>
            editPeriod(
              periodId,
              (p) => ({ ...p, pendingRequests: [...p.pendingRequests, ...cards], cardOrder: prependOrder(p.cardOrder, cards) }),
              false,
            ),
          applyRequest: (periodId, id) => {
            const card = get().periods.find((p) => p.id === periodId)?.pendingRequests.find((c) => c.id === id);
            if (!card) return;
            editPeriod(periodId, (p) => ({
              ...p,
              pendingRequests: p.pendingRequests.filter((c) => c.id !== id),
              requests: upsert(p.requests, card),
            }));
          },
          updateRequest: (periodId, id, patch) => {
            const period = get().periods.find((p) => p.id === periodId);
            if (period?.pendingRequests.some((c) => c.id === id)) {
              editPeriod(
                periodId,
                (p) => ({ ...p, pendingRequests: p.pendingRequests.map((c) => (c.id === id ? patched(c, patch) : c)) }),
                false,
              );
            } else if (period?.requests.some((c) => c.id === id)) {
              editPeriod(periodId, (p) => ({ ...p, requests: p.requests.map((c) => (c.id === id ? patched(c, patch) : c)) }));
            }
          },
          removeRequest: (periodId, id) => {
            const period = get().periods.find((p) => p.id === periodId);
            if (period?.pendingRequests.some((c) => c.id === id)) {
              editPeriod(periodId, (p) => ({ ...p, pendingRequests: p.pendingRequests.filter((c) => c.id !== id) }), false);
            } else if (period?.requests.some((c) => c.id === id)) {
              editPeriod(periodId, (p) => ({ ...p, requests: p.requests.filter((c) => c.id !== id) }));
            }
          },
          setDisabled: (periodId, constraintId, disabled) =>
            editPeriod(periodId, (p) => ({
              ...p,
              disabledIds: disabled
                ? [...p.disabledIds.filter((id) => id !== constraintId), constraintId]
                : p.disabledIds.filter((id) => id !== constraintId),
            })),
          applyChanges: (periodId, changes) => {
            const { ward } = get();
            if (!ward) return;
            editPeriod(periodId, (p) => {
              const rules = basis(ward, p).rules;
              let next = p;
              for (const ch of changes) {
                if (ch.action === "disable") {
                  if (!next.disabledIds.includes(ch.constraint_id))
                    next = { ...next, disabledIds: [...next.disabledIds, ch.constraint_id] };
                } else if (next.requests.some((c) => c.id === ch.constraint_id)) {
                  next = {
                    ...next,
                    requests: next.requests.map((c) => (c.id === ch.constraint_id ? patched(c, changePatch(ch)) : c)),
                  };
                } else {
                  const rule = next.ruleOverrides[ch.constraint_id] ?? rules.find((r) => r.id === ch.constraint_id);
                  if (rule)
                    next = { ...next, ruleOverrides: { ...next.ruleOverrides, [rule.id]: patched(rule, changePatch(ch)) } };
                }
              }
              return next;
            });
          },
          setFixed: (periodId, nurseId, day, shift) => {
            const name = get().ward?.nurses.find((n) => n.id === nurseId)?.name ?? nurseId;
            editPeriod(periodId, (p) => ({
              ...p,
              requests: [
                ...p.requests.filter((c) => !isFixedCell(c, nurseId, day)),
                {
                  id: `fix-${nurseId}-${day}`,
                  type: "fixed_assignment",
                  scope: "period",
                  hardness: "hard",
                  weight: 1,
                  source_text: `수동 고정: ${name} ${monthDay(p, day)} ${shift}`,
                  enabled: true,
                  params: { nurse_id: nurseId, day, shift },
                },
              ],
            }));
          },
          clearFixed: (periodId, nurseId, day) =>
            editPeriod(periodId, (p) => ({ ...p, requests: p.requests.filter((c) => !isFixedCell(c, nurseId, day)) })),
          setResult: (periodId, result, usedCarryOver) => {
            const v = get().inputVersion;
            editPeriod(periodId, (p) => ({ ...p, result, resultVersion: v, carryOverUsed: usedCarryOver }), false);
          },
          confirm: (periodId) => {
            const { ward } = get();
            if (!ward) return;
            editPeriod(
              periodId,
              (p) => {
                if (!p.result) return p;
                const last = p.versions.at(-1);
                const changed = p.status === "confirmed" && last ? diffAssignments(last.assignments, p.result.assignments) : [];
                if (p.status === "confirmed" && last && changed.length === 0) return p;
                return {
                  ...p,
                  status: "confirmed",
                  versions: [...p.versions, { confirmed_at: now().toISOString(), assignments: p.result.assignments, changed }],
                  snapshot: p.snapshot ?? { nurses: ward.nurses.filter((n) => n.active), rules: ward.rules },
                };
              },
              false,
            );
          },

          go: (view) => set({ view }),
          hasInput: () => get().ward !== null || get().periods.length > 0,
          reset: () => bump(initialData()),
          dismissResetNotice: () => set({ resetNotice: false }),
        };
      },
      {
        name: STORAGE_KEY,
        version: STORAGE_VERSION,
        storage,
        partialize: (s): Data => persisted(s),
        // 버전이 다르거나 파싱에 실패하면 버리고, merge에서 초기 상태 + resetNotice로 처리한다
        migrate: () => null as unknown as Data,
        // 지금은 쓰지 않는 옛 필드는 버리고 Data 필드만 가져온다
        merge: (saved, current) =>
          saved === undefined
            ? current
            : isData(saved)
              ? { ...current, ...persisted(saved) }
              : { ...current, resetNotice: true },
      },
    ),
  );

  markUnavailable = () => store.setState({ storageAvailable: false });
  // 로그인 상태에서 병동·기간이 바뀌면 디바운스 후 저장한다(화면 이동만으로는 저장하지 않음)
  store.subscribe((s, prev) => {
    if (!remote || !ready || !s.auth || (s.ward === prev.ward && s.periods === prev.periods)) return;
    cancelTimer();
    timer = setTimeout(() => void store.getState().retrySave(), SAVE_DEBOUNCE_MS);
  });
  return store;
}

export const useAppStore = createAppStore(
  () => window.localStorage,
  undefined,
  supabaseConfigured ? { load: loadWard, save: saveWard, remove: deleteWard } : undefined,
);
