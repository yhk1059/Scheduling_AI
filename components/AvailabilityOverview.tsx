"use client";

import { useState } from "react";

import { availableCount, SLOT_COUNT, slotSpan, type AvailabilitySlots } from "@/lib/availability";
import { isWeekendDay, periodDays, type PeriodDay } from "@/lib/period";
import type { AvailabilityLink } from "@/lib/supabase";
import { coverageCodes, type ShopEmployee, type WorkPeriod } from "@/lib/store";
import type { ShopConfig } from "@/lib/types.gen";

import { ui } from "./ui";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_PER_PAGE = 7;
const HEAD_HEIGHT = 24;
const SLOT_HEIGHT = 6;
/** 3시간마다 시각과 줄을 긋는다(06, 09, … 21시). */
const HOUR_SLOTS = Array.from({ length: SLOT_COUNT / 6 }, (_, i) => i * 6);

const dayColor = (day: PeriodDay, weekend: boolean) =>
  day.weekday === 0 || (weekend && day.weekday !== 6) ? "text-[#B42318]" : day.weekday === 6 ? "text-[#155E75]" : "text-[#3D3D38]";

/** ① 직원이 제출한 가능 시간 모아 보기: 날짜별 가능 인원 + 직원별 읽기 전용 캘린더. 2주 이상이면 모두 같은 주로 함께 넘긴다. */
export default function AvailabilityOverview({
  period,
  employees,
  rows,
  config,
}: {
  period: WorkPeriod;
  employees: ShopEmployee[];
  rows: AvailabilityLink[];
  config: ShopConfig;
}) {
  const [page, setPage] = useState(0);
  const days = periodDays(period);
  const pages = Math.ceil(days.length / DAYS_PER_PAGE);
  const shown = days.slice(page * DAYS_PER_PAGE, (page + 1) * DAYS_PER_PAGE);
  const weekend = (d: PeriodDay) => isWeekendDay(period, d.day, period.holidays);
  const rowOf = (id: string) => rows.find((r) => r.employee_id === id);
  const slotsList = employees.map((n) => rowOf(n.id)?.slots ?? {});

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className={ui.cardTitle}>직원별 가능 시간</h3>
        <p className={`${ui.help} mr-auto flex items-center gap-1.5`}>
          <span aria-hidden="true" className="size-3 rounded-xs bg-[#155E75]" />
          칠한 곳이 일할 수 있는 시간이에요
        </p>
        {pages > 1 && (
          <>
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={`${ui.textSm} disabled:text-[#9A9A91]`}>
              이전 주
            </button>
            <span className="font-mono text-xs text-[#66665E]">
              {page + 1}/{pages}
            </span>
            <button type="button" disabled={page === pages - 1} onClick={() => setPage((p) => p + 1)} className={`${ui.textSm} disabled:text-[#9A9A91]`}>
              다음 주
            </button>
          </>
        )}
      </div>

      <div className={`${ui.card} sticky top-0 z-10`}>
        <table aria-label="날짜별 가능 인원" className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-[#E2E2DC]">
              <th className="w-44 py-1.5 text-left text-xs font-medium text-[#66665E]">날짜별 가능 인원</th>
              {shown.map((d) => (
                <th key={d.date} className={`py-1.5 text-center text-xs font-medium ${dayColor(d, weekend(d))}`}>
                  {WEEKDAYS[d.weekday]}{" "}
                  <span className="font-mono">
                    {d.month}/{d.dom}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coverageCodes(config).map((s) => (
              <tr key={s.code} className="border-b border-[#EFEFEB] last:border-b-0">
                <th scope="row" className="py-1 text-left text-[13px] font-medium text-[#1B1B18]">
                  {s.name}{" "}
                  <span className="font-mono text-xs font-normal text-[#66665E]">
                    {s.start}~{s.end}
                  </span>
                </th>
                {shown.map((d) => (
                  <td key={d.date} className="py-1 text-center font-mono text-[13px] text-[#1B1B18]">
                    {availableCount(slotsList, d.date, s, config)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {employees.map((n) => {
          const row = rowOf(n.id);
          return (
            <section key={n.id} aria-label={`${n.name} 가능 시간`} className={`${ui.card} flex min-w-0 flex-col gap-2 px-3! py-3!`}>
              <div className="flex h-[22px] items-center gap-1.5">
                <h4 className="truncate text-[13px] font-semibold text-[#1B1B18]">{n.name}</h4>
                {n.tags.map((tag) => (
                  <span key={tag} className={`${ui.badge} ${ui.badgeTone.base}`}>
                    {tag}
                  </span>
                ))}
                {!row?.submitted_at && <span className={`${ui.badge} ${ui.badgeTone.excluded} ml-auto`}>미제출</span>}
              </div>
              <MiniCalendar days={shown} slots={row?.slots ?? {}} weekend={weekend} />
            </section>
          );
        })}
      </div>
    </section>
  );
}

/** 칠한 시간을 칸마다 그리지 않고 이어진 구간 하나를 덩어리 하나로 그린다. */
function MiniCalendar({ days, slots, weekend }: { days: PeriodDay[]; slots: AvailabilitySlots; weekend: (d: PeriodDay) => boolean }) {
  return (
    <div
      className="grid overflow-hidden rounded-md border border-[#E2E2DC] bg-white"
      style={{
        gridTemplateColumns: `28px repeat(${days.length}, minmax(0, 1fr))`,
        gridTemplateRows: `${HEAD_HEIGHT}px repeat(${SLOT_COUNT}, ${SLOT_HEIGHT}px)`,
      }}
    >
      {days.map((d, col) => (
        <span
          key={d.date}
          aria-hidden="true"
          className={`border-l border-[#E2E2DC] ${weekend(d) ? "bg-[#F6F4EE]" : ""}`}
          style={{ gridColumn: col + 2, gridRow: `1 / span ${SLOT_COUNT + 1}` }}
        />
      ))}
      {days.map((d, col) => (
        <span
          key={d.date}
          aria-hidden="true"
          className={`flex items-center justify-center text-[11px] font-medium ${dayColor(d, weekend(d))}`}
          style={{ gridColumn: col + 2, gridRow: 1 }}
        >
          {WEEKDAYS[d.weekday]}
        </span>
      ))}
      {HOUR_SLOTS.map((slot) => (
        <span
          key={slot}
          aria-hidden="true"
          className="border-t border-[#E2E2DC] pt-0.5 pr-1 text-right font-mono text-[10px] leading-none text-[#66665E]"
          style={{ gridColumn: 1, gridRow: `${slot + 2} / span 6` }}
        >
          {String(6 + slot / 2).padStart(2, "0")}
        </span>
      ))}
      {HOUR_SLOTS.map((slot) => (
        <span key={slot} aria-hidden="true" className="border-t border-[#E2E2DC]" style={{ gridColumn: "2 / -1", gridRow: slot + 2 }} />
      ))}
      {days.flatMap((d, col) =>
        (slots[d.date] ?? []).map(([from, to]) => {
          const [start, end] = slotSpan([from, to]);
          const label = `${d.month}월 ${d.dom}일 ${from}~${to}`;
          return (
            <span
              key={`${d.date}-${from}`}
              role="img"
              aria-label={label}
              title={label}
              className="mx-px bg-[#155E75]"
              style={{ gridColumn: col + 2, gridRow: `${start + 2} / ${end + 2}` }}
            />
          );
        }),
      )}
    </div>
  );
}
