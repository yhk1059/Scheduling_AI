// 새 필요 인원 카드와 함께 지킬 수 없는 기존 필요 인원 규칙 찾기. 범위 비교와 날짜 겹침만 본다(솔버를 부르지 않는다).
import { periodDays, type PeriodRange } from "./period";
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
