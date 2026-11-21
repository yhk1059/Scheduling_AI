"use client";

import { holidayName } from "@/lib/holidays";
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
          <div key={key} className="flex w-full max-w-[292px] flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-[#111214]">
              {year}년 {month}월
            </span>
            <div className="inline-grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1 text-center text-xs font-medium text-[#6B6F78]">
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
                      className={`flex h-8 items-center justify-center rounded-xs border font-mono text-[13px] text-[#9499A2] ${
                        isToday ? "border-[#111214]" : "border-transparent"
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
                    title={holidayName(`${key}-${String(dom).padStart(2, "0")}`) ?? undefined}
                    onClick={() => toggleHoliday(period.id, day)}
                    className={`h-8 rounded-xs border font-mono text-[13px] transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C4247C] ${
                      holiday
                        ? `bg-[#C4247C] font-semibold text-white ${isToday ? "border-[#111214]" : "border-[#C4247C]"}`
                        : `bg-white text-[#111214] hover:bg-[#F5F5F4] ${isToday ? "border-[#111214]" : "border-[#EDEDEA]"}`
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
