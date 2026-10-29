// 저장 문서 변환(STORAGE_VERSION 4 → 5, ADR-018 설계 §9)과 블록 기본값. 순수 함수.
// 템플릿 → 블록 변환표는 backend/domain/convert.py와 같다(convert-cases.json으로 비교한다).
import { isWeekendDay, periodEnd, type PeriodRange } from "./period";
import type { Data, ShiftChangeCard, WardNurse, WorkPeriod } from "./store";
import type { ConstraintSpec, CountRule, Days, People, Shifts, WardConfig } from "./types.gen";

export const NIGHT_ONLY_TAG = "나이트전담"; // backend/domain/constants.py NIGHT_ONLY_TAG
export const NIGHT_ONLY_RULE_ID = "night-only"; // backend/domain/convert.py
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

// --- 블록 기본값 ---

type Block = Exclude<ConstraintSpec, { type: "fixed_assignment" }>;

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
export function normalizeBlock(c: ConstraintSpec): ConstraintSpec {
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

/** 기본 규칙 "나이트 전담은 나이트와 휴무만"(hard). 태그만 붙이면 동작한다. */
export function nightOnlyRule(): CountRule {
  return normalizeBlock({
    id: NIGHT_ONLY_RULE_ID,
    type: "count",
    scope: "ward",
    hardness: "hard",
    source_text: "나이트 전담은 나이트와 휴무만",
    params: { people: { tags: [NIGHT_ONLY_TAG] }, shifts: { not_in: ["N", OFF_CODE] }, per: "person", max: 0 },
  }) as CountRule;
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
export function legacyToBlock(spec: LegacySpec, period?: PeriodRange, holidays: number[] = []): ConstraintSpec {
  if (["count", "sequence", "balance", "fixed_assignment"].includes(spec.type)) {
    return normalizeBlock(spec as unknown as ConstraintSpec);
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
  } as unknown as ConstraintSpec);
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

/** 옛 명단 한 사람: night_only를 나이트전담 태그로 바꾼다(저장 문서 이전, 샘플 병동 파일). */
export function tagged<T extends object>({ night_only, tags, ...n }: T & { night_only?: boolean; tags?: string[] }): Omit<T, "night_only" | "tags"> & { tags: string[] } {
  const base = tags ?? [];
  return { ...(n as Omit<T, "night_only" | "tags">), tags: night_only && !base.includes(NIGHT_ONLY_TAG) ? [...base, NIGHT_ONLY_TAG] : base };
}

/**
 * v4 저장 상태 → v5. 모양이 v4가 아니면 null.
 * - 근무 형태는 기본값, 명단의 night_only는 나이트전담 태그, 템플릿 제약은 블록(id·원문·켜짐·hardness 유지).
 * - 기본 규칙 "나이트 전담은 나이트와 휴무만"을 병동 규칙에 넣는다.
 * - 변환하지 못한 제약은 원문만 ward.unconverted로 옮긴다. 문서 전체를 버리지 않는다.
 * - 옛 결과는 형식을 그대로 두고, 작성 중이거나 끝나지 않은 확정 기간의 결과는 stale(resultVersion -1)로 둔다.
 */
export function migrateV4(state: unknown, today: string): Data | null {
  if (!isV4(state)) return null;
  const s = state as Data & { ward: (Record<string, unknown> & { nurses: LegacyNurse[] }) | null };
  const unconverted: { source_text: string }[] = [];
  const convert = (list: unknown[], period?: PeriodRange, holidays: number[] = []): ConstraintSpec[] =>
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

  const periods = s.periods.map((p): WorkPeriod => {
    const conv = (list: unknown[]) => convert(list, p, p.holidays);
    const overrides = Object.entries(p.ruleOverrides ?? {}).flatMap(([id, c]) => conv([c]).map((b) => [id, b] as const));
    const stale = p.result !== null && p.result !== undefined && (p.status === "draft" || today <= periodEnd(p));
    return {
      ...p,
      requests: conv(p.requests),
      pendingRequests: conv(p.pendingRequests),
      ruleOverrides: Object.fromEntries(overrides),
      versions: p.versions.map((v) => (v.requests ? { ...v, requests: conv(v.requests) } : v)),
      snapshot: p.snapshot
        ? { nurses: (p.snapshot.nurses as LegacyNurse[]).map(tagged), rules: conv(p.snapshot.rules) }
        : null,
      ...(stale && { resultVersion: -1 }),
    };
  });

  const ward = w && {
    ...(w as unknown as NonNullable<Data["ward"]>),
    config: DEFAULT_CONFIG,
    nurses: w.nurses.map(tagged),
    rules: rules.some((r) => r.id === NIGHT_ONLY_RULE_ID) ? rules : [...rules, nightOnlyRule()],
    pendingRules,
    pendingConfig: [] as ShiftChangeCard[],
    unconverted,
  };
  return { ward, periods, view: s.view, inputVersion: s.inputVersion };
}
