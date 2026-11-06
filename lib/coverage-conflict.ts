// 새 필요 인원 카드와 함께 지킬 수 없는 기존 필요 인원 규칙 찾기. 범위 비교와 날짜 겹침만 본다(솔버를 부르지 않는다).
import { isWeekendDay, periodDays, type PeriodRange } from "./period";
import { ruleShape, stableJson } from "./rules";
import type { ConstraintSpec, Days, Shifts } from "./types.gen";

interface Coverage {
  days: Days;
  shifts: Shifts;
  min: number;
  max: number | null;
}

/** 필요 인원 모양(store의 isStaffingRule과 같은 조건): 매장 규칙, 날마다 모든 사람의 근무 개수. */
function coverage(c: ConstraintSpec): Coverage | null {
  const s = ruleShape(c);
  if (c.scope !== "shop" || s?.kind !== "count" || s.per !== "day" || s.measure !== "count") return null;
  const p = s.people;
  if (p.ids || p.tags || p.exclude_tags?.length) return null;
  return { days: s.days, shifts: s.shifts, min: s.min?.n ?? 0, max: s.max?.n ?? null };
}

/** 필요 인원 모양의 범위. 모양이 아니면 null. max null = 상한 없음("이상"). */
export function coverageBounds(c: ConstraintSpec): { min: number; max: number | null } | null {
  const cov = coverage(c);
  return cov && { min: cov.min, max: cov.max };
}

/** 날짜 고르기가 이 근무표에서 가리키는 날(1..length). kind·weekdays(0=월)·days를 모두 적용한다. */
export function coverageDays(days: Days | undefined, period: PeriodRange, holidays: number[]): number[] {
  const kind = days?.kind ?? "all";
  return periodDays(period)
    .filter(({ day, weekday }) => {
      const holiday = holidays.includes(day);
      const weekend = weekday === 0 || weekday === 6 || holiday;
      if (kind === "weekday" && weekend) return false;
      if (kind === "weekend" && !weekend) return false;
      if (kind === "holiday" && !holiday) return false;
      if (days?.weekdays && !days.weekdays.includes((weekday + 6) % 7)) return false;
      return !days?.days || days.days.includes(day);
    })
    .map(({ day }) => day);
}

const isHard = (c: ConstraintSpec) => (c.hardness ?? "hard") === "hard" && c.enabled !== false;
/** [a.min, a.max]와 [b.min, b.max]가 교차하지 않는다. */
const disjoint = (a: Coverage, b: Coverage) => (a.max !== null && a.max < b.min) || (b.max !== null && b.max < a.min);

/**
 * card를 적용하면 함께 지킬 수 없게 되는 기존 필요 인원 규칙. 없으면 null.
 * 둘 다 반드시(hard)이고, 같은 근무 고르기(shifts)이고, 사람 고르기가 없고, 날짜가 하루라도 겹치고,
 * 범위가 겹치지 않을 때([minA, maxA]와 [minB, maxB]가 교차하지 않을 때)다. 첫 번째 것을 돌려준다.
 */
export function findCoverageConflict(
  rules: ConstraintSpec[],
  card: ConstraintSpec,
  period: PeriodRange,
  holidays: number[],
): ConstraintSpec | null {
  const mine = isHard(card) ? coverage(card) : null;
  if (!mine) return null;
  const shifts = stableJson(mine.shifts);
  const myDays = new Set(coverageDays(mine.days, period, holidays));
  return (
    rules.find((r) => {
      if (r.id === card.id || !isHard(r)) return false;
      const other = coverage(r);
      return (
        !!other &&
        stableJson(other.shifts) === shifts &&
        disjoint(mine, other) &&
        coverageDays(other.days, period, holidays).some((d) => myDays.has(d))
      );
    }) ?? null
  );
}

/** 요약표의 요일 종류. store의 DayKind는 이 타입이다. */
export type DayKind = "weekday" | "weekend";

/**
 * 요약표 한 칸: 켜진 반드시 필요 인원 규칙(사람 고르기 없음, shifts.in이 코드 하나) 중
 * 그 요일 종류(평일 / 주말·공휴일)의 모든 날에 적용되는 규칙을 합친 범위.
 * min은 가장 큰 min, max는 가장 작은 max(상한 없는 규칙만 있으면 null). 그런 규칙이 없으면 null.
 * 일부 날에만 적용되는 규칙("토요일만 3명")은 넣지 않는다(그 규칙은 카드로 남는다).
 */
export function effectiveCoverage(
  rules: ConstraintSpec[],
  code: string,
  kind: DayKind,
  period: PeriodRange,
  holidays: number[],
): { min: number; max: number | null } | null {
  const want = periodDays(period)
    .map(({ day }) => day)
    .filter((day) => isWeekendDay(period, day, holidays) === (kind === "weekend"));
  if (want.length === 0) return null;
  let out: { min: number; max: number | null } | null = null;
  for (const r of rules) {
    const cov = isHard(r) ? coverage(r) : null;
    if (!cov || cov.shifts.not_in || cov.shifts.in?.length !== 1 || cov.shifts.in[0] !== code) continue;
    const days = new Set(coverageDays(cov.days, period, holidays));
    if (!want.every((d) => days.has(d))) continue;
    out = out
      ? { min: Math.max(out.min, cov.min), max: out.max === null ? cov.max : cov.max === null ? out.max : Math.min(out.max, cov.max) }
      : { min: cov.min, max: cov.max };
  }
  return out;
}
