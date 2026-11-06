// 한국 관공서 공휴일 (출처: 관공서의 공휴일에 관한 규정, 2023년 개정 대체공휴일 기준).
// 음력 날짜는 계산하지 않고 연도별 상수로 둔다. 2028년 이후는 2027년 안에 추가해야 한다(없는 연도는 공휴일 없음으로 본다).
import { dateOfDay, type PeriodRange } from "./period";

/** 연도별 관공서 공휴일(대체공휴일·선거일 포함). "YYYY-MM-DD" 오름차순. 상수에 없는 연도는 빈 배열로 본다. */
export const KR_HOLIDAYS: Record<number, { date: string; name: string }[]> = {
  2026: [
    { date: "2026-01-01", name: "신정" },
    { date: "2026-02-16", name: "설날 연휴" },
    { date: "2026-02-17", name: "설날" },
    { date: "2026-02-18", name: "설날 연휴" },
    { date: "2026-03-01", name: "삼일절" },
    { date: "2026-03-02", name: "대체공휴일(삼일절)" },
    { date: "2026-05-05", name: "어린이날" },
    { date: "2026-05-24", name: "부처님오신날" },
    { date: "2026-05-25", name: "대체공휴일(부처님오신날)" },
    { date: "2026-06-03", name: "지방선거일" },
    { date: "2026-06-06", name: "현충일" },
    { date: "2026-08-15", name: "광복절" },
    { date: "2026-08-17", name: "대체공휴일(광복절)" },
    { date: "2026-09-24", name: "추석 연휴" },
    { date: "2026-09-25", name: "추석" },
    { date: "2026-09-26", name: "추석 연휴" },
    { date: "2026-10-03", name: "개천절" },
    { date: "2026-10-05", name: "대체공휴일(개천절)" },
    { date: "2026-10-09", name: "한글날" },
    { date: "2026-12-25", name: "성탄절" },
  ],
  2027: [
    { date: "2027-01-01", name: "신정" },
    { date: "2027-02-06", name: "설날 연휴" },
    { date: "2027-02-07", name: "설날" },
    { date: "2027-02-08", name: "설날 연휴" },
    { date: "2027-02-09", name: "대체공휴일(설날)" },
    { date: "2027-03-01", name: "삼일절" },
    { date: "2027-05-05", name: "어린이날" },
    { date: "2027-05-13", name: "부처님오신날" },
    { date: "2027-06-06", name: "현충일" },
    { date: "2027-08-15", name: "광복절" },
    { date: "2027-08-16", name: "대체공휴일(광복절)" },
    { date: "2027-09-14", name: "추석 연휴" },
    { date: "2027-09-15", name: "추석" },
    { date: "2027-09-16", name: "추석 연휴" },
    { date: "2027-10-03", name: "개천절" },
    { date: "2027-10-04", name: "대체공휴일(개천절)" },
    { date: "2027-10-09", name: "한글날" },
    { date: "2027-10-11", name: "대체공휴일(한글날)" },
    { date: "2027-12-25", name: "성탄절" },
    { date: "2027-12-27", name: "대체공휴일(성탄절)" },
  ],
};

/** 날짜의 공휴일 이름. 아니면 null. (① 달력의 title/aria-label용) */
export function holidayName(date: string): string | null {
  const list = KR_HOLIDAYS[Number(date.slice(0, 4))] ?? [];
  return list.find((h) => h.date === date)?.name ?? null;
}

/** 기간 안의 공휴일을 날짜 인덱스(1..length, 오름차순)로. 상수에 없는 연도는 넣지 않는다. */
export function holidayDays(period: PeriodRange): number[] {
  const days: number[] = [];
  for (let day = 1; day <= period.length; day++) {
    if (holidayName(dateOfDay(period, day)) !== null) days.push(day);
  }
  return days;
}
