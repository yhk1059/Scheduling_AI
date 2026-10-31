"use client";

import { periodDays } from "@/lib/period";
import { useAppStore, type WorkPeriod } from "@/lib/store";

import { today } from "./RulesStep";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 기간 달력. 기간이 걸친 달마다 그리고, 기간 안의 날짜를 누르면 공휴일 체크를 토글한다. */
export default function HolidayCalendar({ period }: { period: WorkPeriod }) {
  const { holidays } = period;
  const toggleHoliday = useAppStore((s) => s.toggleHoliday);
  const now = today();

  // "YYYY-MM" → 그 달의 기간 날짜(dom → day 인덱스)
  const months = new Map<string, Map<number, number>>();
  for (const { day, date, dom } of periodDays(period)) {
    const key = date.slice(0, 7);
    if (!months.has(key)) months.set(key, new Map());
    months.get(key)!.set(dom, day);
  }

  return (
    <div className="flex flex-wrap gap-8">
      {[...months].map(([key, inPeriod]) => {
        const [year, month] = key.split("-").map(Number);
        const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
        const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-[#1B1B18]">
              {year}년 {month}월
            </span>
            <div className="inline-grid grid-cols-[repeat(7,40px)] gap-0.5">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1 text-center text-xs font-medium text-[#66665E]">
                  {w}
                </span>
              ))}
              {Array.from({ length: offset }, (_, i) => (
                <span key={`pad-${i}`} />
              ))}
              {Array.from({ length }, (_, i) => {
                const dom = i + 1;
                const isToday = `${key}-${String(dom).padStart(2, "0")}` === now;
                const day = inPeriod.get(dom);
                if (day === undefined) {
                  return (
                    <span
                      key={dom}
                      aria-hidden="true"
                      className={`flex h-8 items-center justify-center rounded-xs border font-mono text-[13px] text-[#9A9A91] ${
                        isToday ? "border-[#1B1B18]" : "border-transparent"
                      }`}
                    >
                      {dom}
                    </span>
                  );
                }
                const holiday = holidays.includes(day);
                return (
                  <button
                    key={dom}
                    type="button"
                    aria-pressed={holiday}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`${month}월 ${dom}일 공휴일${holiday ? " 해제" : " 지정"}`}
                    onClick={() => toggleHoliday(period.id, day)}
                    className={`h-8 rounded-xs border font-mono text-[13px] transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155E75] ${
                      holiday
                        ? `bg-[#155E75] font-semibold text-white ${isToday ? "border-[#1B1B18]" : "border-[#155E75]"}`
                        : `bg-white text-[#1B1B18] hover:bg-[#EFEFEB] ${isToday ? "border-[#1B1B18]" : "border-[#E2E2DC]"}`
                    }`}
                  >
                    {dom}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
