// 가능 시간 → 근무조 판정 → 반드시 규칙. 순수 함수. LLM을 거치지 않는다(ADR-020).
import { dateOfDay, type PeriodRange } from "./period";
import { normalizeRule, OFF_CODE, stableJson } from "./rules";
import type { Conflict, Rule, ShiftDef, ShopConfig } from "./types.gen";

/** 시각 구간 ["09:00", "15:00"]. 시각은 "HH:MM"이라 문자열로 비교한다(lib/rules.ts shiftTimesError와 같다). */
export type TimeRange = [string, string];
/** 날짜("2026-11-02") → 그날 가능한 구간들 */
export type AvailabilitySlots = Record<string, TimeRange[]>;
/** backend/domain/constants.py AVAILABILITY_RULE_PREFIX */
export const AVAILABILITY_RULE_PREFIX = "avail-";

/** 가능 시간 규칙인지. 끄거나 완화할 수 없다. */
export function isAvailabilityRule(id: string): boolean {
  return id.startsWith(AVAILABILITY_RULE_PREFIX);
}

/** 근무표 없음의 원인이 미제출인지: 활성 직원 중 제출한 사람이 없거나, 충돌에 걸린 가능 시간 규칙의 직원이 모두 미제출이면 true. */
export function unsubmittedCause(conflictIds: string[], submittedIds: string[], activeIds: string[]): boolean {
  if (activeIds.length === 0) return false;
  const submitted = new Set(submittedIds);
  if (!activeIds.some((id) => submitted.has(id))) return true;
  // avail-{직원 id}-{코드}: 마지막 - 뒤가 코드
  const blocked = conflictIds
    .filter(isAvailabilityRule)
    .map((id) => id.slice(AVAILABILITY_RULE_PREFIX.length, id.lastIndexOf("-")));
  return blocked.length > 0 && blocked.every((id) => !submitted.has(id));
}

/** 충돌 목록의 가능 시간은 근무 코드마다 규칙이 달라도 직원마다 한 줄로 묶는다. */
export function mergeAvailabilityConflicts(conflicts: Conflict[]): Conflict[] {
  const seen = new Set<string>();
  return conflicts.filter((c) => {
    if (!isAvailabilityRule(c.constraint_id)) return true;
    if (seen.has(c.source_text)) return false;
    seen.add(c.source_text);
    return true;
  });
}

/** 직원 화면 캘린더의 하루: 06:00~24:00, 30분 칸. */
export const SLOT_COUNT = 36;
const FIRST_SLOT_MINUTES = 6 * 60;

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 칸 번호(0~35)의 시작·끝 시각. */
export function slotLabel(slot: number): TimeRange {
  const start = FIRST_SLOT_MINUTES + slot * 30;
  return [clock(start), clock(start + 30)];
}

function slotOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h * 60 + m - FIRST_SLOT_MINUTES) / 30;
}

/** 칠한 칸 집합의 키. */
export function cellKey(date: string, slot: number): string {
  return `${date}@${slot}`;
}

/** slots(제출 형식) → 칠한 칸 집합. */
export function cellsFromSlots(slots: AvailabilitySlots): Set<string> {
  const cells = new Set<string>();
  for (const [date, ranges] of Object.entries(slots)) {
    for (const [from, to] of ranges) {
      for (let slot = slotOf(from); slot < slotOf(to); slot++) cells.add(cellKey(date, slot));
    }
  }
  return cells;
}

/** 칠한 칸 집합 → slots(제출 형식). 이어진 칸은 구간 하나로 합치고, 칸이 없는 날은 넣지 않는다. */
export function slotsFromCells(cells: Set<string>): AvailabilitySlots {
  const byDate = new Map<string, number[]>();
  for (const key of cells) {
    const [date, slot] = key.split("@");
    byDate.set(date, [...(byDate.get(date) ?? []), Number(slot)]);
  }
  const slots: AvailabilitySlots = {};
  for (const date of [...byDate.keys()].sort()) {
    const ranges: TimeRange[] = [];
    for (const slot of byDate.get(date)!.sort((a, b) => a - b)) {
      const [from, to] = slotLabel(slot);
      const last = ranges.at(-1);
      if (last?.[1] === from) last[1] = to;
      else ranges.push([from, to]);
    }
    slots[date] = ranges;
  }
  return slots;
}

/**
 * 드래그 한 번의 결과. 시작 칸(dates[0], start)이 비어 있으면 dates × [start..end] 직사각형을 칠하고, 칠해져 있으면 지운다.
 * dates는 시작 열부터 지금 열까지의 날짜(화면에 보이는 순서, 시작 열이 뒤에 있으면 뒤집힌 순서라도 된다). base는 드래그를 시작할 때의 칸이다.
 */
export function applyDrag(base: Set<string>, dates: string[], start: number, end: number): Set<string> {
  const erase = base.has(cellKey(dates[0], start));
  const next = new Set(base);
  for (const date of dates) {
    for (let slot = Math.min(start, end); slot <= Math.max(start, end); slot++) {
      if (erase) next.delete(cellKey(date, slot));
      else next.add(cellKey(date, slot));
    }
  }
  return next;
}

/** from 날의 칠한 구간을 to 날들에 더한다(합집합. to의 기존 칸은 남긴다). from이 비어 있으면 그대로. from이 to에 있어도 된다. */
export function copyDay(cells: Set<string>, from: string, to: string[]): Set<string> {
  const next = new Set(cells);
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    if (!cells.has(cellKey(from, slot))) continue;
    for (const date of to) next.add(cellKey(date, slot));
  }
  return next;
}

/** 링크 행들 → 직원 id별 가능 시간. 아직 비어 있는 행은 뺀다. */
export function availabilityFromLinks(rows: { employee_id: string; slots: AvailabilitySlots }[]): Record<string, AvailabilitySlots> {
  return Object.fromEntries(rows.filter((r) => Object.keys(r.slots).length > 0).map((r) => [r.employee_id, r.slots]));
}

export function sameAvailability(a: Record<string, AvailabilitySlots>, b: Record<string, AvailabilitySlots>): boolean {
  return stableJson(a) === stableJson(b);
}

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

/** 구간의 시작 칸과 끝 칸(미포함). */
export function slotSpan([from, to]: TimeRange): [number, number] {
  return [slotOf(from), slotOf(to)];
}

/** 그날 근무조 시각을 완전히 덮는 직원 수. 배정과 같은 기준으로 센다. */
export function availableCount(slotsList: AvailabilitySlots[], date: string, shift: ShiftDef, config: ShopConfig): number {
  return slotsList.filter((slots) => coversShift(slots[date] ?? [], shift, config)).length;
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
