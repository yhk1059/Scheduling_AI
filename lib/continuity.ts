// 기간 연속성(ADR-015): 이월, 최근 4주 원본(history), 지난 날짜 잠금. 모두 순수 함수이고 날짜는 lib/period.ts로만 다룬다.
import { CARRY_OVER_DAYS } from "./roster-import";
import { dateOfDay, dayOfDate, isWeekendDay, monthDay, periodDays, periodEnd, type PeriodRange } from "./period";
import type { Assignments, WardNurse, WorkPeriod } from "./store";
import type { CarryOverRow, DiffCell, FixedAssignment, History, Nurse, WardConfig } from "./types.gen";

export const HISTORY_DAYS = 28; // backend/domain/constants.py HISTORY_DAYS
const OFF = "O";

/** 간호사별 최근 4주 나이트·주말·공휴일 근무 수(화면 표시용). */
export interface HistoryLoad {
  nurse_id: string;
  nights: number;
  weekends: number;
}

/** 기간의 최신 확정본(versions 마지막). 없으면 null. */
export function latestConfirmed(period: WorkPeriod): Assignments | null {
  return period.versions.at(-1)?.assignments ?? null;
}

/** target 바로 앞에서 끝나는(끝 날짜 + 1 = target 시작일) 확정 기간. 없으면 null. */
export function previousConfirmedPeriod(periods: WorkPeriod[], target: PeriodRange): WorkPeriod | null {
  return (
    periods.find((p) => p.status === "confirmed" && dateOfDay(p, p.length + 1) === target.start_date && latestConfirmed(p)) ??
    null
  );
}

/**
 * 지난 확정본의 마지막 CARRY_OVER_DAYS일 → carry_over 행.
 * nurseIds에 있는 간호사만, 행 길이는 min(7, 지난 기간 길이).
 */
export function carryOverFrom(prev: WorkPeriod, nurseIds: string[]): CarryOverRow[] {
  const a = latestConfirmed(prev);
  if (!a) return [];
  return nurseIds.filter((id) => a[id]).map((id) => ({ nurse_id: id, shifts: a[id].slice(-CARRY_OVER_DAYS) }));
}

/**
 * target 시작일 직전 HISTORY_DAYS일 안에 있는 확정 기간들의 최신 확정본 원본(백엔드 history).
 * 시작은 확정본이 있는 첫날, 끝은 마지막 날. 사이가 비거나 그 기간에 행이 없는 날은 휴무(O)로 채운다.
 * nurseIds에 있고 창 안에 배정이 하나라도 있는 간호사만 행을 둔다. 공휴일은 그 기간들의 공휴일 날짜. 없으면 null.
 */
export function historyFor(periods: WorkPeriod[], target: PeriodRange, nurseIds: string[]): History | null {
  const window: PeriodRange = { start_date: dateOfDay(target, 1 - HISTORY_DAYS), length: HISTORY_DAYS };
  const cells = new Map(nurseIds.map((id) => [id, new Map<number, string>()]));
  const covered: number[] = [];
  const holidays: string[] = [];
  for (const p of periods) {
    const a = p.status === "confirmed" ? latestConfirmed(p) : null;
    if (!a) continue;
    for (const { day, date } of periodDays(p)) {
      const i = dayOfDate(window, date);
      if (i === null) continue;
      covered.push(i);
      if (p.holidays.includes(day)) holidays.push(date);
      for (const [id, row] of cells) {
        const code = a[id]?.[day - 1];
        if (code !== undefined) row.set(i, code);
      }
    }
  }
  if (covered.length === 0) return null;
  const first = Math.min(...covered);
  const last = Math.max(...covered);
  const rows = Object.fromEntries(
    [...cells]
      .filter(([, row]) => row.size > 0)
      .map(([id, row]) => [id, Array.from({ length: last - first + 1 }, (_, k) => row.get(first + k) ?? OFF)]),
  );
  if (Object.keys(rows).length === 0) return null;
  return { start_date: dateOfDay(window, first), rows, holidays: holidays.sort() };
}

/** 화면의 "최근 4주 나이트·주말" 숫자: history 원본에서 나이트(세는 근무조 N)와 주말·공휴일 근무를 센다. 둘 다 0이면 뺀다. */
export function historyLoadFor(history: History | null, config: WardConfig): HistoryLoad[] {
  if (!history) return [];
  const covers = (code: string) => [code, ...(config.shifts.find((s) => s.code === code)?.parts ?? [])];
  return Object.entries(history.rows)
    .map(([nurse_id, row]) => {
      const range: PeriodRange = { start_date: history.start_date, length: row.length };
      const holidays = (history.holidays ?? []).map((d) => dayOfDate(range, d)).filter((d): d is number => d !== null);
      return {
        nurse_id,
        nights: row.filter((code) => covers(code).includes("N")).length,
        weekends: row.filter((code, i) => code !== OFF && isWeekendDay(range, i + 1, holidays)).length,
      };
    })
    .filter((l) => l.nights > 0 || l.weekends > 0);
}

/** 기간이 운영 중인지: 확정됨 && start_date <= today <= end. */
export function isOperating(period: WorkPeriod, today: string): boolean {
  return period.status === "confirmed" && dayOfDate(period, today) !== null;
}

/**
 * 운영 중인 기간에서 today 이전(today 미포함) 날짜를 최신 확정본으로 잠그는 fixed_assignment 목록.
 * id는 `lock-{nurse_id}-{day}`, scope "period", source_text "지난 날짜 고정: {이름} {M}/{D} {코드}".
 * today가 기간 시작 이전이면 [], 기간이 끝났으면 전체 날짜. 확정본이 없으면 [].
 */
export function pastDayLocks(period: WorkPeriod, nurses: Nurse[], today: string): FixedAssignment[] {
  const a = latestConfirmed(period);
  if (!a || today <= period.start_date) return [];
  const lastDay = today > periodEnd(period) ? period.length : dayOfDate(period, today)! - 1;
  return nurses.flatMap((n) =>
    a[n.id]
      ? a[n.id].slice(0, lastDay).map((shift, i): FixedAssignment => ({
          id: `lock-${n.id}-${i + 1}`,
          type: "fixed_assignment",
          scope: "period",
          hardness: "hard",
          weight: 1,
          source_text: `지난 날짜 고정: ${n.name} ${monthDay(period, i + 1)} ${shift}`,
          enabled: true,
          params: { nurse_id: n.id, day: i + 1, shift },
        }))
      : [],
  );
}

/** 두 배정의 바뀐 칸(공통 간호사·날짜만). */
export function diffAssignments(before: Assignments, after: Assignments): DiffCell[] {
  return Object.keys(before).flatMap((id) => {
    const b = before[id];
    const c = after[id];
    if (!c) return [];
    return b.flatMap((code, i) =>
      i < c.length && c[i] !== code ? [{ nurse_id: id, day: i + 1, before: code, after: c[i] }] : [],
    );
  });
}

/** 같은 carry_over인지(간호사 순서 무관). 이월 변경 배너 판정에 쓴다. */
export function sameCarryOver(a: CarryOverRow[], b: CarryOverRow[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((r) => [r.nurse_id, r.shifts.join("")]));
  return a.every((r) => byId.get(r.nurse_id) === r.shifts.join(""));
}

/** 지난 확정 기간의 snapshot 명단과 현재 활성 명단 비교: 추가·비활성화된 간호사. */
export function rosterChanges(
  prev: WorkPeriod | null,
  nurses: WardNurse[],
): { added: WardNurse[]; deactivated: WardNurse[] } {
  if (!prev?.snapshot) return { added: [], deactivated: [] };
  const before = new Set(prev.snapshot.nurses.map((n) => n.id));
  return {
    added: nurses.filter((n) => n.active && !before.has(n.id)),
    deactivated: nurses.filter((n) => !n.active && before.has(n.id)),
  };
}
