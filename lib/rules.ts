// 식 규칙 상수, 기본값 채우기, 블록 모양 되읽기. 순수 함수.
import type { Cmp, ConstraintSpec, Count, Days, People, Rule, ShiftDef, Shifts, ValueRef, ShopConfig } from "./types.gen";

/** 저장 문서 버전. 6 = 식 규칙(ADR-019) */
export const STORAGE_VERSION = 1;
export const COVERAGE_RULE_PREFIX = "cov-";
export const OFF_CODE = "O";
/** 중요도 → 가중치. backend/domain/constants.py PRIORITY_WEIGHTS */
export const PRIORITY_WEIGHTS = { high: 30, normal: 10, low: 5 } as const;
export type Priority = keyof typeof PRIORITY_WEIGHTS;
const DEFAULT_WEIGHT = PRIORITY_WEIGHTS.normal;

/** 기본 근무 형태: 오픈·미들·마감 + O(backend/domain/constants.py DEFAULT_SHIFTS). */
export const DEFAULT_CONFIG: ShopConfig = {
  shifts: [
    { code: "A", name: "오픈", hours: 6, start: "09:00", end: "15:00" },
    { code: "M", name: "미들", hours: 6, start: "12:00", end: "18:00" },
    { code: "C", name: "마감", hours: 6, start: "17:00", end: "23:00" },
    { code: OFF_CODE, name: "휴무", hours: 0 },
  ],
};

/** 근무표 칸 색 단계 수(밝음 0 → 진함 TONE_STEPS-1). */
export const TONE_STEPS = 5;
/** 칸 색: 단계(0..TONE_STEPS-1), 근무조를 합친 코드 "multi", 휴무 "off". */
export type ShiftTone = number | "multi" | "off";

/**
 * 근무 코드별 칸 색. 근무조(합친 코드·휴무 제외, 꺼진 코드 포함)를 시작 시각 순으로 세워
 * 이른 근무는 밝게, 늦은 근무는 진하게 단계에 고르게 나눈다. 시작 시각이 없는 코드가 있으면 설정 순서를 쓴다.
 */
export function shiftTones(config: ShopConfig): Record<string, ShiftTone> {
  const teams = config.shifts.filter((s) => s.code !== OFF_CODE && !s.parts?.length);
  const ordered = teams.every((s) => s.start) ? [...teams].sort((a, b) => a.start!.localeCompare(b.start!)) : teams;
  const last = TONE_STEPS - 1;
  const tones: Record<string, ShiftTone> = {};
  ordered.forEach((s, i) => {
    tones[s.code] = ordered.length === 1 ? Math.floor(last / 2) : Math.round((i * last) / (ordered.length - 1));
  });
  for (const s of config.shifts) {
    if (s.code === OFF_CODE) tones[s.code] = "off";
    else if (s.parts?.length) tones[s.code] = "multi";
  }
  return tones;
}

const SHIFT_TIME_RE =/^(([01][0-9]|2[0-3]):(00|30)|24:00)$/; // backend/domain/models.py ShiftTime

/** 근무조 시각 입력의 오류 문구. 맞으면 null. "HH:MM" 30분 단위, 끝은 시작보다 늦고 24:00까지(자정을 넘기지 않는다). */
export function shiftTimesError(start: string, end: string): string | null {
  if (!SHIFT_TIME_RE.test(start) || !SHIFT_TIME_RE.test(end)) return "시각은 09:00, 17:30처럼 30분 단위로 적어 주세요";
  return start < end ? null : "끝 시각은 시작 시각보다 늦어야 해요. 자정을 넘길 수 없어요";
}

/** 최근 4주 부담에서 세는 근무조: 활성 기본 코드 중 가장 늦게 끝나는 것(같으면 늦게 시작하는 것). 기본은 마감. */
export function closingShift(config: ShopConfig): ShiftDef | null {
  const late = (s: ShiftDef) => `${s.end ?? ""} ${s.start ?? ""}`;
  return config.shifts
    .filter((s) => s.code !== OFF_CODE && s.active !== false && !s.parts?.length)
    .reduce<ShiftDef | null>((best, s) => (!best || late(s) > late(best) ? s : best), null);
}

/** null·undefined 값을 지운다. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;
}

const people = (p: People | undefined): People => ({ ...compact(p ?? {}), exclude_tags: p?.exclude_tags ?? [] });
const days = (d: Days | undefined): Days => ({ ...compact(d ?? {}), kind: d?.kind ?? "all" });
const shifts = (s: Shifts): Shifts => compact(s);

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

/** 규칙의 생략된 기본값을 채우고 null을 지운다. weight는 중요도에서 정한다. 칸 고정은 항상 hard. */
export function normalizeRule(c: ConstraintSpec): ConstraintSpec {
  if (c.type === "fixed_assignment") return { ...c, hardness: "hard", weight: c.weight ?? DEFAULT_WEIGHT, enabled: c.enabled ?? true };
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

// --- 식 → 블록 모양(카드 제목·문장·필요 인원 폼이 읽는다) ---

const condCmps = (c: Cond | null | undefined): Cmp[] => (!c ? [] : "all" in c ? c.all : "any" in c ? c.any : [c]);
/** not S: in ↔ not_in. */
const flip = (s: Shifts): Shifts => (s.in ? { not_in: s.in } : { in: s.not_in! });
const noPeople = (p: People | undefined) =>
  !p?.ids && !p?.tags && !p?.exclude_tags?.length;

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
  | {
      kind: "count";
      people: People;
      days: Days;
      shifts: Shifts;
      per: "day" | "person" | "person_week" | "person_window";
      measure: "count" | "hours";
      window?: number;
      min?: Bound;
      max?: Bound;
    }
  | { kind: "forbid"; people: People; pattern: Shifts[] }
  | { kind: "max_run"; people: People; run: Shifts; max_len: Bound }
  | { kind: "min_run"; people: People; run: Shifts; min_len: number }
  | { kind: "off_after"; people: People; after: Shifts; then_off: number }
  | { kind: "balance"; people: People; days: Days; shifts: Shifts; measure: "count" | "hours"; with_history: boolean; max_gap: Bound };

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
