// 근무표 없음의 원인 중 "그날 그 근무조에 들어올 수 있는 사람이 모자람"을 가능 시간으로 셈한다. 솔버를 부르지 않는다.
import { AVAILABILITY_RULE_PREFIX, isAvailabilityRule } from "./availability";
import { coverageDays } from "./coverage-conflict";
import type { PeriodRange } from "./period";
import { OFF_CODE, ruleShape } from "./rules";
import type { ConstraintSpec, Rule, ShopConfig } from "./types.gen";

/** 인원 규칙 하나가 하루 근무조에서 모자란 곳. names는 그날 그 근무조에 들어올 수 있는 사람(명단 순). */
export interface Shortage {
  constraintId: string;
  day: number;
  code: string;
  need: number;
  names: string[];
}

/** 가능 시간 규칙 avail-{직원 id}-{코드}에서 (직원, 코드) → 못 나오는 날. */
function blockedDays(constraints: ConstraintSpec[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const c of constraints) {
    if (c.type !== "rule" || !isAvailabilityRule(c.id)) continue;
    const body = (c as Rule).body;
    const days = body.kind === "require" ? body.for_each.days?.days : undefined;
    const key = c.id.slice(AVAILABILITY_RULE_PREFIX.length); // "{직원 id}-{코드}"
    if (days) out.set(key, new Set(days));
  }
  return out;
}

/**
 * 충돌(conflictIds)에 든 하루 인원 규칙마다, 규칙의 날짜 중 들어올 수 있는 사람이 최소 인원보다 적은 날.
 * 들어올 수 있는 사람 = 규칙이 고른 사람(직급 하나라도 맞고, 뺀 직급이 없음) 중 그 근무조(또는 그 근무조를 포함한 코드)의 가능 시간이 있는 사람.
 * 가능 시간만으로 모두 채울 수 있으면(다른 규칙과 겹쳐서 막힌 경우) 빈 배열이다.
 */
export function coverageShortages(
  conflictIds: string[],
  constraints: ConstraintSpec[],
  employees: { id: string; name: string; tags?: string[] }[],
  config: ShopConfig,
  period: PeriodRange,
  holidays: number[],
): Shortage[] {
  const blocked = blockedDays(constraints);
  const codes = config.shifts.filter((s) => s.code !== OFF_CODE && s.active !== false);
  return constraints.flatMap((c) => {
    if (!conflictIds.includes(c.id) || isAvailabilityRule(c.id)) return [];
    const s = ruleShape(c);
    if (s?.kind !== "count" || s.per !== "day" || s.measure !== "count" || !s.shifts.in || !s.min?.n) return [];
    const { people } = s;
    const inCodes = s.shifts.in;
    const need = s.min.n;
    const picked = employees.filter(
      (n) =>
        (!people.ids || people.ids.includes(n.id)) &&
        (!people.tags || people.tags.some((t) => n.tags?.includes(t))) &&
        !people.exclude_tags?.some((t) => n.tags?.includes(t)),
    );
    return inCodes.flatMap((code) => {
      const covering = codes.filter((x) => x.code === code || x.parts?.includes(code)).map((x) => x.code);
      return coverageDays(s.days, period, holidays).flatMap((day) => {
        const names = picked.filter((n) => covering.some((x) => !blocked.get(`${n.id}-${x}`)?.has(day))).map((n) => n.name);
        return names.length < need ? [{ constraintId: c.id, day, code, need, names }] : [];
      });
    });
  });
}

/** ① 가능 시간에서 만들기 전에 보는 경고. 반드시 인원 규칙 모두를 지금 받은 가능 시간으로 센다(가능하면 규칙은 모자라도 근무표가 나온다). */
export function availabilityShortages(
  constraints: ConstraintSpec[],
  employees: { id: string; name: string; tags?: string[] }[],
  config: ShopConfig,
  period: PeriodRange,
  holidays: number[],
): Shortage[] {
  const hard = constraints.filter((c) => (c.hardness ?? "hard") === "hard").map((c) => c.id);
  return coverageShortages(hard, constraints, employees, config, period, holidays);
}

/** 규칙이 고르던 날에서 drop을 뺀 수정본(그날만 예외). 날마다 세는 규칙(require)이 아니면 그대로 돌려준다. */
export function withoutDays(c: ConstraintSpec, drop: number[], period: PeriodRange, holidays: number[]): ConstraintSpec {
  if (c.type !== "rule" || c.body.kind !== "require") return c;
  const body = c.body;
  const days = body.for_each.days ?? {};
  const keep = coverageDays(days, period, holidays).filter((d) => !drop.includes(d));
  return { ...c, body: { ...body, for_each: { ...body.for_each, days: { ...days, days: keep } } } };
}
