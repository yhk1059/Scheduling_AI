// 클라이언트의 유일한 저장소. Zustand + persist(localStorage), 쓸 수 없으면 메모리로 동작한다.
// 상태는 매장 1개 + 기간 목록(ARCHITECTURE "상태 관리"). 이력은 확정된 기간이다.
// 로그인한 매니저의 문서를 remote(shops.data)에 저장한다(ADR-014, ADR-020). 서버 우선, 마지막 저장이 이긴다.
// localStorage는 저장 실패 때의 캐시다. 로그아웃하면 비운다.
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { availabilityRules, sameAvailability, type AvailabilitySlots } from "./availability";
import {
  carryOverFrom,
  diffAssignments,
  historyFor,
  isOperating,
  pastDayLocks,
  previousConfirmedPeriod,
  rosterChanges,
  sameCarryOver,
} from "./continuity";
import {
  COVERAGE_RULE_PREFIX,
  DEFAULT_CONFIG,
  normalizeRule,
  OFF_CODE,
  ruleShape,
  stableJson,
  STORAGE_VERSION,
  type Priority,
} from "./rules";
import {
  dateOfDay,
  dayOfDate,
  firstPeriodStart,
  monthDay,
  nextPeriod,
  periodFrom,
  validStart,
  type PeriodRange,
  type PeriodUnit,
} from "./period";
import { deleteShop, loadShop, saveShop, supabaseConfigured, type AuthUser } from "./supabase";
import type {
  CarryOverRow,
  Cmp,
  Count,
  ConstraintChange,
  ConstraintSpec,
  DiffCell,
  Employee,
  Rule,
  RuleExample,
  ScheduleRequest,
  ScheduleResult,
  ShiftChange,
  ShiftDef,
  ShopConfig,
} from "./types.gen";

export const STORAGE_KEY = "shop-scheduler";
export const COVERAGE_SOURCE_TEXT = "필요 인원 설정";
export const MAX_SHIFT_CODES = 8; // backend/domain/constants.py MAX_SHIFT_CODES
export const MAX_TAGS_PER_EMPLOYEE = 5; // backend/domain/constants.py MAX_TAGS_PER_EMPLOYEE
export const MAX_TAG_CHARS = 10; // backend/domain/constants.py MAX_TAG_CHARS
export const SAVE_DEBOUNCE_MS = 1000;

export type DayKind = "weekday" | "weekend";
export type Assignments = ScheduleResult["assignments"];
export type Hardness = "hard" | "soft";
/** 근무 코드. 매장 근무 형태(config)가 정한다 */
export type Code = string;
/** 카드 [반드시/가능하면]·중요도. 값은 setRuleValue·setRequestValue로 바꾼다. */
export interface CardPatch {
  hardness?: Hardness;
  priority?: Priority;
}

export interface ShopEmployee extends Employee {
  tags: string[];
  active: boolean;
}
export type EmployeeRow = Omit<Employee, "id">;

/** 설정 변경 카드(ADR-018 설계 §5.3). ruleIds는 이 카드에 딸린 대기 규칙 카드(새 코드를 쓰는 카드). */
export interface ShiftChangeCard {
  id: string;
  source_text: string;
  change: ShiftChange;
  ruleIds: string[];
}

export interface Shop {
  name: string;
  unit: PeriodUnit;
  /** 근무 형태(근무 코드). 한 번 쓰인 코드는 지우지 않고 끈다 */
  config: ShopConfig;
  employees: ShopEmployee[];
  /** 다음에 부여할 번호. 줄어들지 않는다 */
  nextEmployeeNo: number;
  /** scope "shop". 필요 인원(기본 규칙 cov-*)도 여기 */
  rules: ConstraintSpec[];
  pendingRules: ConstraintSpec[];
  /** 적용 대기 중인 설정 변경 카드 */
  pendingConfig: ShiftChangeCard[];
  /** v4 → v5 변환에 실패한 제약의 원문(다시 입력해 달라고 보여 준다) */
  unconverted: { source_text: string }[];
  /** 카드 표시 순서(새 카드가 앞). 적용해도 바뀌지 않는다. 옛 저장본에는 없다 */
  cardOrder?: string[];
  /** 규칙 카드 id → 예시 판정(translate 응답). 카드에 한 번만 두고 요청 본문에는 넣지 않는다 */
  examples?: Record<string, RuleExample[]>;
}

export interface PeriodVersion {
  confirmed_at: string;
  assignments: Assignments;
  /** 직전 버전 대비 바뀐 칸 */
  changed: DiffCell[];
  /** 확정 당시의 요청과 결과, 그 결과에 쓴 이월([변경 취소]). 옛 버전에는 없다 */
  requests?: ConstraintSpec[];
  result?: ScheduleResult;
  carryOverUsed?: CarryOverRow[] | null;
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
  /** 이 기간에만 바뀐 매장 규칙(제안 수락 update) */
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
  /** 확정 시점의 명단·매장 규칙 */
  snapshot: { employees: ShopEmployee[]; rules: ConstraintSpec[] } | null;
  /** 요청 카드 id → 예시 판정(translate 응답) */
  examples?: Record<string, RuleExample[]>;
  /** 직원 id → 가능 시간(링크 행에서 읽은 것). 제출하지 않은 직원은 없고, 어느 칸에도 배정되지 않는다 */
  availability: Record<string, AvailabilitySlots>;
  /** result를 만든 요청에 쓴 가능 시간. 가능 시간 변경 판정에 쓴다. */
  availabilityUsed: Record<string, AvailabilitySlots> | null;
}

/** 근무표 작성: ① 가능 시간 → ② 매장 조건 → ③ 근무표 */
export type PeriodStep = 1 | 2 | 3;

export type View =
  | { screen: "home" }
  | { screen: "setup" }
  | { screen: "settings"; tab: "roster" | "shifts" | "rules" }
  | { screen: "period"; periodId: string; step: PeriodStep }
  | { screen: "confirmed"; periodId: string };

export interface Data {
  shop: Shop | null;
  /** start_date 오름차순 */
  periods: WorkPeriod[];
  view: View;
  inputVersion: number;
}

/** 원격 매장 문서(shops 1행). 테스트에서 가짜로 주입한다. */
export interface ShopRemote {
  load(): Promise<{ data: unknown; updatedAt: string } | null>;
  save(userId: string, data: unknown): Promise<{ updatedAt: string }>;
  remove(): Promise<void>;
}

export type SyncStatus = "idle" | "loading" | "saving" | "saved" | "error";

export interface AppState extends Data {
  storageAvailable: boolean;
  resetNotice: boolean;
  // 로그인 저장 (persist 대상 아님)
  auth: { userId: string; email: string | null } | null;
  sync: { status: SyncStatus; savedAt: string | null };
  /** 로그인 직후(세션 복원 포함) 한 번. 서버 문서가 있으면 서버 우선, 없으면 캐시나 빈 매장을 올린다. */
  signedIn: (user: AuthUser) => Promise<void>;
  retrySave: () => Promise<void>;
  /** 이 브라우저의 상태와 localStorage 키를 지운다. 서버 문서는 그대로 둔다. */
  signedOut: () => void;
  /** 서버 문서를 지우고 빈 매장으로(로그인 유지). 실패하면 throw한다. */
  deleteShopData: () => Promise<void>;
  // 매장
  startShop: () => void;
  setShopName: (name: string) => void;
  setUnit: (unit: PeriodUnit) => void;
  /** 필요 인원 기본 규칙(날마다, 평일/주말·공휴일, 그 코드, min 이상·max 이하, 같으면 정확히, max null이면 이상). */
  setCoverage: (code: Code, dayKind: DayKind, min: number, max: number | null) => void;
  // 근무 형태
  /** 코드의 이름·실근무 시간·시작·끝 시각·세는 근무조를 바꾼다. O는 바꾸지 않는다. */
  setShift: (code: Code, patch: Partial<Omit<ShiftDef, "code" | "active">>) => void;
  /** 새 코드를 O 앞에 더한다. 이미 있거나 코드가 MAX_SHIFT_CODES개면 아무것도 하지 않는다. */
  addShift: (def: ShiftDef) => void;
  /** 끄면 그 코드를 세는 복합 코드도 끈다. 켜는 복합 코드의 근무조가 꺼져 있으면 아무것도 하지 않는다. */
  setShiftActive: (code: Code, active: boolean) => void;
  /** 쓰인 적 없는 코드만 지우고, 쓰였으면 끈다. */
  removeShift: (code: Code) => void;
  /** 옮기지 못한 옛 규칙 원문 하나를 목록에서 지운다(다시 입력한 뒤). */
  dismissUnconverted: (index: number) => void;
  /** 대기 카드를 더한다. changes는 설정 변경 카드가 되고, 새 코드를 쓰는 규칙 카드가 거기에 딸린다. examples는 카드 id별 예시 판정. */
  addPendingRules: (cards: ConstraintSpec[], changes?: ShiftChange[], examples?: Record<string, RuleExample[]>) => void;
  /** 규칙 카드: 딸린 설정 카드도 함께 적용한다. 설정 카드: 근무 형태만 바꾼다. */
  applyRule: (id: string) => void;
  /** 대기 카드는 그대로, 적용된 규칙은 inputVersion을 올리며 바꾼다. */
  updateRule: (id: string, patch: CardPatch) => void;
  /** 조정 가능한 값 하나를 바꾼다. 이름이 없거나 값이 0보다 작으면 아무것도 하지 않는다. */
  setRuleValue: (id: string, name: string, value: number) => void;
  /** 이상·정확히를 바꾼다(comparisonOf가 null이 아닌 규칙만). 바꿀 수 없으면 아무것도 하지 않는다. */
  setRuleComparison: (id: string, op: Comparison) => void;
  /** 설정 카드를 지우면 딸린 대기 규칙 카드도 지운다. 기본 규칙은 지우지 않고 끈다. */
  removeRule: (id: string) => void;
  /** 끈 매장 규칙(기본 규칙)을 다시 켠다. */
  enableRule: (id: string) => void;
  // 명단
  addEmployees: (rows: EmployeeRow[]) => void;
  updateEmployee: (id: string, patch: Partial<EmployeeRow>) => void;
  /** 앞뒤 공백을 지운 1~MAX_TAG_CHARS자, 사람당 MAX_TAGS_PER_EMPLOYEE개까지. 이미 있으면 아무것도 하지 않는다. */
  addTag: (employeeId: string, tag: string) => void;
  removeTag: (employeeId: string, tag: string) => void;
  setEmployeeActive: (id: string, active: boolean) => void;
  /** 어떤 기간에서도 쓰이지 않은 직원만 지운다. 아니면 비활성으로 바꾼다. */
  removeEmployee: (id: string) => void;
  // 기간
  /**
   * 초안이 있으면 그 기간을, 없으면 새 기간을 만들어 ①로 간다. 매장이 없으면 null.
   * 첫 기간은 start(기본: 오늘 이후 첫 시작일)에서 시작하고, 달력 월인데 29~31일이면 null. 다음 기간은 직전 다음 날.
   */
  createPeriod: (today: string, start?: string) => string | null;
  /** 작성 중 기간의 시작일을 바꾼다. 직전 기간 끝 다음 날보다 앞이거나 유효한 시작일이 아니면 false. */
  postponeStart: (periodId: string, date: string) => boolean;
  toggleHoliday: (periodId: string, day: number) => void;
  setCarryOver: (periodId: string, rows: CarryOverRow[]) => void;
  addPendingRequests: (periodId: string, cards: ConstraintSpec[], examples?: Record<string, RuleExample[]>) => void;
  applyRequest: (periodId: string, id: string) => void;
  updateRequest: (periodId: string, id: string, patch: CardPatch) => void;
  setRequestValue: (periodId: string, id: string, name: string, value: number) => void;
  setRequestComparison: (periodId: string, id: string, op: Comparison) => void;
  removeRequest: (periodId: string, id: string) => void;
  /** 이 기간의 disabledIds만 바꾼다. 매장 규칙·요청 원본은 그대로 둔다. */
  setDisabled: (periodId: string, constraintId: string, disabled: boolean) => void;
  /** 검증된 제안: disable → disabledIds, set_value·set_hardness → 요청은 직접, 매장 규칙은 ruleOverrides. */
  applyChanges: (periodId: string, changes: ConstraintChange[]) => void;
  /** 그 칸의 기존 고정 배정을 지우고 수동 고정 제약을 추가한다. */
  setFixed: (periodId: string, employeeId: string, day: number, shift: Code) => void;
  clearFixed: (periodId: string, employeeId: string, day: number) => void;
  /** 링크 행에서 읽은 가능 시간을 넣는다. 달라졌으면 true. 전용 배너를 쓰므로 inputVersion은 올리지 않는다. */
  setAvailability: (periodId: string, availability: Record<string, AvailabilitySlots>) => boolean;
  /** 응답 버전이 현재와 같을 때만 부른다. resultVersion = 지금의 inputVersion. usedCarryOver·usedAvailability = 그 요청에 쓴 값(가능 시간 기본값은 지금 값). */
  setResult: (periodId: string, result: ScheduleResult, usedCarryOver: CarryOverRow[], usedAvailability?: Record<string, AvailabilitySlots>) => void;
  /** 첫 확정은 버전 1개, 이미 확정된 기간은 바뀐 칸이 있을 때만 버전을 추가한다([다시 확정]). 확정 근무표 화면으로 간다. */
  confirm: (periodId: string) => void;
  /** [변경 취소]: 요청과 결과를 마지막 확정본으로 되돌린다. 되돌릴 수 없으면 아무것도 하지 않는다. */
  revertToConfirmed: (periodId: string) => void;
  // 화면
  go: (view: View) => void;
  /** 매장이 있거나 기간이 하나라도 있으면 true. */
  hasInput: () => boolean;
  /** 초기 상태로 되돌린다. 진행 중 요청의 응답을 버리도록 inputVersion은 올린다. */
  reset: () => void;
  dismissResetNotice: () => void;
}

function initialData(): Data {
  return { shop: null, periods: [], view: { screen: "home" }, inputVersion: 0 };
}

function emptyShop(): Shop {
  return {
    name: "",
    unit: "1w",
    config: DEFAULT_CONFIG,
    employees: [],
    nextEmployeeNo: 1,
    rules: [],
    pendingRules: [],
    pendingConfig: [],
    unconverted: [],
  };
}

export function newPeriod(range: PeriodRange): WorkPeriod {
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
    availability: {},
    availabilityUsed: null,
  };
}

const employeeId = (no: number) => `e${String(no).padStart(2, "0")}`;

/** 휴가 모양: 한 사람 × 날짜에 근무 없음(per=person, not_in [O], 0번). 항상 hard로 다룬다. */
export function isLeaveRule(c: ConstraintSpec): boolean {
  // 가능하면이면 휴가가 아니라 휴무 희망이다(휴가는 항상 반드시)
  const s = ruleShape(c);
  if (s?.kind !== "count" || (c.hardness ?? "hard") !== "hard") return false;
  return (
    s.per === "person" &&
    s.measure === "count" &&
    s.people.ids?.length === 1 &&
    s.shifts.not_in?.length === 1 &&
    s.shifts.not_in[0] === OFF_CODE &&
    s.max?.n === 0 &&
    !s.min
  );
}

/** 필요 인원(기본 규칙) 모양: 매장 규칙, 날마다 모든 사람의 근무 개수. 폼 모양이 아니어도(토요일만 등) 된다. */
function isStaffingRule(c: ConstraintSpec): boolean {
  const s = ruleShape(c);
  if (c.scope !== "shop" || s?.kind !== "count" || s.per !== "day" || s.measure !== "count") return false;
  const p = s.people;
  return !p.ids && !p.tags && !p.exclude_tags?.length;
}

/** 필요 인원 폼 모양: 매장 규칙, 날마다 모든 사람, 평일 또는 주말·공휴일, 코드 하나의 개수. 그 (코드, 요일 종류). */
function coverageKey(c: ConstraintSpec): { code: Code; kind: DayKind; min: number; max: number | null } | null {
  const s = ruleShape(c);
  if (c.scope !== "shop" || s?.kind !== "count") return null;
  const { people, days, shifts } = s;
  const noPeople = !people.ids && !people.tags && !people.exclude_tags?.length;
  const ok =
    s.per === "day" &&
    s.measure === "count" &&
    noPeople &&
    (days.kind === "weekday" || days.kind === "weekend") &&
    !days.weekdays &&
    !days.days &&
    shifts.in?.length === 1;
  return ok ? { code: shifts.in![0], kind: days.kind as DayKind, min: s.min?.n ?? 0, max: s.max?.n ?? null } : null;
}

/** 직급별 배치 모양: 필요 인원 폼 모양에서 사람만 직급 하나로 고른 규칙. 그 (코드, 요일 종류, 직급). */
function tagCoverageKey(c: ConstraintSpec): { code: Code; kind: DayKind; tag: string; min: number; max: number | null } | null {
  const s = ruleShape(c);
  if (c.scope !== "shop" || s?.kind !== "count") return null;
  const { people, days, shifts } = s;
  const ok =
    s.per === "day" &&
    s.measure === "count" &&
    !people.ids &&
    people.tags?.length === 1 &&
    !people.exclude_tags?.length &&
    (days.kind === "weekday" || days.kind === "weekend") &&
    !days.weekdays &&
    !days.days &&
    shifts.in?.length === 1;
  return ok ? { code: shifts.in![0], kind: days.kind as DayKind, tag: people.tags![0], min: s.min?.n ?? 0, max: s.max?.n ?? null } : null;
}

/** 요약표 한 칸의 직급별 필요 인원(직급 이름 순). 없으면 빈 배열. */
export function tagCoverage(rules: ConstraintSpec[], code: Code, kind: DayKind): { tag: string; min: number; max: number | null }[] {
  return rules
    .flatMap((c) => {
      const k = tagCoverageKey(c);
      return k?.code === code && k.kind === kind ? [{ tag: k.tag, min: k.min, max: k.max }] : [];
    })
    .sort((a, b) => a.tag.localeCompare(b.tag, "ko"));
}

/** 필요 인원 모양(폼에 나오는 규칙). */
export function isCoverageRule(c: ConstraintSpec): boolean {
  return coverageKey(c) !== null;
}

/** 필요 인원 규칙(코드·요일 종류). 폼 모양이 아닌 규칙(토요일만 등)은 찾지 않는다. */
export function coverageRule(rules: ConstraintSpec[], code: Code, kind: DayKind): ConstraintSpec | undefined {
  return rules.find((c) => {
    const k = coverageKey(c);
    return k?.code === code && k.kind === kind;
  });
}

/** 필요 인원 폼 한 칸의 범위(최소, 최대 또는 null = 이상). 폼 모양 규칙이 없으면 null. */
export function coverageRange(rules: ConstraintSpec[], code: Code, kind: DayKind): { min: number; max: number | null } | null {
  const c = coverageRule(rules, code, kind);
  const k = c ? coverageKey(c) : null;
  return k && { min: k.min, max: k.max };
}

/** 지금 근무표에서 켜져 있는 매장 규칙(이 근무표의 수정본 반영). 근무표가 없으면 매장 규칙 원본. */
export function liveShopRules(shop: Shop, period: WorkPeriod | null): ConstraintSpec[] {
  return shop.rules
    .map((r) => period?.ruleOverrides[r.id] ?? r)
    .filter((r) => r.enabled !== false && !period?.disabledIds.includes(r.id));
}

/** 근무조·필요 인원 요약표에 든 규칙 id. 이 규칙들은 ②에서 카드로 다시 보여 주지 않는다. */
export function summarizedCoverageIds(shop: Shop, period: WorkPeriod | null): string[] {
  const rules = liveShopRules(shop, period);
  return coverageCodes(shop.config).flatMap((s) =>
    (["weekday", "weekend"] as const).flatMap((kind) => coverageRule(rules, s.code, kind)?.id ?? []),
  );
}

/** 필요 인원 폼의 행: 활성 기본 코드(복합·휴무 제외). */
export function coverageCodes(config: ShopConfig): ShiftDef[] {
  return config.shifts.filter((s) => s.active !== false && !s.parts?.length && s.code !== OFF_CODE);
}

const BOUND_KEYS = ["min", "max", "min_len", "max_len", "then_off", "max_gap"];

/**
 * 교체 기준: 같은 scope와, 수(최소·최대·길이·휴무 일수·차이)를 뺀 같은 블록 모양. 블록 모양이 아니면 같은 식 본문.
 * 칸 고정은 같은 칸(employee_id·day). 휴가는 날짜별 요청이 공존해야 하므로 교체하지 않는다(null).
 */
function replaceKey(c: ConstraintSpec): string | null {
  if (c.type === "fixed_assignment") return `${c.type}|${c.scope}|${c.params.employee_id}@${c.params.day}`;
  if (isLeaveRule(c)) return null;
  const shape = ruleShape(c);
  if (shape) return `shape|${c.scope}|${stableJson(Object.fromEntries(Object.entries(shape).filter(([k]) => !BOUND_KEYS.includes(k))))}`;
  return `rule|${c.scope}|${stableJson((normalizeRule(c) as Rule).body)}`;
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
const prependOrder = (order: string[] | undefined, cards: { id: string }[]) => [...cards.map((c) => c.id), ...(order ?? [])];

/** card가 적용되면 대체할 기존 제약(같은 type·scope·대상, 다른 id). */
export function findReplaced(constraints: ConstraintSpec[], card: ConstraintSpec): ConstraintSpec | undefined {
  const key = replaceKey(card);
  if (key === null) return undefined;
  return constraints.find((c) => c.id !== card.id && replaceKey(c) === key);
}

function patched(c: ConstraintSpec, patch: CardPatch): ConstraintSpec {
  if (c.type === "fixed_assignment") return c;
  return normalizeRule({
    ...c,
    ...(patch.hardness !== undefined && !isLeaveRule(c) && { hardness: patch.hardness }),
    ...(patch.priority !== undefined && { priority: patch.priority }),
  });
}

/**
 * 조정 가능한 값 하나를 바꾼 규칙. 이름이 없거나 값이 0보다 작거나 수가 아니면 null.
 * 최대 연속(창 = 값 + 1)은 창 길이도 함께 바꾼다(창 2~14일이 아니면 null).
 */
export function withRuleValue(c: ConstraintSpec, name: string, value: number): ConstraintSpec | null {
  if (c.type !== "rule" || !c.values?.[name] || !Number.isFinite(value) || value < 0) return null;
  let next: Rule = { ...c, values: { ...c.values, [name]: { ...c.values[name], value } } };
  const shape = ruleShape(c);
  if (shape?.kind === "max_run" && shape.max_len.name === name && c.body.kind === "require") {
    if (!Number.isInteger(value) || value < 1 || value > 13) return null;
    next = { ...next, body: { ...c.body, for_each: { ...c.body.for_each, window: value + 1 } } };
  }
  return normalizeRule(next);
}

export type Comparison = "ge" | "eq";

/** 비교를 고를 수 있는 규칙의 then(비교 하나, 오른쪽이 조정 가능한 값, op ge·eq, offset 없음). 세는 모양이 아니면 null. */
function comparisonCmp(c: ConstraintSpec): (Cmp & { right: { value: string } }) | null {
  if (c.type !== "rule" || ruleShape(c)?.kind !== "count") return null;
  const r = normalizeRule(c) as Rule;
  if (r.body.kind !== "require" || r.body.when) return null;
  const then = r.body.then;
  if (!("left" in then) || then.left.offset || (then.op !== "ge" && then.op !== "eq")) return null;
  const right = then.right;
  if (typeof right !== "object" || !("value" in right) || "shifts" in right || !r.values?.[right.value]) return null;
  return then as Cmp & { right: { value: string } };
}

/** [수정] 폼에서 고를 수 있는 비교. then이 비교 하나이고 오른쪽이 조정 가능한 값이며 op가 ge·eq인 세기 규칙만. 아니면 null. */
export function comparisonOf(c: ConstraintSpec): Comparison | null {
  return (comparisonCmp(c)?.op as Comparison | undefined) ?? null;
}

/** 비교를 바꾼 규칙(normalizeRule 적용). 바꿀 수 없는 규칙이면 null. 값 label은 "최소 인원" ↔ "인원"처럼 "최소 " 접두사를 넣고 뺀다. */
export function withRuleComparison(c: ConstraintSpec, op: Comparison): ConstraintSpec | null {
  const then = comparisonCmp(c);
  if (!then || c.type !== "rule" || c.body.kind !== "require") return null;
  const r = normalizeRule(c) as Rule;
  const name = then.right.value;
  const v = r.values![name];
  const label = op === "eq" ? v.label.replace(/^최소 /, "") : v.label.startsWith("최소 ") ? v.label : `최소 ${v.label}`;
  return normalizeRule({
    ...r,
    values: { ...r.values, [name]: { ...v, label } },
    body: { ...(r.body as typeof c.body), then: { ...then, op } },
  });
}

/** 검증된 제안 변경 하나(set_value·set_hardness)를 규칙에 반영한다. 반영할 수 없으면 그대로. */
function changed(c: ConstraintSpec, ch: ConstraintChange): ConstraintSpec {
  if (ch.action === "set_value") return withRuleValue(c, ch.name ?? "", ch.value ?? -1) ?? c;
  if (ch.action === "set_hardness" && ch.hardness) return patched(c, { hardness: ch.hardness });
  return c;
}

/** 카드 예시를 더한다(예시가 있는 카드만). */
function withExamples(
  map: Record<string, RuleExample[]> | undefined,
  cards: ConstraintSpec[],
  examples: Record<string, RuleExample[]>,
): Record<string, RuleExample[]> | undefined {
  const add = cards.filter((c) => examples[c.id]?.length).map((c) => [c.id, examples[c.id]] as const);
  return add.length ? { ...map, ...Object.fromEntries(add) } : map;
}

/** 카드 예시를 지운다. */
function withoutExamples(map: Record<string, RuleExample[]> | undefined, ids: string[]): Record<string, RuleExample[]> | undefined {
  if (!map || !ids.some((id) => id in map)) return map;
  return Object.fromEntries(Object.entries(map).filter(([id]) => !ids.includes(id)));
}

function isFixedCell(c: ConstraintSpec, employeeId: string, day: number): boolean {
  return c.type === "fixed_assignment" && c.params.employee_id === employeeId && c.params.day === day;
}

/** 규칙의 모든 세기(비교 양쪽). */
function ruleCounts(r: Rule): Count[] {
  if (r.body.kind === "balance") return [];
  const cmps = [r.body.when, r.body.then].flatMap((c) => (!c ? [] : "all" in c ? c.all : "any" in c ? c.any : [c]));
  return cmps.flatMap((c) => [c.left, ...(typeof c.right === "object" && "shifts" in c.right ? [c.right] : [])]);
}

/** 제약이 직접 가리키는 직원 id(칸 고정의 employee_id, 규칙의 범위·세기·고르게 사람 셀렉터의 ids). */
export function refEmployees(c: ConstraintSpec): string[] {
  if (c.type === "fixed_assignment") return [c.params.employee_id];
  const people = c.body.kind === "balance" ? [c.body.people] : [c.body.for_each.people, ...ruleCounts(c).map((n) => n.who)];
  return people.flatMap((p) => p?.ids ?? []);
}

/** 제약이 직접 적은 근무 코드. */
export function ruleCodes(c: ConstraintSpec): Code[] {
  const sel = (x: { in?: string[] | null; not_in?: string[] | null } | null | undefined) => [...(x?.in ?? []), ...(x?.not_in ?? [])];
  if (c.type === "fixed_assignment") return [c.params.shift];
  if (c.body.kind === "balance") return sel(c.body.shifts);
  return ruleCounts(c).flatMap((n) => sel(n.shifts));
}

/** 근무 형태에 설정 변경 하나를 반영한다. 추가는 O 앞에, 수정은 같은 코드 자리에. */
export function applyShiftChange(config: ShopConfig, change: ShiftChange): ShopConfig {
  const shift = { ...change.shift, active: change.shift.active ?? true };
  const i = config.shifts.findIndex((s) => s.code === shift.code);
  if (i !== -1) return { shifts: config.shifts.map((s, j) => (j === i ? shift : s)) as ShopConfig["shifts"] };
  if (change.action !== "add") return config;
  const off = config.shifts.findIndex((s) => s.code === OFF_CODE);
  const at = off === -1 ? config.shifts.length : off;
  return { shifts: [...config.shifts.slice(0, at), shift, ...config.shifts.slice(at)] as ShopConfig["shifts"] };
}

/** 근무 코드가 매장 규칙·기간 요청·이월·결과·확정본·복합 코드에서 쓰였는지. */
export function isShiftUsed(code: Code, shop: Shop, periods: WorkPeriod[]): boolean {
  const inRules = (list: ConstraintSpec[]) => list.some((c) => ruleCodes(c).includes(code));
  const inRows = (rows: Record<string, string[]>) => Object.values(rows).some((r) => r.includes(code));
  if (shop.config.shifts.some((s) => s.parts?.includes(code))) return true;
  if (inRules(shop.rules) || inRules(shop.pendingRules)) return true;
  return periods.some(
    (p) =>
      inRules(p.requests) ||
      inRules(p.pendingRequests) ||
      inRules(Object.values(p.ruleOverrides)) ||
      p.carryOver.some((r) => r.shifts.includes(code)) ||
      (p.result !== null && inRows(p.result.assignments)) ||
      p.versions.some((v) => inRows(v.assignments) || inRules(v.requests ?? [])) ||
      inRules(p.snapshot?.rules ?? []),
  );
}

/** 이 기간을 풀 때 쓰는 명단과 매장 규칙 원본. 확정된 기간은 확정 시점의 것을 쓴다(PRD J1). */
function basis(shop: Shop, period: WorkPeriod): { employees: ShopEmployee[]; rules: ConstraintSpec[] } {
  return period.status === "confirmed" && period.snapshot ? period.snapshot : shop;
}

/**
 * 기간 하나의 /solve·/explain 요청 본문(input_version 제외).
 * 이월·누적 부담·지난 날짜 잠금은 요청할 때마다 periods와 today로 다시 계산한다(ADR-015).
 */
export function toScheduleRequest(
  shop: Shop,
  period: WorkPeriod,
  periods: WorkPeriod[],
  today: string,
): Omit<ScheduleRequest, "input_version"> {
  const { employees, rules } = basis(shop, period);
  const active = employees.filter((n) => n.active);
  const activeIds = active.map((n) => n.id);
  const ids = new Set(activeIds);
  const liveCoverage = new Set(coverageCodes(shop.config).map((s) => s.code));
  const locks = isOperating(period, today) ? pastDayLocks(period, active, today) : [];
  const locked = new Set(locks.map((c) => `${c.params.employee_id}@${c.params.day}`));
  const constraints = [...rules.map((r) => period.ruleOverrides[r.id] ?? r), ...period.requests]
    .filter((c) => refEmployees(c).every((id) => ids.has(id)))
    // 지난 날짜 잠금이 같은 칸의 수동 고정보다 우선한다
    .filter((c) => !(c.type === "fixed_assignment" && locked.has(`${c.params.employee_id}@${c.params.day}`)))
    // 필요 인원 폼에 행이 없는 코드(꺼진 코드)의 필요 인원은 지킬 수 없으므로 끈다
    .map((c) => {
      const cov = coverageKey(c);
      return period.disabledIds.includes(c.id) || (cov && !liveCoverage.has(cov.code)) ? { ...c, enabled: false } : c;
    });
  const previous = period.result
    ? Object.fromEntries(Object.entries(period.result.assignments).filter(([id]) => ids.has(id)))
    : null;
  // 꺼진 칸 고정은 지키지 않으므로 가능 시간도 그대로 적용한다
  const fixedCells = [...constraints, ...locks].flatMap((c) =>
    c.type === "fixed_assignment" && c.enabled !== false ? [c.params] : [],
  );
  const availability = availabilityRules(active, shop.config, period, period.availability, fixedCells);
  const prev = previousConfirmedPeriod(periods, period);
  return {
    config: shop.config,
    employees: active.map(({ id, name, tags }) => ({ id, name, tags })) as ScheduleRequest["employees"],
    period: { start_date: period.start_date, length: period.length },
    holidays: period.holidays,
    constraints: [...constraints, ...availability, ...locks],
    carry_over: prev ? carryOverFrom(prev, activeIds) : period.carryOver.filter((r) => ids.has(r.employee_id)),
    history: historyFor(periods, period, activeIds),
    ...(previous && { previous }),
  };
}

/** 마지막 생성에 쓴 이월과 지금 지난 확정본에서 계산한 이월이 다른지(초안·확정 모두, PRD J4). */
export function carryOverChanged(period: WorkPeriod, periods: WorkPeriod[]): boolean {
  if (!period.carryOverUsed) return false;
  const prev = previousConfirmedPeriod(periods, period);
  if (!prev) return false;
  const ids = period.result ? Object.keys(period.result.assignments) : period.carryOverUsed.map((r) => r.employee_id);
  return !sameCarryOver(period.carryOverUsed, carryOverFrom(prev, ids));
}

/** 마지막 생성에 쓴 가능 시간과 지금 가능 시간이 다른지. */
export function availabilityChanged(period: WorkPeriod): boolean {
  return period.availabilityUsed !== null && !sameAvailability(period.availabilityUsed, period.availability);
}

/** [변경 취소]를 보여 줄지: 마지막 확정본에 요청이 남아 있고, 배정이나 요청이 그 뒤로 바뀌었다. */
export function canRevertToConfirmed(period: WorkPeriod): boolean {
  const last = period.versions.at(-1);
  if (period.status !== "confirmed" || !last?.requests || !last.result) return false;
  return hasUnconfirmedChanges(period) || JSON.stringify(last.requests) !== JSON.stringify(period.requests);
}

/** 확정된 기간에서 현재 결과가 최신 확정본과 다른지([다시 확정] 활성화). */
export function hasUnconfirmedChanges(period: WorkPeriod): boolean {
  const last = period.versions.at(-1);
  if (period.status !== "confirmed" || !period.result || !last) return false;
  return diffAssignments(last.assignments, period.result.assignments).length > 0;
}

/** 새로 만들 기간 범위. 마지막 기간 다음 날부터, 기간이 없으면 today 이후 첫 시작일(기본 제안값)부터. */
export function upcomingRange(unit: PeriodUnit, periods: WorkPeriod[], today: string): PeriodRange {
  const last = periods.at(-1);
  return last ? nextPeriod(unit, last) : periodFrom(unit, firstPeriodStart(unit, today));
}

export type NextPeriodState = { state: "none" } | { state: "draft" | "confirmed"; period: WorkPeriod };

/** 매장 홈: 운영 중 기간, 오늘 이후 시작하는 가장 늦은 기간(지금 할 일), 최근 기간(시작일 내림차순). */
export function homeSummary(
  periods: WorkPeriod[],
  today: string,
): { operating: WorkPeriod | null; next: NextPeriodState; recent: WorkPeriod[] } {
  const recent = [...periods].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const upcoming = recent.find((p) => p.start_date > today);
  return {
    operating: periods.find((p) => isOperating(p, today)) ?? null,
    next: upcoming ? { state: upcoming.status, period: upcoming } : { state: "none" },
    recent,
  };
}

/** 근무표 작성 ①의 준비 요약을 펼칠지: 명단이 지난 확정 근무표와 다르거나, 이어지는 근무가 바뀌었다. */
export function prepareNeedsReview(shop: Shop, periods: WorkPeriod[], periodId: string): boolean {
  const period = periods.find((p) => p.id === periodId);
  if (!period) return false;
  const { added, deactivated } = rosterChangesFor(shop, periods, periodId);
  return added.length > 0 || deactivated.length > 0 || carryOverChanged(period, periods);
}

/** 필요 인원 폼의 모든 행(활성 기본 코드 × 평일/주말·공휴일)이 채워졌는지. */
export function hasCoverage(shop: Shop): boolean {
  return coverageCodes(shop.config).every(
    (s) => coverageRule(shop.rules, s.code, "weekday") && coverageRule(shop.rules, s.code, "weekend"),
  );
}

/** 활성 직원이 있으면 근무표를 만들 수 있다(필요 인원은 필수가 아니다, ADR-019). */
export function isShopReady(shop: Shop): boolean {
  return shop.employees.some((n) => n.active);
}

/** 근무표를 열 때의 화면: 확정 → 확정 근무표, 결과 있음 → 작성 ③, 그 밖 → 작성 ①. */
export function viewForPeriod(period: WorkPeriod): View {
  if (period.status === "confirmed") return { screen: "confirmed", periodId: period.id };
  return { screen: "period", periodId: period.id, step: period.result ? 3 : 1 };
}

/** 불러온 화면 상태를 지금 화면 구성에 맞춘다(ADR-017). 근무표가 없는 매장은 매장 준비로 연다. */
function normalizeView(d: Data): View {
  const { shop, periods, view } = d;
  if (shop && periods.length === 0) return { screen: "setup" };
  if (view.screen === "setup") return { screen: "home" };
  if (view.screen === "period" || view.screen === "confirmed") {
    const { periodId } = view;
    const period = periods.find((p) => p.id === periodId);
    if (!period) return { screen: "home" };
    if (period.status === "confirmed") return { screen: "confirmed", periodId };
    return view.screen === "period" && [1, 2, 3].includes(view.step) ? view : viewForPeriod(period);
  }
  return view;
}

/** ① 준비의 명단 점검: 이 기간 이전 마지막 확정 기간의 snapshot 대비 추가·비활성화된 직원. */
export function rosterChangesFor(
  shop: Shop,
  periods: WorkPeriod[],
  periodId: string,
): ReturnType<typeof rosterChanges> {
  const period = periods.find((p) => p.id === periodId);
  const prev = period
    ? (periods.filter((p) => p.status === "confirmed" && p.start_date < period.start_date).at(-1) ?? null)
    : null;
  return rosterChanges(prev, shop.employees);
}

/** 활성 명단에 없는 직원을 가리키는 매장 규칙·요청 id. */
export function orphanConstraintIds(shop: Shop, period: WorkPeriod | null): string[] {
  const ids = new Set(shop.employees.filter((n) => n.active).map((n) => n.id));
  return [...shop.rules, ...(period?.requests ?? [])]
    .filter((c) => refEmployees(c).some((id) => !ids.has(id)))
    .map((c) => c.id);
}

/** 지금 화면의 기간. 기간 화면이 아니면 첫 초안, 없으면 마지막 기간. */
export function currentPeriod(s: Pick<Data, "periods" | "view">): WorkPeriod | null {
  if (s.view.screen === "period" || s.view.screen === "confirmed") {
    const { periodId } = s.view;
    const found = s.periods.find((p) => p.id === periodId);
    if (found) return found;
  }
  return s.periods.find((p) => p.status === "draft") ?? s.periods.at(-1) ?? null;
}

/** 어떤 기간의 요청·결과·확정본·이월에서 쓰이거나, 매장 규칙이 참조하는 직원인지. */
export function isEmployeeUsed(id: string, shop: Shop, periods: WorkPeriod[]): boolean {
  const refs = (list: ConstraintSpec[]) => list.some((c) => refEmployees(c).includes(id));
  if (refs(shop.rules) || refs(shop.pendingRules)) return true;
  return periods.some(
    (p) =>
      refs(p.requests) ||
      refs(p.pendingRequests) ||
      p.carryOver.some((r) => r.employee_id === id) ||
      (p.result !== null && id in p.result.assignments) ||
      p.versions.some((v) => id in v.assignments) ||
      (p.snapshot?.employees.some((n) => n.id === id) ?? false),
  );
}

function isData(v: unknown): v is Data {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  const w = d.shop as Record<string, unknown> | null | undefined;
  const view = d.view as Record<string, unknown> | undefined;
  const shopOk =
    w === null ||
    (typeof w === "object" &&
      w !== undefined &&
      ["employees", "rules", "pendingRules", "pendingConfig", "unconverted"].every((k) => Array.isArray(w[k])) &&
      Array.isArray((w.config as { shifts?: unknown } | undefined)?.shifts) &&
      typeof w.nextEmployeeNo === "number" &&
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
        (p.carryOverUsed === null || Array.isArray(p.carryOverUsed)) &&
        typeof p.availability === "object" &&
        p.availability !== null &&
        typeof p.availabilityUsed === "object",
    );
  return shopOk && periodsOk && typeof view?.screen === "string" && typeof d.inputVersion === "number";
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
  shop: s.shop,
  periods: s.periods,
  view: s.view,
  inputVersion: s.inputVersion,
});

/** 불러온 문서: Data 필드만 가져오고 옛 화면 상태를 바꾼다. */
const loaded = (s: Data): Data => {
  const d = persisted(s);
  return { ...d, view: normalizeView(d) };
};

export function createAppStore(getStorage: () => Storage, now: () => Date = () => new Date(), remote?: ShopRemote) {
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
        /** 매장이 있을 때만 바꾼다. */
        const editShop = (fn: (w: Shop) => Shop, version = true) => {
          const { shop } = get();
          if (!shop) return;
          if (version) bump({ shop: fn(shop) });
          else set({ shop: fn(shop) });
        };
        const editPeriod = (periodId: string, fn: (p: WorkPeriod) => WorkPeriod, version = true) => {
          const { periods } = get();
          if (!periods.some((p) => p.id === periodId)) return;
          const next = periods.map((p) => (p.id === periodId ? fn(p) : p));
          if (version) bump({ periods: next });
          else set({ periods: next });
        };
        const withIds = (w: Shop, rows: EmployeeRow[]): Shop => ({
          ...w,
          employees: [
            ...w.employees,
            ...rows.map(({ name, tags }, i) => ({
              id: employeeId(w.nextEmployeeNo + i),
              name,
              tags: tags ?? [],
              active: true,
            })),
          ],
          nextEmployeeNo: w.nextEmployeeNo + rows.length,
        });
        const editEmployee = (id: string, fn: (n: ShopEmployee) => ShopEmployee) =>
          editShop((w) => ({ ...w, employees: w.employees.map((n) => (n.id === id ? fn(n) : n)) }));
        const editShifts = (fn: (shifts: ShiftDef[]) => ShiftDef[]) =>
          editShop((w) => ({ ...w, config: { shifts: fn(w.config.shifts) as ShopConfig["shifts"] } }));
        /** 설정 카드를 적용한다: 근무 형태를 바꾸고 대기 목록에서 뺀다. */
        const withConfigCard = (w: Shop, card: ShiftChangeCard): Shop => ({
          ...w,
          config: applyShiftChange(w.config, card.change),
          pendingConfig: w.pendingConfig.filter((c) => c.id !== card.id),
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
        /** 상태를 통째로 바꾼다. 진행 중 요청의 응답을 버리도록 inputVersion은 지금보다 크게 하고, 문서에서 최신이던 결과는 최신으로 둔다. */
        const replace = (data: Data, extra: Partial<AppState> = {}) =>
          set((s) => {
            const inputVersion = Math.max(s.inputVersion, data.inputVersion) + 1;
            const periods = data.periods.map((p) => (p.resultVersion === data.inputVersion ? { ...p, resultVersion: inputVersion } : p));
            return { ...data, periods, inputVersion, ...extra };
          });
        const emptyShopData = (): Data => ({ ...initialData(), shop: emptyShop(), view: { screen: "setup" } });

        return {
          ...initialData(),
          storageAvailable: available,
          resetNotice: false,
          auth: null,
          sync: { status: "idle", savedAt: null },

          signedIn: async (user) => {
            if (!remote) return;
            ready = false;
            cancelTimer();
            set({ auth: { userId: user.id, email: user.email }, sync: { status: "loading", savedAt: null } });
            let row: Awaited<ReturnType<ShopRemote["load"]>>;
            try {
              row = await remote.load();
            } catch {
              set((s) => ({ sync: { ...s.sync, status: "error" } }));
              return;
            }
            if (get().auth?.userId !== user.id) return;
            if (row) {
              // 서버 우선
              const d = row.data as { version?: unknown; state?: unknown } | null;
              const state = d?.version === STORAGE_VERSION ? d.state : null;
              const ok = isData(state);
              replace(ok ? loaded(state) : emptyShopData(), {
                sync: { status: "saved", savedAt: row.updatedAt },
                ...(!ok && { resetNotice: true }),
              });
              ready = true;
              return;
            }
            // 첫 저장이 실패한 채 다시 열었으면 캐시를 올린다
            if (!get().hasInput()) replace(emptyShopData());
            ready = true;
            await save();
          },
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
            replace(initialData(), { auth: null, sync: { status: "idle", savedAt: null } });
            storage.removeItem(STORAGE_KEY);
          },
          deleteShopData: async () => {
            if (!remote || !get().auth) return;
            cancelTimer();
            await remote.remove();
            // 지운 직후 빈 매장을 다시 올리지 않는다. 사용자가 바꾸면 그때 저장한다
            ready = false;
            replace(emptyShopData(), { sync: { status: "saved", savedAt: null } });
            ready = true;
          },

          startShop: () => bump({ shop: emptyShop(), periods: [], view: { screen: "setup" } }),
          setShopName: (name) => editShop((w) => ({ ...w, name })),
          setUnit: (unit) => editShop((w) => ({ ...w, unit })),
          setCoverage: (code, dayKind, min, max) => {
            if (!(min >= 0) || (max !== null && !(max >= min))) return;
            editShop((w) => {
              // 폼 모양의 같은 칸 규칙을 제자리에서 바꾼다(id는 그대로)
              const old = coverageRule(w.rules, code, dayKind);
              const left: Count = { shifts: { in: [code] } };
              const ge: Cmp = { left, op: "ge", right: { value: "min" } };
              const le: Cmp = { left, op: "le", right: { value: "max" } };
              const card = normalizeRule({
                id: old?.id ?? `${COVERAGE_RULE_PREFIX}${dayKind}-${code}`,
                type: "rule",
                scope: "shop",
                hardness: "hard",
                source_text: COVERAGE_SOURCE_TEXT,
                default: true,
                values:
                  max === min
                    ? { min: { value: min, label: "인원" } }
                    : {
                        min: { value: min, label: "최소 인원" },
                        ...(max !== null && { max: { value: max, label: "최대 인원" } }),
                      },
                body: {
                  kind: "require",
                  for_each: { per: "day", days: { kind: dayKind } },
                  then: max === min ? { left, op: "eq", right: { value: "min" } } : max === null ? ge : { all: [ge, le] },
                },
              } as ConstraintSpec);
              return { ...w, rules: old ? w.rules.map((c) => (c === old ? card : c)) : [...w.rules, card] };
            });
          },
          setShift: (code, patch) => {
            if (code === OFF_CODE) return;
            editShifts((shifts) => shifts.map((s) => (s.code === code ? { ...s, ...patch } : s)));
          },
          addShift: (def) => {
            const shifts = get().shop?.config.shifts ?? [];
            if (shifts.length >= MAX_SHIFT_CODES || shifts.some((s) => s.code === def.code)) return;
            editShop((w) => ({ ...w, config: applyShiftChange(w.config, { action: "add", shift: def }) }));
          },
          setShiftActive: (code, active) => {
            const shifts = get().shop?.config.shifts ?? [];
            const shift = shifts.find((s) => s.code === code);
            if (!shift || code === OFF_CODE) return;
            const parts = shift.parts ?? [];
            if (active && parts.some((p) => shifts.find((s) => s.code === p)?.active === false)) return;
            editShifts((list) =>
              list.map((s) => (s.code === code || (!active && s.parts?.includes(code)) ? { ...s, active } : s)),
            );
          },
          removeShift: (code) => {
            const { shop, periods } = get();
            if (!shop || code === OFF_CODE) return;
            if (isShiftUsed(code, shop, periods)) get().setShiftActive(code, false);
            else editShifts((shifts) => shifts.filter((s) => s.code !== code));
          },
          dismissUnconverted: (index) =>
            editShop((w) => ({ ...w, unconverted: w.unconverted.filter((_, i) => i !== index) }), false),
          addPendingRules: (cards, changes = [], examples = {}) =>
            editShop((w) => {
              // 말로 만든 필요 인원도 기본 규칙 카드다(ADR-019)
              const blocks = cards
                .map(normalizeRule)
                .map((c) => (c.type === "rule" && !c.default && isStaffingRule(c) ? { ...c, default: true } : c));
              const taken = new Set(w.pendingConfig.map((c) => c.id));
              const configCards = changes.map((change): ShiftChangeCard => {
                const base = `cfg-${change.shift.code}`;
                let id = base;
                for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
                taken.add(id);
                return {
                  id,
                  source_text: cards[0]?.source_text ?? "",
                  change,
                  ruleIds:
                    change.action === "add"
                      ? blocks.filter((c) => ruleCodes(c).includes(change.shift.code)).map((c) => c.id)
                      : [],
                };
              });
              return {
                ...w,
                pendingRules: [...w.pendingRules, ...blocks],
                pendingConfig: [...w.pendingConfig, ...configCards],
                cardOrder: prependOrder(w.cardOrder, [...configCards, ...blocks]),
                examples: withExamples(w.examples, blocks, examples),
              };
            }, false),
          applyRule: (id) => {
            const shop = get().shop;
            const config = shop?.pendingConfig.find((c) => c.id === id);
            if (config) {
              editShop((w) => withConfigCard(w, config));
              return;
            }
            const card = shop?.pendingRules.find((c) => c.id === id);
            if (!card) return;
            const parent = shop!.pendingConfig.find((c) => c.ruleIds.includes(id));
            editShop((w) => {
              const next = parent ? withConfigCard(w, parent) : w;
              const replaced = findReplaced(next.rules, card);
              return {
                ...next,
                pendingRules: next.pendingRules.filter((c) => c.id !== id),
                rules: upsert(next.rules, card),
                examples: withoutExamples(next.examples, replaced ? [replaced.id] : []),
              };
            });
          },
          updateRule: (id, patch) => {
            const w = get().shop;
            if (w?.pendingRules.some((c) => c.id === id)) {
              editShop((w) => ({ ...w, pendingRules: w.pendingRules.map((c) => (c.id === id ? patched(c, patch) : c)) }), false);
            } else if (w?.rules.some((c) => c.id === id)) {
              editShop((w) => ({ ...w, rules: w.rules.map((c) => (c.id === id ? patched(c, patch) : c)) }));
            }
          },
          setRuleValue: (id, name, value) => {
            const w = get().shop;
            const pending = w?.pendingRules.find((c) => c.id === id);
            const applied = w?.rules.find((c) => c.id === id);
            const next = (pending ?? applied) && withRuleValue((pending ?? applied)!, name, value);
            if (!next) return;
            const swap = (list: ConstraintSpec[]) => list.map((c) => (c.id === id ? next : c));
            // 예시는 옛 값으로 판정한 것이라 지운다
            if (pending) editShop((w) => ({ ...w, pendingRules: swap(w.pendingRules), examples: withoutExamples(w.examples, [id]) }), false);
            else editShop((w) => ({ ...w, rules: swap(w.rules), examples: withoutExamples(w.examples, [id]) }));
          },
          setRuleComparison: (id, op) => {
            const w = get().shop;
            const pending = w?.pendingRules.find((c) => c.id === id);
            const applied = w?.rules.find((c) => c.id === id);
            const next = (pending ?? applied) && withRuleComparison((pending ?? applied)!, op);
            if (!next) return;
            const swap = (list: ConstraintSpec[]) => list.map((c) => (c.id === id ? next : c));
            if (pending) editShop((w) => ({ ...w, pendingRules: swap(w.pendingRules), examples: withoutExamples(w.examples, [id]) }), false);
            else editShop((w) => ({ ...w, rules: swap(w.rules), examples: withoutExamples(w.examples, [id]) }));
          },
          removeRule: (id) => {
            const w = get().shop;
            const config = w?.pendingConfig.find((c) => c.id === id);
            if (config) {
              editShop(
                (w) => ({
                  ...w,
                  pendingConfig: w.pendingConfig.filter((c) => c.id !== id),
                  pendingRules: w.pendingRules.filter((c) => !config.ruleIds.includes(c.id)),
                  examples: withoutExamples(w.examples, config.ruleIds),
                }),
                false,
              );
            } else if (w?.pendingRules.some((c) => c.id === id)) {
              editShop(
                (w) => ({ ...w, pendingRules: w.pendingRules.filter((c) => c.id !== id), examples: withoutExamples(w.examples, [id]) }),
                false,
              );
            } else if (w?.rules.some((c) => c.id === id)) {
              const rule = w.rules.find((c) => c.id === id)!;
              // 기본 규칙(필요 인원)은 지우지 않고 끈다
              if (rule.type === "rule" && rule.default) {
                editShop((w) => ({ ...w, rules: w.rules.map((c) => (c.id === id ? { ...c, enabled: false } : c)) }));
              } else {
                editShop((w) => ({ ...w, rules: w.rules.filter((c) => c.id !== id), examples: withoutExamples(w.examples, [id]) }));
              }
            }
          },

          enableRule: (id) => {
            if (get().shop?.rules.find((c) => c.id === id)?.enabled !== false) return;
            editShop((w) => ({ ...w, rules: w.rules.map((c) => (c.id === id ? { ...c, enabled: true } : c)) }));
          },

          addEmployees: (rows) => editShop((w) => withIds(w, rows)),
          updateEmployee: (id, patch) => editEmployee(id, (n) => ({ ...n, ...patch, tags: patch.tags ?? n.tags })),
          setEmployeeActive: (id, active) => editEmployee(id, (n) => ({ ...n, active })),
          addTag: (employeeId, tag) => {
            const t = tag.trim();
            const employee = get().shop?.employees.find((n) => n.id === employeeId);
            if (!employee || !t || t.length > MAX_TAG_CHARS || employee.tags.includes(t) || employee.tags.length >= MAX_TAGS_PER_EMPLOYEE) return;
            editEmployee(employeeId, (n) => ({ ...n, tags: [...n.tags, t] }));
          },
          removeTag: (employeeId, tag) => {
            if (!get().shop?.employees.find((n) => n.id === employeeId)?.tags.includes(tag)) return;
            editEmployee(employeeId, (n) => ({ ...n, tags: n.tags.filter((t) => t !== tag) }));
          },
          removeEmployee: (id) => {
            const { shop, periods } = get();
            if (!shop) return;
            if (isEmployeeUsed(id, shop, periods)) get().setEmployeeActive(id, false);
            else editShop((w) => ({ ...w, employees: w.employees.filter((n) => n.id !== id) }));
          },

          createPeriod: (today, start) => {
            const { shop, periods } = get();
            if (!shop) return null;
            const draft = periods.find((p) => p.status === "draft");
            if (draft) {
              set({ view: viewForPeriod(draft) });
              return draft.id;
            }
            if (periods.length === 0 && start !== undefined && !validStart(shop.unit, start)) return null;
            const range =
              periods.length === 0 && start !== undefined
                ? periodFrom(shop.unit, start)
                : upcomingRange(shop.unit, periods, today);
            const period = newPeriod(range);
            bump({ periods: [...periods, period], view: { screen: "period", periodId: period.id, step: 1 } });
            return period.id;
          },
          postponeStart: (periodId, date) => {
            const { shop, periods } = get();
            const period = periods.find((p) => p.id === periodId);
            if (!shop || !period || period.status !== "draft" || !validStart(shop.unit, date)) return false;
            const prev = periods.filter((p) => p.id !== periodId && p.start_date < period.start_date).at(-1);
            if (prev && date < dateOfDay(prev, prev.length + 1)) return false;
            const range = periodFrom(shop.unit, date);
            editPeriod(periodId, (p) => ({
              ...p,
              ...range,
              // 공휴일은 같은 날짜를 새 인덱스로 옮긴다
              holidays: p.holidays
                .map((d) => dayOfDate(range, dateOfDay(p, d)))
                .filter((d): d is number => d !== null),
              result: null,
              resultVersion: null,
              carryOverUsed: null,
              // 시작일이 바뀌면 링크를 새로 만들므로 받은 가능 시간도 없어진다
              availability: {},
              availabilityUsed: null,
            }));
            return true;
          },
          toggleHoliday: (periodId, day) =>
            editPeriod(periodId, (p) => ({
              ...p,
              holidays: p.holidays.includes(day)
                ? p.holidays.filter((d) => d !== day)
                : [...p.holidays, day].sort((a, b) => a - b),
            })),
          setCarryOver: (periodId, carryOver) => editPeriod(periodId, (p) => ({ ...p, carryOver })),
          addPendingRequests: (periodId, cards, examples = {}) =>
            editPeriod(
              periodId,
              (p) => {
                const blocks = cards.map(normalizeRule);
                return {
                  ...p,
                  pendingRequests: [...p.pendingRequests, ...blocks],
                  cardOrder: prependOrder(p.cardOrder, blocks),
                  examples: withExamples(p.examples, blocks, examples),
                };
              },
              false,
            ),
          applyRequest: (periodId, id) => {
            const card = get().periods.find((p) => p.id === periodId)?.pendingRequests.find((c) => c.id === id);
            if (!card) return;
            editPeriod(periodId, (p) => {
              const replaced = findReplaced(p.requests, card);
              return {
                ...p,
                pendingRequests: p.pendingRequests.filter((c) => c.id !== id),
                requests: upsert(p.requests, card),
                examples: withoutExamples(p.examples, replaced ? [replaced.id] : []),
              };
            });
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
          setRequestValue: (periodId, id, name, value) => {
            const period = get().periods.find((p) => p.id === periodId);
            const pending = period?.pendingRequests.find((c) => c.id === id);
            const applied = period?.requests.find((c) => c.id === id);
            const next = (pending ?? applied) && withRuleValue((pending ?? applied)!, name, value);
            if (!next) return;
            const swap = (list: ConstraintSpec[]) => list.map((c) => (c.id === id ? next : c));
            if (pending)
              editPeriod(periodId, (p) => ({ ...p, pendingRequests: swap(p.pendingRequests), examples: withoutExamples(p.examples, [id]) }), false);
            else editPeriod(periodId, (p) => ({ ...p, requests: swap(p.requests), examples: withoutExamples(p.examples, [id]) }));
          },
          setRequestComparison: (periodId, id, op) => {
            const period = get().periods.find((p) => p.id === periodId);
            const pending = period?.pendingRequests.find((c) => c.id === id);
            const applied = period?.requests.find((c) => c.id === id);
            const next = (pending ?? applied) && withRuleComparison((pending ?? applied)!, op);
            if (!next) return;
            const swap = (list: ConstraintSpec[]) => list.map((c) => (c.id === id ? next : c));
            if (pending)
              editPeriod(periodId, (p) => ({ ...p, pendingRequests: swap(p.pendingRequests), examples: withoutExamples(p.examples, [id]) }), false);
            else editPeriod(periodId, (p) => ({ ...p, requests: swap(p.requests), examples: withoutExamples(p.examples, [id]) }));
          },
          removeRequest: (periodId, id) => {
            const period = get().periods.find((p) => p.id === periodId);
            if (period?.pendingRequests.some((c) => c.id === id)) {
              editPeriod(
                periodId,
                (p) => ({ ...p, pendingRequests: p.pendingRequests.filter((c) => c.id !== id), examples: withoutExamples(p.examples, [id]) }),
                false,
              );
            } else if (period?.requests.some((c) => c.id === id)) {
              editPeriod(periodId, (p) => ({ ...p, requests: p.requests.filter((c) => c.id !== id), examples: withoutExamples(p.examples, [id]) }));
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
            const { shop } = get();
            if (!shop) return;
            editPeriod(periodId, (p) => {
              const rules = basis(shop, p).rules;
              let next = p;
              for (const ch of changes) {
                if (ch.action === "disable") {
                  if (!next.disabledIds.includes(ch.constraint_id))
                    next = { ...next, disabledIds: [...next.disabledIds, ch.constraint_id] };
                } else if (next.requests.some((c) => c.id === ch.constraint_id)) {
                  next = { ...next, requests: next.requests.map((c) => (c.id === ch.constraint_id ? changed(c, ch) : c)) };
                } else {
                  const rule = next.ruleOverrides[ch.constraint_id] ?? rules.find((r) => r.id === ch.constraint_id);
                  if (rule) next = { ...next, ruleOverrides: { ...next.ruleOverrides, [rule.id]: changed(rule, ch) } };
                }
              }
              return next;
            });
          },
          setFixed: (periodId, employeeId, day, shift) => {
            const name = get().shop?.employees.find((n) => n.id === employeeId)?.name ?? employeeId;
            editPeriod(periodId, (p) => ({
              ...p,
              requests: [
                ...p.requests.filter((c) => !isFixedCell(c, employeeId, day)),
                {
                  id: `fix-${employeeId}-${day}`,
                  type: "fixed_assignment",
                  scope: "period",
                  hardness: "hard",
                  weight: 1,
                  source_text: `수동 고정: ${name} ${monthDay(p, day)} ${shift}`,
                  enabled: true,
                  params: { employee_id: employeeId, day, shift },
                },
              ],
            }));
          },
          clearFixed: (periodId, employeeId, day) =>
            editPeriod(periodId, (p) => ({ ...p, requests: p.requests.filter((c) => !isFixedCell(c, employeeId, day)) })),
          setAvailability: (periodId, availability) => {
            const period = get().periods.find((p) => p.id === periodId);
            if (!period || sameAvailability(period.availability, availability)) return false;
            editPeriod(periodId, (p) => ({ ...p, availability }), false);
            return true;
          },
          setResult: (periodId, result, usedCarryOver, usedAvailability) => {
            const v = get().inputVersion;
            editPeriod(
              periodId,
              (p) => ({ ...p, result, resultVersion: v, carryOverUsed: usedCarryOver, availabilityUsed: usedAvailability ?? p.availability }),
              false,
            );
          },
          confirm: (periodId) => {
            const { shop } = get();
            if (!shop || !get().periods.find((p) => p.id === periodId)?.result) return;
            editPeriod(
              periodId,
              (p) => {
                if (!p.result) return p;
                const last = p.versions.at(-1);
                const changed = p.status === "confirmed" && last ? diffAssignments(last.assignments, p.result.assignments) : [];
                if (p.status === "confirmed" && last && changed.length === 0) return p;
                const version = {
                  confirmed_at: now().toISOString(),
                  assignments: p.result.assignments,
                  changed,
                  requests: p.requests,
                  result: p.result,
                  carryOverUsed: p.carryOverUsed,
                };
                return {
                  ...p,
                  status: "confirmed",
                  versions: [...p.versions, version],
                  snapshot: p.snapshot ?? { employees: shop.employees.filter((n) => n.active), rules: shop.rules },
                };
              },
              false,
            );
            set({ view: { screen: "confirmed", periodId } });
          },
          revertToConfirmed: (periodId) => {
            const period = get().periods.find((p) => p.id === periodId);
            const last = period?.versions.at(-1);
            if (!period || !canRevertToConfirmed(period) || !last?.requests || !last.result) return;
            const { requests, result } = last;
            const carryOverUsed = last.carryOverUsed === undefined ? period.carryOverUsed : last.carryOverUsed;
            editPeriod(periodId, (p) => ({ ...p, requests, result, carryOverUsed, resultVersion: get().inputVersion + 1 }));
          },

          go: (view) => set({ view }),
          hasInput: () => get().shop !== null || get().periods.length > 0,
          reset: () => bump(initialData()),
          dismissResetNotice: () => set({ resetNotice: false }),
        };
      },
      {
        name: STORAGE_KEY,
        version: STORAGE_VERSION,
        storage,
        partialize: (s): Data => persisted(s),
        // 다른 버전이나 파싱 실패는 변환하지 않고 버린다. merge에서 초기 상태 + resetNotice로 처리한다
        migrate: () => null as unknown as Data,
        // 지금은 쓰지 않는 옛 필드는 버리고 Data 필드만 가져온다
        merge: (saved, current) =>
          saved === undefined
            ? current
            : isData(saved)
              ? { ...current, ...loaded(saved) }
              : { ...current, resetNotice: true },
      },
    ),
  );

  markUnavailable = () => store.setState({ storageAvailable: false });
  // 로그인 상태에서 매장·기간이 바뀌면 디바운스 후 저장한다(화면 이동만으로는 저장하지 않음)
  store.subscribe((s, prev) => {
    if (!remote || !ready || !s.auth || (s.shop === prev.shop && s.periods === prev.periods)) return;
    cancelTimer();
    timer = setTimeout(() => void store.getState().retrySave(), SAVE_DEBOUNCE_MS);
  });
  return store;
}

export const useAppStore = createAppStore(
  () => window.localStorage,
  undefined,
  supabaseConfigured ? { load: loadShop, save: saveShop, remove: deleteShop } : undefined,
);
