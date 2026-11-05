// 직원 확정 근무표 화면(공용 링크)이 쓰는 순수 함수. 데이터는 get_confirmed_schedule의 확정본이다.
import { isWeekendDay, periodDays } from "./period";
import { OFF_CODE } from "./rules";
import type { ConfirmedSchedule } from "./supabase";
import type { ShiftDef } from "./types.gen";

/** 하루. weekday는 0=일. code ""는 확정본에 그날 데이터가 없다는 뜻이다. */
export interface EmployeeDay {
  day: number;
  date: string;
  weekday: number;
  code: string;
  label: string;
  weekend: boolean;
}

function shiftLabel(code: string, shifts: ShiftDef[]): string {
  if (code === "") return "—";
  if (code === OFF_CODE) return "휴무";
  const shift = shifts.find((s) => s.code === code);
  if (!shift) return code;
  if (shift.parts?.length) {
    const names = shift.parts.map((p) => shifts.find((s) => s.code === p)?.name ?? p);
    return `${shift.name} ${names.join("+")}`;
  }
  return shift.start && shift.end ? `${shift.name} ${shift.start}~${shift.end}` : shift.name;
}

/** 이름이 같은 직원의 기간 전체 날짜. label은 "오픈 09:00~15:00", 더블은 "더블 오픈+마감", 휴무는 "휴무", 모르는 코드는 코드 그대로. 이름이 없으면 null. */
export function employeeDays(schedule: ConfirmedSchedule, name: string): EmployeeDay[] | null {
  const row = schedule.rows.find((r) => r.name === name);
  if (!row) return null;
  const range = { start_date: schedule.period_start, length: schedule.period_length };
  return periodDays(range).map(({ day, date, weekday }) => {
    const code = row.codes[day - 1] ?? "";
    return {
      day,
      date,
      weekday,
      code,
      label: shiftLabel(code, schedule.shifts),
      weekend: isWeekendDay(range, day, schedule.holidays),
    };
  });
}

/** 근무일 수와 실근무 시간 합(config의 hours). 휴무와 빠진 날은 세지 않는다. */
export function employeeTotals(days: EmployeeDay[], shifts: ShiftDef[]): { workDays: number; hours: number } {
  const work = days.filter((d) => d.code !== "" && d.code !== OFF_CODE);
  const hours = work.reduce((sum, d) => sum + (shifts.find((s) => s.code === d.code)?.hours ?? 0), 0);
  return { workDays: work.length, hours };
}

/** 7일씩 나눈 페이지(직원 입력 화면과 같은 단위). */
export function weekPages(days: EmployeeDay[]): EmployeeDay[][] {
  const pages: EmployeeDay[][] = [];
  for (let i = 0; i < days.length; i += 7) pages.push(days.slice(i, i + 7));
  return pages;
}
