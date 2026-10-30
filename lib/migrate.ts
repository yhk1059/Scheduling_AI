// 저장 문서 변환(STORAGE_VERSION 4 → 5 → 6)과 블록 ↔ 식 변환. 순수 함수.
// 템플릿 → 블록(convert-cases.json), 블록 → 식(expr-convert-cases.json)은 backend/domain/convert.py와 같다.
import { isWeekendDay, periodEnd, type PeriodRange } from "./period";
import type { Data, PeriodVersion, ShiftChangeCard, Ward, WardNurse, WorkPeriod } from "./store";
import type { Cmp, ConstraintSpec, Count, Days, FixedAssignment, People, Rule, Shifts, Value, ValueRef, WardConfig } from "./types.gen";

/** 저장 문서 버전. 6 = 식 규칙(ADR-019) */
export const STORAGE_VERSION = 6;
export const NIGHT_ONLY_TAG = "나이트전담"; // backend/domain/constants.py NIGHT_ONLY_TAG
export const NIGHT_ONLY_RULE_ID = "night-only"; // backend/domain/convert.py
export const COVERAGE_RULE_PREFIX = "cov-"; // backend/domain/convert.py DEFAULT_RULE_PREFIX
export const OFF_CODE = "O";
/** 중요도 → 가중치. backend/domain/constants.py PRIORITY_WEIGHTS */
export const PRIORITY_WEIGHTS = { high: 30, normal: 10, low: 5 } as const;
export type Priority = keyof typeof PRIORITY_WEIGHTS;
const DEFAULT_WEIGHT = PRIORITY_WEIGHTS.normal;

/** 기본 근무 형태: D/E/N 8시간 + O(backend/domain/constants.py DEFAULT_SHIFTS). */
export const DEFAULT_CONFIG: WardConfig = {
  shifts: [
    { code: "D", name: "데이", hours: 8 },
    { code: "E", name: "이브닝", hours: 8 },
    { code: "N", name: "나이트", hours: 8 },
    { code: OFF_CODE, name: "휴무", hours: 0 },
  ],
};

// --- v5에 저장된 블록(ADR-018). 요청 형식에서는 빠졌고 저장 문서 이전에만 쓴다 ---

interface BlockBase {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  priority?: Priority;
}
export interface CountParams {
  people?: People;
  days?: Days;
  shifts: Shifts;
  per: "day" | "person" | "person_week" | "person_window";
  window?: number | null;
  measure?: "count" | "hours";
  min?: number | null;
  max?: number | null;
}
export interface SequenceParams {
  people?: People;
  forbid?: Shifts[][] | null;
  run?: Shifts | null;
  min_len?: number | null;
  max_len?: number | null;
  after?: Shifts | null;
  then_off?: number | null;
}
export interface BalanceParams {
  people?: People;
  days?: Days;
  shifts: Shifts;
  measure?: "count" | "hours";
  with_history?: boolean;
  max_gap?: number;
}
export type Block = BlockBase &
  ({ type: "count"; params: CountParams } | { type: "sequence"; params: SequenceParams } | { type: "balance"; params: BalanceParams });
/** v5에 저장된 제약: 블록 또는 칸 고정. */
export type BlockSpec = Block | FixedAssignment;

// --- 블록 기본값 ---

const DEFAULTS: Record<Block["type"], { hardness: "hard" | "soft"; priority: Priority }> = {
  count: { hardness: "hard", priority: "normal" },
  sequence: { hardness: "hard", priority: "normal" },
  balance: { hardness: "soft", priority: "low" },
};

/** null·undefined 값을 지운다. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;
}

const people = (p: People | undefined): People => ({ ...compact(p ?? {}), exclude_tags: p?.exclude_tags ?? [] });
const days = (d: Days | undefined): Days => ({ ...compact(d ?? {}), kind: d?.kind ?? "all" });
const shifts = (s: Shifts): Shifts => compact(s);

/**
 * 블록의 생략된 기본값을 채우고 null을 지운다(Pydantic dump(exclude_none)와 같은 모양).
 * weight는 중요도에서 정한다(백엔드도 입력 weight를 무시한다). 칸 고정은 항상 hard.
 */
export function normalizeBlock(c: BlockSpec): BlockSpec {
  if (c.type === "fixed_assignment") {
    return { ...c, hardness: "hard", weight: c.weight ?? DEFAULT_WEIGHT, enabled: c.enabled ?? true };
  }
  const d = DEFAULTS[c.type];
  const priority = c.priority ?? d.priority;
  const base = {
    id: c.id,
    scope: c.scope,
    hardness: c.hardness ?? d.hardness,
    weight: PRIORITY_WEIGHTS[priority],
    source_text: c.source_text,
    enabled: c.enabled ?? true,
    priority,
  };
  switch (c.type) {
    case "count": {
      const p = c.params;
      return {
        ...base,
        type: "count",
        params: compact({
          people: people(p.people),
          days: days(p.days),
          shifts: shifts(p.shifts),
          per: p.per,
          window: p.window,
          measure: p.measure ?? "count",
          min: p.min,
          max: p.max,
        }),
      };
    }
    case "sequence": {
      const p = c.params;
      return {
        ...base,
        type: "sequence",
        params: compact({
          people: people(p.people),
          forbid: p.forbid?.map((pattern) => pattern.map(shifts)) as typeof p.forbid,
          run: p.run ? shifts(p.run) : null,
          min_len: p.min_len,
          max_len: p.max_len,
          after: p.after ? shifts(p.after) : null,
          then_off: p.then_off,
        }),
      };
    }
    case "balance": {
      const p = c.params;
      return {
        ...base,
        type: "balance",
        params: {
          people: people(p.people),
          days: days(p.days),
          shifts: shifts(p.shifts),
          measure: p.measure ?? "count",
          with_history: p.with_history ?? true,
          max_gap: p.max_gap ?? 1,
        },
      };
    }
  }
}

/** 기본 규칙 "나이트 전담은 나이트와 휴무만"의 블록 모양(v5 저장 형식). */
export function nightOnlyBlock(): BlockSpec {
  return normalizeBlock({
    id: NIGHT_ONLY_RULE_ID,
    type: "count",
    scope: "ward",
    hardness: "hard",
    source_text: "나이트 전담은 나이트와 휴무만",
    params: { people: { tags: [NIGHT_ONLY_TAG] }, shifts: { not_in: ["N", OFF_CODE] }, per: "person", max: 0 },
  });
}

/** 기본 규칙 "나이트 전담은 나이트와 휴무만"(hard, default). 태그만 붙이면 동작한다. */
export function nightOnlyRule(): ConstraintSpec {
  return blockToRules(nightOnlyBlock())[0];
}

// --- 템플릿 12종(v4 저장 형식) → 블록 ---

/** v4에 저장된 템플릿 제약. params는 검사하기 전이라 unknown으로 둔다. */
export interface LegacySpec {
  id: string;
  type: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
}

const SOFT_BY_DEFAULT = ["shift_preference", "night_fairness", "weekend_fairness"];
const LOW_BY_DEFAULT = ["night_fairness", "weekend_fairness"];

function bad(spec: LegacySpec): never {
  throw new Error(`변환할 수 없는 제약: ${spec.id} (${spec.type})`);
}

const isInt = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;
const isDays = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.every((d) => isInt(d, 1));

function code(spec: LegacySpec, v: unknown, allowed: string[]): string {
  return typeof v === "string" && allowed.includes(v) ? v : bad(spec);
}

/** 희망 근무의 대상 날짜 수(희망 = 그 날짜 모두 맞추기). */
function preferenceTargetDays(spec: LegacySpec, dayList: number[] | null, weekendsOnly: boolean, period?: PeriodRange, holidays: number[] = []): number {
  if (dayList && !weekendsOnly) return dayList.length;
  if (!period) bad(spec);
  const all = dayList ?? Array.from({ length: period.length }, (_, i) => i + 1);
  return weekendsOnly ? all.filter((d) => isWeekendDay(period, d, holidays)).length : all.length;
}

function blockParams(spec: LegacySpec, period?: PeriodRange, holidays: number[] = []): [Block["type"], Record<string, unknown>] {
  const p = spec.params ?? {};
  const DEN = ["D", "E", "N"];
  const DENO = [...DEN, OFF_CODE];
  const daysParam = () => (isInt(p.days, 1) ? p.days : bad(spec));
  switch (spec.type) {
    case "daily_coverage":
      if (!isInt(p.min) || !isInt(p.max) || !["weekday", "weekend"].includes(p.day_kind as string)) bad(spec);
      return ["count", { days: { kind: p.day_kind }, shifts: { in: [code(spec, p.shift, DEN)] }, per: "day", min: p.min, max: p.max }];
    case "forbidden_sequence":
      return ["sequence", { forbid: [[{ in: [code(spec, p.first, DENO)] }, { in: [code(spec, p.second, DENO)] }]] }];
    case "max_consecutive_work":
      return ["sequence", { run: { not_in: [OFF_CODE] }, max_len: daysParam() }];
    case "max_consecutive_nights":
      return ["sequence", { run: { in: ["N"] }, max_len: daysParam() }];
    case "min_days_off":
      if (!isInt(p.days)) bad(spec);
      return ["count", { shifts: { in: [OFF_CODE] }, per: "person", min: p.days }];
    case "off_after_night_block":
      return ["sequence", { after: { in: ["N"] }, then_off: daysParam() }];
    case "skill_mix":
      if (!isInt(p.min_years) || !isInt(p.min_count)) bad(spec);
      return ["count", { people: { min_years: p.min_years }, shifts: { in: [code(spec, p.shift, DEN)] }, per: "day", min: p.min_count }];
    case "leave":
      if (typeof p.nurse_id !== "string" || !isDays(p.days)) bad(spec);
      return ["count", { people: { ids: [p.nurse_id] }, days: { days: p.days }, shifts: { not_in: [OFF_CODE] }, per: "person", max: 0 }];
    case "shift_preference": {
      const dayList = p.days ?? null;
      const weekendsOnly = p.weekends_only ?? false;
      if (typeof p.nurse_id !== "string" || typeof p.prefer !== "boolean" || typeof weekendsOnly !== "boolean") bad(spec);
      if (dayList !== null && !isDays(dayList)) bad(spec);
      const d: Days = { ...(weekendsOnly && { kind: "weekend" }), ...(dayList && { days: dayList }) };
      const bound = p.prefer ? { min: preferenceTargetDays(spec, dayList, weekendsOnly, period, holidays) } : { max: 0 };
      return ["count", { people: { ids: [p.nurse_id] }, days: d, shifts: { in: [code(spec, p.shift, DENO)] }, per: "person", ...bound }];
    }
    case "night_fairness":
      return ["balance", { people: { exclude_tags: [NIGHT_ONLY_TAG] }, shifts: { in: ["N"] } }];
    case "weekend_fairness":
      return ["balance", { days: { kind: "weekend" }, shifts: { not_in: [OFF_CODE] } }];
  }
  bad(spec);
}

/** soft면 weight에 가장 가까운 중요도(같으면 높음 → 보통 → 낮음 순), hard면 블록 기본값. */
function priorityOf(hardness: "hard" | "soft", weight: number, type: Block["type"]): Priority {
  if (hardness === "hard") return DEFAULTS[type].priority;
  return (Object.keys(PRIORITY_WEIGHTS) as Priority[]).reduce((best, k) =>
    Math.abs(PRIORITY_WEIGHTS[k] - weight) < Math.abs(PRIORITY_WEIGHTS[best] - weight) ? k : best,
  );
}

/**
 * 템플릿 제약 하나를 블록으로(설계 §2.5). 블록과 칸 고정은 기본값만 채운다.
 * 희망 근무(전체 기간·주말만)는 대상 날짜 수를 세려고 period가 필요하다. 변환할 수 없으면 throw한다.
 */
export function legacyToBlock(spec: LegacySpec, period?: PeriodRange, holidays: number[] = []): BlockSpec {
  if (["count", "sequence", "balance", "fixed_assignment"].includes(spec.type)) {
    return normalizeBlock(spec as unknown as BlockSpec);
  }
  const [type, params] = blockParams(spec, period, holidays);
  const hardness = spec.type === "leave" ? "hard" : (spec.hardness ?? (SOFT_BY_DEFAULT.includes(spec.type) ? "soft" : "hard"));
  const weight = spec.weight ?? (LOW_BY_DEFAULT.includes(spec.type) ? PRIORITY_WEIGHTS.low : DEFAULT_WEIGHT);
  return normalizeBlock({
    id: spec.id,
    type,
    scope: spec.scope,
    hardness,
    priority: priorityOf(hardness, weight, type),
    source_text: spec.source_text,
    enabled: spec.enabled ?? true,
    params,
  } as unknown as BlockSpec);
}

// --- 저장 문서 v4 → v5 ---

type LegacyNurse = Omit<WardNurse, "tags"> & { night_only?: boolean; tags?: string[] };

function isV4(v: unknown): boolean {
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
        ["holidays", "requests", "pendingRequests", "disabledIds", "carryOver", "versions"].every((k) => Array.isArray(p[k])),
    );
  return wardOk && periodsOk && typeof view?.screen === "string" && typeof d.inputVersion === "number";
}

/** 옛 명단 한 사람: night_only를 나이트전담 태그로 바꾼다(저장 문서 이전). */
export function tagged<T extends object>({ night_only, tags, ...n }: T & { night_only?: boolean; tags?: string[] }): Omit<T, "night_only" | "tags"> & { tags: string[] } {
  const base = tags ?? [];
  return { ...(n as Omit<T, "night_only" | "tags">), tags: night_only && !base.includes(NIGHT_ONLY_TAG) ? [...base, NIGHT_ONLY_TAG] : base };
}

// --- v5 저장 문서 모양(규칙·요청이 블록) ---

type Lists<T> = { requests: T[]; pendingRequests: T[]; ruleOverrides: Record<string, T> };
export interface WardV5 extends Omit<Ward, "rules" | "pendingRules" | "introSeen" | "examples"> {
  rules: BlockSpec[];
  pendingRules: BlockSpec[];
}
export interface PeriodV5 extends Omit<WorkPeriod, keyof Lists<unknown> | "versions" | "snapshot" | "examples">, Lists<BlockSpec> {
  versions: (Omit<PeriodVersion, "requests"> & { requests?: BlockSpec[] })[];
  snapshot: { nurses: WardNurse[]; rules: BlockSpec[] } | null;
}
export interface DataV5 {
  ward: WardV5 | null;
  periods: PeriodV5[];
  view: Data["view"];
  inputVersion: number;
}

const isStale = (p: { result?: unknown; status: string } & PeriodRange, today: string) =>
  p.result !== null && p.result !== undefined && (p.status === "draft" || today <= periodEnd(p));

/**
 * v4 저장 상태 → v5. 모양이 v4가 아니면 null.
 * - 근무 형태는 기본값, 명단의 night_only는 나이트전담 태그, 템플릿 제약은 블록(id·원문·켜짐·hardness 유지).
 * - 기본 규칙 "나이트 전담은 나이트와 휴무만"을 병동 규칙에 넣는다.
 * - 변환하지 못한 제약은 원문만 ward.unconverted로 옮긴다. 문서 전체를 버리지 않는다.
 * - 옛 결과는 형식을 그대로 두고, 작성 중이거나 끝나지 않은 확정 기간의 결과는 stale(resultVersion -1)로 둔다.
 */
export function migrateV4(state: unknown, today: string): DataV5 | null {
  if (!isV4(state)) return null;
  const s = state as Omit<DataV5, "ward"> & { ward: (Record<string, unknown> & { nurses: LegacyNurse[] }) | null };
  const unconverted: { source_text: string }[] = [];
  const convert = (list: unknown[], period?: PeriodRange, holidays: number[] = []): BlockSpec[] =>
    (list as LegacySpec[]).flatMap((c) => {
      try {
        return [legacyToBlock(c, period, holidays)];
      } catch {
        unconverted.push({ source_text: c?.source_text ?? "" });
        return [];
      }
    });

  const w = s.ward;
  const rules = w ? convert(w.rules as unknown[]) : [];
  const pendingRules = w ? convert(w.pendingRules as unknown[]) : [];

  const periods = s.periods.map((p): PeriodV5 => {
    const conv = (list: unknown[]) => convert(list, p, p.holidays);
    const overrides = Object.entries(p.ruleOverrides ?? {}).flatMap(([id, c]) => conv([c]).map((b) => [id, b] as const));
    return {
      ...p,
      requests: conv(p.requests),
      pendingRequests: conv(p.pendingRequests),
      ruleOverrides: Object.fromEntries(overrides),
      versions: p.versions.map((v) => (v.requests ? { ...v, requests: conv(v.requests) } : v)),
      snapshot: p.snapshot
        ? { nurses: (p.snapshot.nurses as LegacyNurse[]).map(tagged), rules: conv(p.snapshot.rules) }
        : null,
      ...(isStale(p, today) && { resultVersion: -1 }),
    };
  });

  const ward = w && {
    ...(w as unknown as WardV5),
    config: DEFAULT_CONFIG,
    nurses: w.nurses.map(tagged),
    rules: rules.some((r) => r.id === NIGHT_ONLY_RULE_ID) ? rules : [...rules, nightOnlyBlock()],
    pendingRules,
    pendingConfig: [] as ShiftChangeCard[],
    unconverted,
  };
  return { ward, periods, view: s.view, inputVersion: s.inputVersion };
}

// --- 식 규칙 기본값(Pydantic dump(exclude_none)와 같은 모양) ---

const isRef = (v: unknown): v is ValueRef => typeof v === "object" && v !== null && "value" in v && !("shifts" in v);
const isCount = (v: unknown): v is Count => typeof v === "object" && v !== null && "shifts" in v;
type Cond = Cmp | { all: Cmp[] } | { any: Cmp[] };

function normCount(c: Count): Count {
  return compact({
    who: c.who ? people(c.who) : null,
    days: days(c.days),
    offset: c.offset ?? null,
    shifts: shifts(c.shifts),
    measure: c.measure ?? "count",
  });
}

function normCmp(c: Cmp): Cmp {
  const right = typeof c.right === "number" ? c.right : isCount(c.right) ? normCount(c.right) : { value: c.right.value };
  return { left: normCount(c.left), op: c.op, right };
}

function normCond(c: Cond): Cond {
  if ("all" in c) return { all: c.all.map(normCmp) };
  if ("any" in c) return { any: c.any.map(normCmp) };
  return normCmp(c);
}

/** 규칙의 생략된 기본값을 채우고 null을 지운다. weight는 중요도에서 정한다. 칸 고정은 블록과 같다. */
export function normalizeRule(c: ConstraintSpec): ConstraintSpec {
  if (c.type === "fixed_assignment") return normalizeBlock(c) as FixedAssignment;
  const b = c.body;
  const balance = b.kind === "balance";
  const priority = c.priority ?? (balance ? "low" : "normal");
  const body: Rule["body"] =
    b.kind === "balance"
      ? {
          kind: "balance",
          people: people(b.people),
          days: days(b.days),
          shifts: shifts(b.shifts),
          measure: b.measure ?? "count",
          with_history: b.with_history ?? true,
          max_gap: isRef(b.max_gap) ? { value: b.max_gap.value } : (b.max_gap ?? 1),
        }
      : compact({
          kind: "require",
          for_each: compact({ per: b.for_each.per, people: people(b.for_each.people), days: days(b.for_each.days), window: b.for_each.window }),
          when: b.when ? (normCond(b.when) as never) : null,
          then: normCond(b.then) as never,
        });
  return {
    id: c.id,
    type: "rule",
    scope: c.scope,
    hardness: c.hardness ?? (balance ? "soft" : "hard"),
    priority,
    weight: PRIORITY_WEIGHTS[priority],
    source_text: c.source_text,
    enabled: c.enabled ?? true,
    default: c.default ?? false,
    values: Object.fromEntries(Object.entries(c.values ?? {}).map(([k, v]) => [k, { value: v.value, label: v.label }])),
    body,
  };
}

// --- 블록 → 식(설계 §2.5, backend/domain/convert.py block_to_rules) ---

/** 식 상한(backend/domain/constants.py): 창 2~14일, offset −7..+14·폭 14, 그리고/또는 2~4개, 비교 6개, 값 5개. */
const LIMITS = { window: [2, 14], offset: [-7, 14], span: 14, cond: [2, 4], cmps: 6, values: 5 } as const;

const condCmps = (c: Cond | null | undefined): Cmp[] => (!c ? [] : "all" in c ? c.all : "any" in c ? c.any : [c]);

/** 백엔드 Rule 검증 중 변환에서 어길 수 있는 상한만 본다. 어기면 throw. */
function checkRule(r: Rule): Rule {
  const fail = (why: string): never => {
    throw new Error(`식으로 바꿀 수 없는 규칙 ${r.id}: ${why}`);
  };
  if (Object.keys(r.values ?? {}).length > LIMITS.values) fail("값이 너무 많음");
  const b = r.body;
  if (b.kind === "balance") return r;
  const w = b.for_each.window;
  if (w != null && (w < LIMITS.window[0] || w > LIMITS.window[1])) fail(`창 ${w}일`);
  for (const c of [b.when, b.then]) if (c && !("left" in c) && condCmps(c).length < LIMITS.cond[0]) fail("그리고/또는 개수");
  for (const c of [b.when, b.then]) if (c && condCmps(c).length > LIMITS.cond[1]) fail("그리고/또는 개수");
  const cmps = [...condCmps(b.when), ...condCmps(b.then)];
  if (cmps.length === 0 || cmps.length > LIMITS.cmps) fail("비교 개수");
  for (const n of cmps.flatMap((c) => [c.left, ...(isCount(c.right) ? [c.right] : [])])) {
    const [a, z] = (n.offset ?? [0, 0]) as number[];
    if (a < LIMITS.offset[0] || z > LIMITS.offset[1] || a > z || z - a + 1 > LIMITS.span) fail(`offset ${a}..${z}`);
  }
  return r;
}

/** not S: in ↔ not_in. */
const flip = (s: Shifts): Shifts => (s.in ? { not_in: s.in } : { in: s.not_in! });
const noPeople = (p: People | undefined) =>
  !p?.ids && !p?.tags && !p?.exclude_tags?.length && p?.min_years == null && p?.max_years == null;
const cnt = (s: Shifts, offset?: [number, number], extra: Partial<Count> = {}): Count => ({ ...extra, ...(offset && { offset }), shifts: s });
const cmp = (left: Count, op: Cmp["op"], right: Cmp["right"]): Cmp => ({ left, op, right });
type Body = Rule["body"];
type Values = Record<string, Value>;
const require = (for_each: Extract<Body, { kind: "require" }>["for_each"], then: Cond, when?: Cond): Body =>
  ({ kind: "require", for_each, then, ...(when && { when }) }) as Body;

/** 세기 블록 값 label의 명사: 인원·휴무 일수·근무 시간·횟수. */
function countNoun(p: CountParams): string {
  if (p.measure === "hours") return "근무 시간";
  if (p.per === "day") return "인원";
  if (p.shifts.in?.length === 1 && p.shifts.in[0] === OFF_CODE) return "휴무 일수";
  return "횟수";
}

function countBodies(p: CountParams): [Body, Values][] {
  const noun = countNoun(p);
  const left = cnt(p.shifts, undefined, p.measure === "hours" ? { measure: "hours" } : {});
  const forEach =
    p.per === "day"
      ? { per: "day" as const, days: p.days }
      : { per: p.per, people: p.people, days: p.days, ...(p.window != null && { window: p.window }) };
  if (p.per === "day" && !noPeople(p.people)) left.who = p.people;
  const values: Values = {};
  const cmps: Cmp[] = [];
  if (p.min != null && p.min === p.max) {
    values.min = { value: p.min, label: noun };
    cmps.push(cmp(left, "eq", { value: "min" }));
  } else {
    if (p.min != null) {
      values.min = { value: p.min, label: `최소 ${noun}` };
      cmps.push(cmp(left, "ge", { value: "min" }));
    }
    if (p.max != null) {
      values.max = { value: p.max, label: `최대 ${noun}` };
      cmps.push(cmp(left, "le", { value: "max" }));
    }
  }
  return [[require(forEach, cmps.length === 1 ? cmps[0] : ({ all: cmps } as Cond)), values]];
}

function runNoun(run: Shifts): string {
  if (run.in?.length === 1 && run.in[0] === "N") return "나이트";
  if (run.not_in?.length === 1 && run.not_in[0] === OFF_CODE) return "근무";
  return "일수";
}

function sequenceBodies(p: SequenceParams): [Body, Values][] {
  const forEach = { per: "person_day" as const, people: p.people };
  const out: [Body, Values][] = [];
  for (const pattern of p.forbid ?? []) {
    out.push([require(forEach, { any: pattern.map((s, i) => cmp(cnt(s, [i, i]), "eq", 0)) } as Cond), {}]);
  }
  if (p.run) {
    const run = p.run;
    if (p.max_len != null) {
      const then = cmp(cnt(run), "le", { value: "max_len" });
      out.push([
        require({ per: "person_window", people: p.people, window: p.max_len + 1 }, then),
        { max_len: { value: p.max_len, label: `최대 연속 ${runNoun(run)}` } },
      ]);
    }
    if (p.min_len != null && p.min_len > 1) {
      const when = { all: [cmp(cnt(flip(run), [-1, -1]), "ge", 1), cmp(cnt(run, [0, 0]), "ge", 1)] } as Cond;
      out.push([require(forEach, cmp(cnt(flip(run), [1, p.min_len - 1]), "eq", 0), when), {}]);
    }
    if (out.length === 0) throw new Error("min_len 1만 있는 순서 블록은 식으로 바꿀 규칙이 없습니다");
  }
  if (p.after) {
    const when = { all: [cmp(cnt(p.after, [0, 0]), "ge", 1), cmp(cnt(flip(p.after), [1, 1]), "ge", 1)] } as Cond;
    out.push([require(forEach, cmp(cnt({ not_in: [OFF_CODE] }, [1, p.then_off!]), "eq", 0), when), {}]);
  }
  return out;
}

function balanceBodies(p: BalanceParams): [Body, Values][] {
  const { max_gap = 1, ...rest } = p;
  return [[{ kind: "balance", ...rest, max_gap: { value: "max_gap" } }, { max_gap: { value: max_gap, label: "최대 차이" } }]];
}

const isDefaultId = (id: string) => id.startsWith(COVERAGE_RULE_PREFIX) || id === NIGHT_ONLY_RULE_ID;

/**
 * 블록 하나를 식 규칙 목록으로. 금지 패턴 여럿·run의 min_len과 max_len은 규칙을 나눈다(둘째부터 id에 -2, -3…).
 * 숫자 min·max·max_len·max_gap은 values로 옮긴다. 칸 고정과 이미 식인 규칙은 기본값만 채운 한 개짜리 목록이다.
 * 식으로 바꿀 수 없으면 throw한다.
 */
export function blockToRules(spec: BlockSpec | ConstraintSpec): ConstraintSpec[] {
  if (spec.type === "rule" || spec.type === "fixed_assignment") return [normalizeRule(spec as ConstraintSpec)];
  const b = normalizeBlock(spec) as Block;
  const bodies = b.type === "count" ? countBodies(b.params) : b.type === "sequence" ? sequenceBodies(b.params) : balanceBodies(b.params);
  if (bodies.length === 0) throw new Error(`식으로 바꿀 규칙이 없는 블록 ${b.id}`);
  return bodies.map(([body, values], i) =>
    checkRule(
      normalizeRule({
        id: i === 0 ? b.id : `${b.id}-${i + 1}`,
        type: "rule",
        scope: b.scope,
        hardness: b.hardness,
        priority: b.priority,
        source_text: b.source_text,
        enabled: b.enabled,
        default: isDefaultId(b.id),
        values,
        body,
      }) as Rule,
    ),
  );
}

// --- 식 → 블록 모양(카드 제목·문장·필요 인원 폼이 읽는다) ---

/** 키를 정렬한 JSON(모양 비교용). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}
const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** 식 안의 수. name이 있으면 조정 가능한 값(values의 이름)이다. */
export interface Bound {
  n: number;
  name?: string;
}

/** 변환표(설계 §2.5)의 블록 모양. 프리셋 카드 제목·문장과 필요 인원 폼이 이 모양을 읽는다. */
export type RuleShape =
  | ({ kind: "count" } & Required<Pick<CountParams, "people" | "days" | "shifts" | "per" | "measure">> & {
      window?: number;
      min?: Bound;
      max?: Bound;
    })
  | { kind: "forbid"; people: People; pattern: Shifts[] }
  | { kind: "max_run"; people: People; run: Shifts; max_len: Bound }
  | { kind: "min_run"; people: People; run: Shifts; min_len: number }
  | { kind: "off_after"; people: People; after: Shifts; then_off: number }
  | ({ kind: "balance" } & Required<Omit<BalanceParams, "max_gap">> & { max_gap: Bound });

const DEFAULT_DAYS = days(undefined);
/** offset 없이(또는 주어진 offset으로) who·days 없이 개수를 센다. */
function plainCount(c: Count, offset?: [number, number]): boolean {
  const off = (c.offset as number[] | null | undefined) ?? null;
  return !c.who && same(c.days, DEFAULT_DAYS) && c.measure === "count" && (offset ? !!off && off[0] === offset[0] && off[1] === offset[1] : !off);
}

/**
 * 규칙이 변환표의 블록 모양이면 그 모양, 아니면 null(조건부·짝·세기끼리 비교 같은 새 식).
 * 숫자는 Bound로(값이면 이름 포함). 최대 연속은 창 = 값 + 1이고 값 이름이 max_len이거나 숫자일 때만이다.
 */
export function ruleShape(c: ConstraintSpec): RuleShape | null {
  if (c.type !== "rule") return null;
  const r = normalizeRule(c) as Rule;
  const values = r.values ?? {};
  const bound = (v: unknown): Bound | null =>
    typeof v === "number" ? { n: v } : isRef(v) && values[v.value] ? { n: values[v.value].value, name: v.value } : null;
  const b = r.body;
  if (b.kind === "balance") {
    const gap = bound(b.max_gap);
    const { people, days, shifts, measure, with_history } = b;
    return gap && ({ kind: "balance", people, days, shifts, measure, with_history, max_gap: gap } as RuleShape);
  }
  const fe = b.for_each;
  const people = fe.people!;
  const then = b.then as Cond;
  const eq0 = (x: Cmp) => x.op === "eq" && x.right === 0;
  const ge1 = (x: Cmp) => x.op === "ge" && x.right === 1;

  if (fe.per === "person_day" && same(fe.days, DEFAULT_DAYS)) {
    if (!b.when && "any" in then) {
      const ok = then.any.every((x, i) => plainCount(x.left, [i, i]) && eq0(x));
      return ok ? { kind: "forbid", people, pattern: then.any.map((x) => x.left.shifts) } : null;
    }
    if (b.when && "all" in b.when && b.when.all.length === 2 && "left" in then && eq0(then)) {
      const [x, y] = b.when.all;
      const off = then.left.offset as number[] | null | undefined;
      if (!ge1(x) || !ge1(y) || !off || off[0] !== 1 || !plainCount(then.left, [1, off[1]])) return null;
      // 최소 연속: 전날 S 아님 ∧ 그날 S → 다음 k−1일 S 아님
      if (plainCount(x.left, [-1, -1]) && plainCount(y.left, [0, 0]) && same(x.left.shifts, flip(y.left.shifts)) && same(then.left.shifts, x.left.shifts))
        return { kind: "min_run", people, run: y.left.shifts, min_len: off[1] + 1 };
      // 다음 휴무: 그날 S ∧ 다음 날 S 아님 → 다음 k일 휴무
      if (plainCount(x.left, [0, 0]) && plainCount(y.left, [1, 1]) && same(y.left.shifts, flip(x.left.shifts)) && same(then.left.shifts, { not_in: [OFF_CODE] }))
        return { kind: "off_after", people, after: x.left.shifts, then_off: off[1] };
    }
    return null;
  }
  if (b.when) return null;
  const cmps = condCmps(then);
  if (!("left" in then) && !("all" in then && cmps.length === 2)) return null;
  const left = cmps[0].left;
  if (!cmps.every((x) => same(x.left, left) && !x.left.offset && bound(x.right))) return null;
  if (fe.per === "person_window" && "left" in then && then.op === "le" && plainCount(left) && same(fe.days, DEFAULT_DAYS)) {
    const max = bound(then.right)!;
    if (fe.window === max.n + 1 && (max.name === undefined || max.name === "max_len")) return { kind: "max_run", people, run: left.shifts, max_len: max };
  }
  if (fe.per === "period" || fe.per === "person_day" || !same(left.days, DEFAULT_DAYS)) return null;
  if (fe.per !== "day" && left.who) return null;
  const shape: RuleShape = {
    kind: "count",
    people: fe.per === "day" ? (left.who ?? people) : people,
    days: fe.days!,
    shifts: left.shifts,
    per: fe.per,
    measure: left.measure ?? "count",
    ...(fe.window != null && { window: fe.window }),
  };
  if (fe.per === "day" && !noPeople(people)) return null;
  for (const x of cmps) {
    const v = bound(x.right)!;
    if (x.op === "eq") Object.assign(shape, { min: v, max: v });
    else if (x.op === "ge" && !shape.min) shape.min = v;
    else if (x.op === "le" && !shape.max) shape.max = v;
    else return null;
  }
  if ("all" in then && (!shape.min || !shape.max || then.all.some((x) => x.op === "eq"))) return null;
  return shape;
}

// --- 저장 문서 v5 → v6 ---

function isV5(v: unknown): boolean {
  if (!isV4(v)) return false;
  const w = (v as { ward: Record<string, unknown> | null }).ward;
  return (
    w === null ||
    (["pendingConfig", "unconverted"].every((k) => Array.isArray(w[k])) && Array.isArray((w.config as { shifts?: unknown } | undefined)?.shifts))
  );
}

/**
 * v5 저장 상태 → v6(설계 §8). 모양이 v5가 아니면 null.
 * - 블록은 식 규칙으로(병동 규칙·대기 카드·기간 요청·대기 요청·덮어쓴 규칙·확정본 버전의 요청·snapshot). cov-*·night-only는 default.
 * - 금지 패턴 분리 등으로 나뉜 id는 꺼진 id 목록·카드 순서·딸린 카드 id·덮어쓴 규칙에도 함께 넣는다.
 * - 변환하지 못한 블록은 원문만 ward.unconverted에 더한다.
 * - 옛 결과는 그대로, 작성 중·운영 중 결과는 stale. 근무표가 있거나 필요 인원이 있으면 병동 소개 단계를 본 것으로 둔다.
 */
export function migrateV5(state: unknown, today: string): Data | null {
  if (!isV5(state)) return null;
  const s = state as DataV5;
  const unconverted = [...(s.ward?.unconverted ?? [])];
  const split = new Map<string, string[]>();
  const convert = (list: BlockSpec[]): ConstraintSpec[] =>
    list.flatMap((c) => {
      try {
        const out = blockToRules(c);
        if (out.length > 1) split.set(c.id, out.map((r) => r.id));
        return out;
      } catch {
        unconverted.push({ source_text: c?.source_text ?? "" });
        return [];
      }
    });
  const expand = (ids: string[]) => ids.flatMap((id) => split.get(id) ?? [id]);

  const w = s.ward;
  const rules = w ? convert(w.rules) : [];
  const pendingRules = w ? convert(w.pendingRules) : [];

  const periods = s.periods.map((p): WorkPeriod => {
    const requests = convert(p.requests);
    const pendingRequests = convert(p.pendingRequests);
    const overrides = Object.values(p.ruleOverrides ?? {}).flatMap((c) => convert([c]).map((r) => [r.id, r] as const));
    const versions = p.versions.map((v) => (v.requests ? { ...v, requests: convert(v.requests) } : (v as PeriodVersion)));
    const snapshot = p.snapshot ? { nurses: p.snapshot.nurses, rules: convert(p.snapshot.rules) } : null;
    return {
      ...p,
      requests,
      pendingRequests,
      ruleOverrides: Object.fromEntries(overrides),
      versions,
      snapshot,
      disabledIds: expand(p.disabledIds),
      ...(p.cardOrder && { cardOrder: expand(p.cardOrder) }),
      ...(isStale(p, today) && { resultVersion: -1 }),
    };
  });

  const ward: Ward | null = w && {
    ...w,
    rules,
    pendingRules,
    pendingConfig: w.pendingConfig.map((c) => ({ ...c, ruleIds: expand(c.ruleIds) })),
    ...(w.cardOrder && { cardOrder: expand(w.cardOrder) }),
    unconverted,
    introSeen: s.periods.length > 0 || rules.some((r) => r.id.startsWith(COVERAGE_RULE_PREFIX)),
  };
  return { ward, periods, view: s.view, inputVersion: s.inputVersion };
}

/** 저장된 문서(persist·Supabase)를 지금 버전으로: 6은 그대로, 5는 v6으로, 4는 v5를 거쳐 v6으로. 그 밖은 null. */
export function upgradeDoc(state: unknown, version: number, today: string): Data | null {
  if (version === STORAGE_VERSION) return state as Data;
  if (version === 5) return migrateV5(state, today);
  if (version === 4) return migrateV5(migrateV4(state, today), today);
  return null;
}
