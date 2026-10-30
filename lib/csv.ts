// 근무표 CSV 직렬화. 엑셀에서 바로 열리도록 UTF-8 BOM + CRLF, RFC 4180 이스케이프.
import { isWeekendDay, periodDays } from "./period";
import type { Employee, Period, ScheduleResult, ShopConfig } from "./types.gen";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const OFF = "O";

export interface ScheduleCsvInput {
  employees: Employee[];
  period: Period;
  holidays: number[];
  assignments: ScheduleResult["assignments"];
  config: ShopConfig;
}

/** 수식 인젝션 방지('= + - @' 앞에 ') 후 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다. */
function cell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 행은 직원(이름, 날짜별 코드, 활성 코드별 수, 주말·공휴일 근무), 하단은 날짜별 근무조 합계.
 * 근무조는 활성 기본 코드(복합·휴무 제외)이고, 복합 코드는 세는 근무조마다 더한다.
 */
export function toScheduleCsv({ employees, period, holidays, assignments, config }: ScheduleCsvInput): string {
  const pdays = periodDays(period);
  const dayList = pdays.map((p) => p.day);
  const totals = config.shifts.filter((s) => s.active !== false).map((s) => s.code);
  const groups = config.shifts.filter((s) => s.active !== false && !s.parts?.length && s.code !== OFF).map((s) => s.code);
  const covers = (code: string) => [code, ...(config.shifts.find((s) => s.code === code)?.parts ?? [])];
  const blankTotals = Array.from({ length: totals.length + 1 }, () => "");
  const listed = employees.filter((n) => assignments[n.id]);

  const weekdays = pdays.map(({ day, weekday }) => {
    const w = WEEKDAYS[weekday];
    return holidays.includes(day) ? `${w}(공휴일)` : w;
  });
  const rows: (string | number)[][] = [
    ["이름", ...weekdays, ...totals, "주말근무"],
    ["", ...pdays.map((p) => p.dom), ...blankTotals],
    ...listed.map((n) => {
      const row = assignments[n.id];
      const weekend = row.filter((code, i) => code !== OFF && isWeekendDay(period, i + 1, holidays)).length;
      return [n.name, ...row, ...totals.map((code) => row.filter((c) => c === code).length), weekend];
    }),
    ...groups.map((group) => [
      `${group} 합계`,
      ...dayList.map((d) => listed.filter((n) => covers(assignments[n.id][d - 1]).includes(group)).length),
      ...blankTotals,
    ]),
  ];
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
