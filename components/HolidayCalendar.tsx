"use client";

import { useAppStore } from "@/lib/store";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 대상 월 달력. 날짜를 누르면 공휴일 체크를 토글한다. */
export default function HolidayCalendar() {
  const { year, month } = useAppStore((s) => s.period);
  const holidays = useAppStore((s) => s.holidays);
  const toggleHoliday = useAppStore((s) => s.toggleHoliday);

  const days = new Date(year, month, 0).getDate();
  const offset = new Date(year, month - 1, 1).getDay();

  return (
    <div className="inline-grid grid-cols-[repeat(7,40px)] gap-0.5">
      {WEEKDAYS.map((w, i) => (
        <span
          key={w}
          className={`py-1 text-center text-xs font-medium ${
            i === 0 ? "text-[#B42318]" : i === 6 ? "text-[#155E75]" : "text-[#66665E]"
          }`}
        >
          {w}
        </span>
      ))}
      {Array.from({ length: offset }, (_, i) => (
        <span key={`pad-${i}`} />
      ))}
      {Array.from({ length: days }, (_, i) => {
        const day = i + 1;
        const dow = (offset + i) % 7;
        const holiday = holidays.includes(day);
        const weekend = dow === 0 || dow === 6;
        return (
          <button
            key={day}
            type="button"
            aria-pressed={holiday}
            aria-label={`${month}월 ${day}일 공휴일${holiday ? " 해제" : " 지정"}`}
            onClick={() => toggleHoliday(day)}
            className={`h-8 rounded-xs border font-mono text-[13px] transition-colors duration-[120ms] ${
              holiday
                ? "border-[#B42318] bg-[#FBE9E7] font-semibold text-[#9F1F14]"
                : `border-transparent hover:bg-[#EFEFEB] ${weekend ? "bg-[#F1EEE6]" : "bg-white"} ${
                    dow === 0 ? "text-[#B42318]" : dow === 6 ? "text-[#155E75]" : "text-[#1B1B18]"
                  }`
            }`}
          >
            {day}
          </button>
        );
      })}
    </div>
  );
}
