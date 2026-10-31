// 배정에서 개인별 통계를 다시 센다(★12: 변환 전에 확정한 근무표는 옛 형식 통계 대신 이 값을 보여 준다).
// backend/solver/stats.py compute_result의 EmployeeStats와 같은 정의다. 희망 반영률은 셀 수 없어 null.
import { isWeekendDay, type PeriodRange } from "./period";
import type { EmployeeStats, ScheduleResult, ShopConfig } from "./types.gen";

const OFF = "O";
const CLOSING = "C";

/** 직원별 마감 수의 가장 적음과 가장 많음. 복합 코드는 parts로 센다. 셀 직원이 없으면 null. */
export function closingSpread(
  assignments: Record<string, string[]>,
  config: ShopConfig,
  activeIds: string[],
): { min: number; max: number } | null {
  const closing = new Set(config.shifts.filter((s) => s.parts?.includes(CLOSING)).map((s) => s.code));
  closing.add(CLOSING);
  const counts = activeIds
    .filter((id) => id in assignments)
    .map((id) => assignments[id].filter((code) => closing.has(code)).length);
  return counts.length === 0 ? null : { min: Math.min(...counts), max: Math.max(...counts) };
}

export function statsFromAssignments(
  assignments: ScheduleResult["assignments"],
  config: ShopConfig,
  period: PeriodRange,
  holidays: number[],
): Record<string, EmployeeStats> {
  const hours = new Map(config.shifts.map((s) => [s.code, s.hours]));
  const work = Object.fromEntries(Object.entries(assignments).map(([id, row]) => [id, row.filter((c) => c !== OFF).length]));
  const values = Object.values(work);
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  return Object.fromEntries(
    Object.entries(assignments).map(([id, row]) => {
      let run = 0;
      let longest = 0;
      for (const code of row) {
        run = code === OFF ? 0 : run + 1;
        longest = Math.max(longest, run);
      }
      const stats: EmployeeStats = {
        counts: Object.fromEntries(
          config.shifts
            .filter((s) => s.active !== false || row.includes(s.code))
            .map((s) => [s.code, row.filter((c) => c === s.code).length]),
        ),
        hours: row.reduce((sum, code) => sum + (hours.get(code) ?? 0), 0),
        weekend_holiday_work: row.filter((code, i) => code !== OFF && isWeekendDay(period, i + 1, holidays)).length,
        max_consecutive_work: longest,
        preference_rate: null,
        deviation: Math.round((work[id] - mean) * 100) / 100,
      };
      return [id, stats];
    }),
  );
}
