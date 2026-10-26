// 근무표 CSV 직렬화. 엑셀에서 바로 열리도록 UTF-8 BOM + CRLF, RFC 4180 이스케이프.
import type { Nurse, NurseStats, Period, ScheduleResult } from "./types.gen";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const TOTALS = ["D", "E", "N", "O"] as const;

export interface ScheduleCsvInput {
  nurses: Nurse[];
  period: Period;
  holidays: number[];
  assignments: ScheduleResult["assignments"];
  stats: Record<string, NurseStats>;
}

/** 수식 인젝션 방지('= + - @' 앞에 ') 후 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다. */
function cell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toScheduleCsv({ nurses, period, holidays, assignments, stats }: ScheduleCsvInput): string {
  const days = new Date(period.year, period.month, 0).getDate();
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const blankTotals = ["", "", "", "", ""];
  const listed = nurses.filter((n) => assignments[n.id]);

  const weekdays = dayList.map((d) => {
    const w = WEEKDAYS[new Date(period.year, period.month - 1, d).getDay()];
    return holidays.includes(d) ? `${w}(공휴일)` : w;
  });
  const rows: (string | number)[][] = [
    ["이름", "연차", ...weekdays, ...TOTALS, "주말근무"],
    ["", "", ...dayList, ...blankTotals],
    ...listed.map((n) => {
      const s = stats[n.id];
      return [n.name, n.years, ...assignments[n.id], ...(s ? [s.D, s.E, s.N, s.O, s.weekend_holiday_work] : blankTotals)];
    }),
    ...(["D", "E", "N"] as const).map((code) => [
      `${code} 합계`,
      "",
      ...dayList.map((d) => listed.filter((n) => assignments[n.id][d - 1] === code).length),
      ...blankTotals,
    ]),
  ];
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
