// 기간 날짜 계산 (ADR-015). "YYYY-MM-DD"를 UTC 자정 기준 일수로만 다뤄 브라우저 타임존과 무관하게 한다.

/** 병동의 기간 단위. 첫 기간은 아무 날에서 시작할 수 있고(달력 월은 1~28일), 이후는 연속이다(ADR-018). */
export type PeriodUnit = "1w" | "2w" | "4w" | "month";
/** 백엔드 Period와 같은 모양. start_date는 "YYYY-MM-DD". */
export interface PeriodRange {
  start_date: string;
  length: number;
}
/** 기간 안의 하루. month는 1-based, weekday는 0=일. */
export interface PeriodDay {
  day: number;
  date: string;
  month: number;
  dom: number;
  weekday: number;
}

export const PERIOD_UNITS: { value: PeriodUnit; label: string }[] = [
  { value: "1w", label: "1주" },
  { value: "2w", label: "2주" },
  { value: "4w", label: "4주" },
  { value: "month", label: "달력 월" },
];
export const MAX_PERIOD_DAYS = 31; // backend/domain/constants.py와 같은 값
/** 달력 월 단위의 시작일 상한(★11) */
export const MAX_MONTH_START_DAY = 28;

const WEEK_DAYS: Record<Exclude<PeriodUnit, "month">, number> = { "1w": 7, "2w": 14, "4w": 28 };
const MS_PER_DAY = 86_400_000;

/** "YYYY-MM-DD" → 1970-01-01부터의 일수. */
function toSerial(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

function fromSerial(serial: number): string {
  return new Date(serial * MS_PER_DAY).toISOString().slice(0, 10);
}

function parts(serial: number): { year: number; month: number; dom: number; weekday: number } {
  const dt = new Date(serial * MS_PER_DAY);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, dom: dt.getUTCDate(), weekday: dt.getUTCDay() };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 첫 근무표 시작일 기본 제안값: today 또는 그 이후의 첫 월요일(주 단위)·1일(달력 월). */
export function firstPeriodStart(unit: PeriodUnit, today: string): string {
  const s = toSerial(today);
  const { year, month, dom, weekday } = parts(s);
  if (unit === "month") {
    if (dom === 1) return today;
    return fromSerial(Date.UTC(year, month, 1) / MS_PER_DAY);
  }
  return fromSerial(s + ((8 - weekday) % 7)); // 월요일(1)까지 남은 날
}

/** 시작일로 쓸 수 있는지. 달력 월은 1~28일만(다음 달에 같은 날이 있어야 한다). 주 단위는 아무 날. */
export function validStart(unit: PeriodUnit, date: string): boolean {
  return unit !== "month" || parts(toSerial(date)).dom <= MAX_MONTH_START_DAY;
}

/**
 * start에서 시작하는 기간. 주 단위는 7·14·28일, 달력 월은 다음 달 같은 날 전날까지(1일이면 그 달 전체).
 * start가 유효한 시작일인지는 validStart로 따로 본다.
 */
export function periodFrom(unit: PeriodUnit, start: string): PeriodRange {
  if (unit === "month") {
    const { year, month } = parts(toSerial(start));
    return { start_date: start, length: daysInMonth(year, month) };
  }
  return { start_date: start, length: WEEK_DAYS[unit] };
}

/** 직전 기간 다음 날에 시작하는 기간. 달력 월인데 그날이 29~31일이면 다음 달 1일에서 시작한다. */
export function nextPeriod(unit: PeriodUnit, prev: PeriodRange): PeriodRange {
  const after = dateOfDay(prev, prev.length + 1);
  return periodFrom(unit, validStart(unit, after) ? after : firstPeriodStart(unit, after));
}

/** 브라우저 시간대의 오늘 "YYYY-MM-DD". */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 마지막 날짜(포함). */
export function periodEnd(p: PeriodRange): string {
  return dateOfDay(p, p.length);
}

/** 1-based 날짜 인덱스 → "YYYY-MM-DD". */
export function dateOfDay(p: PeriodRange, day: number): string {
  return fromSerial(toSerial(p.start_date) + day - 1);
}

/** "YYYY-MM-DD" → 1-based 인덱스. 범위 밖이면 null. */
export function dayOfDate(p: PeriodRange, date: string): number | null {
  const day = toSerial(date) - toSerial(p.start_date) + 1;
  return day >= 1 && day <= p.length ? day : null;
}

/** 인덱스별 { day, date, month, dom, weekday(0=일) } 목록. */
export function periodDays(p: PeriodRange): PeriodDay[] {
  const start = toSerial(p.start_date);
  return Array.from({ length: p.length }, (_, i) => {
    const { month, dom, weekday } = parts(start + i);
    return { day: i + 1, date: fromSerial(start + i), month, dom, weekday };
  });
}

/** 1-based 인덱스 → 실제 날짜 "M/D". */
export function monthDay(p: PeriodRange, day: number): string {
  const { month, dom } = parts(toSerial(p.start_date) + day - 1);
  return `${month}/${dom}`;
}

/** 토·일 또는 holidays(인덱스)에 있으면 true. */
export function isWeekendDay(p: PeriodRange, day: number, holidays: number[]): boolean {
  const { weekday } = parts(toSerial(p.start_date) + day - 1);
  return weekday === 0 || weekday === 6 || holidays.includes(day);
}

/** 표기: "2026.11.23 – 12.6"(같은 해), 해가 바뀌면 끝에도 연도. */
export function formatRange(p: PeriodRange): string {
  const s = parts(toSerial(p.start_date));
  const e = parts(toSerial(periodEnd(p)));
  const end = s.year === e.year ? `${e.month}.${e.dom}` : `${e.year}.${e.month}.${e.dom}`;
  return `${s.year}.${s.month}.${s.dom} – ${end}`;
}

/** 날짜 헤더: 기간 첫날이거나 달의 1일이면 "M/D", 아니면 "D". */
export function dayHeader(p: PeriodRange, day: number): string {
  const { month, dom } = parts(toSerial(p.start_date) + day - 1);
  return day === 1 || dom === 1 ? `${month}/${dom}` : String(dom);
}

/** 기간 단위 표기 "1주" 등. */
export function unitLabel(unit: PeriodUnit): string {
  return PERIOD_UNITS.find((u) => u.value === unit)!.label;
}
