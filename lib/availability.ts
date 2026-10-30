// 가능 시간 → 근무조 판정 → 반드시 규칙. 순수 함수. LLM을 거치지 않는다(ADR-020).
import { dateOfDay, type PeriodRange } from "./period";
import { normalizeRule, OFF_CODE } from "./rules";
import type { Rule, ShiftDef, ShopConfig } from "./types.gen";

/** 시각 구간 ["09:00", "15:00"]. 시각은 "HH:MM"이라 문자열로 비교한다(lib/rules.ts shiftTimesError와 같다). */
export type TimeRange = [string, string];
/** 날짜("2026-11-02") → 그날 가능한 구간들 */
export type AvailabilitySlots = Record<string, TimeRange[]>;
/** backend/domain/constants.py AVAILABILITY_RULE_PREFIX */
export const AVAILABILITY_RULE_PREFIX = "avail-";

/** 구간들이 start~end를 빈틈없이 덮는지. 이어지거나 겹치는 구간은 합쳐서 본다. */
function coversTime(ranges: TimeRange[], start: string, end: string): boolean {
  let reached = start;
  for (const [from, to] of [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (from > reached) break;
    if (to > reached) reached = to;
  }
  return reached >= end;
}

/** 가능 시간이 근무조 시각을 완전히 덮는지. 복합 코드는 parts가 모두 덮여야 하고, 휴무는 언제나 덮인다. */
export function coversShift(ranges: TimeRange[], shift: ShiftDef, config: ShopConfig): boolean {
  if (shift.parts?.length) {
    return shift.parts.every((code) => {
      const part = config.shifts.find((s) => s.code === code);
      return !!part && coversShift(ranges, part, config);
    });
  }
  return shift.start == null || shift.end == null || coversTime(ranges, shift.start, shift.end);
}

/**
 * 직원 × 근무 코드마다 덮지 못하는 날을 금지하는 반드시 규칙. 금지할 날이 없으면 규칙도 없다.
 * 가능 시간이 없는 직원은 휴무 말고 모두 금지다. 칸 고정이 우선하므로 고정한 칸은 뺀다.
 * 꺼진 코드는 솔버가 배정하지 않아 규칙을 만들지 않는다.
 */
export function availabilityRules(
  employees: { id: string; name: string }[],
  config: ShopConfig,
  period: PeriodRange,
  slotsByEmployee: Record<string, AvailabilitySlots>,
  fixedCells: { employee_id: string; day: number }[],
): Rule[] {
  const fixed = new Set(fixedCells.map((c) => `${c.employee_id}@${c.day}`));
  const codes = config.shifts.filter((s) => s.code !== OFF_CODE && s.active !== false);
  const allDays = Array.from({ length: period.length }, (_, i) => i + 1);
  return employees.flatMap((employee) => {
    const slots = slotsByEmployee[employee.id] ?? {};
    const open = allDays.filter((day) => !fixed.has(`${employee.id}@${day}`));
    return codes.flatMap((shift) => {
      const days = open.filter((day) => !coversShift(slots[dateOfDay(period, day)] ?? [], shift, config));
      if (!days.length) return [];
      return normalizeRule({
        id: `${AVAILABILITY_RULE_PREFIX}${employee.id}-${shift.code}`,
        type: "rule",
        scope: "period",
        hardness: "hard",
        source_text: `${employee.name} 가능 시간`,
        body: {
          kind: "require",
          for_each: { per: "person", people: { ids: [employee.id] }, days: { days } },
          then: { left: { shifts: { in: [shift.code] } }, op: "eq", right: 0 },
        },
      } as Rule) as Rule;
    });
  });
}
