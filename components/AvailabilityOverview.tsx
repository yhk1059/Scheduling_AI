"use client";

import { useState } from "react";

import { availableCount, SLOT_COUNT, slotSpan, type AvailabilitySlots } from "@/lib/availability";
import { effectiveCoverage, staffingTone, type StaffingTone } from "@/lib/coverage-conflict";
import { isWeekendDay, periodDays, type PeriodDay } from "@/lib/period";
import type { AvailabilityLink } from "@/lib/supabase";
import { coverageCodes, type ShopEmployee, type WorkPeriod } from "@/lib/store";
import type { ConstraintSpec, ShopConfig } from "@/lib/types.gen";

import { ui } from "./ui";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_PER_PAGE = 7;
const HEAD_HEIGHT = 24;
const SLOT_HEIGHT = 6;
/** 3시간마다 시각과 줄을 긋는다(06, 09, … 21시). */
const HOUR_SLOTS = Array.from({ length: SLOT_COUNT / 6 }, (_, i) => i * 6);

/** 가능 인원 칸의 상태: 점 색, 글자 색, 화면 읽기용 말. */
const TONES: Record<StaffingTone, { dot: string; ink: string; text: string }> = {
  ok: { dot: "bg-[#12B76A]", ink: "text-[#111214]", text: "여유" },
  tight: { dot: "bg-[#FF7A1A]", ink: "text-[#B93815]", text: "빠듯" },
  short: { dot: "bg-[#F04438]", ink: "text-[#B42318]", text: "부족" },
};

const dayColor = (day: PeriodDay, weekend: boolean) =>
  day.weekday === 0 || (weekend && day.weekday !== 6) ? "text-[#B42318]" : day.weekday === 6 ? "text-[#C4247C]" : "text-[#4B4F57]";

/**
 * ① 직원이 제출한 가능 시간 모아 보기: 날짜별 가능 인원 + 직원별 읽기 전용 캘린더. 2주 이상이면 모두 같은 주로 함께 넘긴다.
 * 가능 인원 칸에는 켜진 반드시 필요 인원과 비교한 상태(여유·빠듯·부족)를 점으로 붙인다.
 */
export default function AvailabilityOverview({
  period,
  employees,
  rows,
  config,
  rules,
}: {
  period: WorkPeriod;
  employees: ShopEmployee[];
  rows: AvailabilityLink[];
  config: ShopConfig;
  rules: ConstraintSpec[];
}) {
  const [page, setPage] = useState(0);
  const days = periodDays(period);
  const pages = Math.ceil(days.length / DAYS_PER_PAGE);
  const shown = days.slice(page * DAYS_PER_PAGE, (page + 1) * DAYS_PER_PAGE);
  const weekend = (d: PeriodDay) => isWeekendDay(period, d.day, period.holidays);
  const rowOf = (id: string) => rows.find((r) => r.employee_id === id);
  const slotsList = employees.map((n) => rowOf(n.id)?.slots ?? {});
  const codes = coverageCodes(config);
  const needOf = (code: string, d: PeriodDay) => effectiveCoverage(rules, code, weekend(d) ? "weekend" : "weekday", period, period.holidays);
  const hasNeed = codes.some((s) => days.some((d) => needOf(s.code, d)));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className={ui.cardTitle}>직원별 가능 시간</h3>
        <p className={`${ui.help} mr-auto flex items-center gap-1.5`}>
          <span aria-hidden="true" className="size-3 rounded-xs bg-[#C4247C]" />
          칠한 곳이 일할 수 있는 시간이에요
        </p>
        {pages > 1 && (
          <>
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={`${ui.textSm} disabled:text-[#9499A2]`}>
              이전 주
            </button>
            <span className="font-mono text-xs text-[#6B6F78]">
              {page + 1}/{pages}
            </span>
            <button type="button" disabled={page === pages - 1} onClick={() => setPage((p) => p + 1)} className={`${ui.textSm} disabled:text-[#9499A2]`}>
              다음 주
            </button>
          </>
        )}
      </div>

      <div className={`${ui.card} sticky top-28 z-10 flex flex-col gap-2`}>
        <table aria-label="날짜별 가능 인원" className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-[#EDEDEA]">
              <th className="w-44 py-1.5 text-left text-xs font-medium text-[#6B6F78]">날짜별 가능 인원</th>
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
            {codes.map((s) => (
              <tr key={s.code} className="border-b border-[#F5F5F4] last:border-b-0">
                <th scope="row" className="py-1 text-left text-[13px] font-medium text-[#111214]">
                  {s.name}{" "}
                  <span className="font-mono text-xs font-normal text-[#6B6F78]">
                    {s.start}~{s.end}
                  </span>
                </th>
                {shown.map((d) => {
                  const count = availableCount(slotsList, d.date, s, config);
                  const tone = staffingTone(count, needOf(s.code, d));
                  return (
                    <td key={d.date} className="py-1 text-center">
                      <span className={`inline-flex items-center gap-1.5 font-mono text-[13px] ${tone ? `font-semibold ${TONES[tone].ink}` : "text-[#111214]"}`}>
                        {tone && <span aria-hidden="true" className={`size-1.5 rounded-full ${TONES[tone].dot}`} />}
                        {count}
                        {tone && <span className="sr-only">명, {TONES[tone].text}</span>}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {hasNeed && (
          <p className={`${ui.help} flex flex-wrap items-center gap-x-3 gap-y-1`}>
            {(["ok", "tight", "short"] as const).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-1.5 rounded-full ${TONES[t].dot}`} />
                {TONES[t].text}
              </span>
            ))}
            <span>반드시 필요 인원과 비교해요</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {employees.map((n) => {
          const row = rowOf(n.id);
          return (
            <section key={n.id} aria-label={`${n.name} 가능 시간`} className={`${ui.card} flex min-w-0 flex-col gap-2 px-3! py-3!`}>
              <div className="flex h-[22px] items-center gap-1.5">
                <h4 className="truncate text-[13px] font-semibold text-[#111214]">{n.name}</h4>
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
      className="grid overflow-hidden rounded-md border border-[#EDEDEA] bg-white"
      style={{
        gridTemplateColumns: `28px repeat(${days.length}, minmax(0, 1fr))`,
        gridTemplateRows: `${HEAD_HEIGHT}px repeat(${SLOT_COUNT}, ${SLOT_HEIGHT}px)`,
      }}
    >
      {days.map((d, col) => (
        <span
          key={d.date}
          aria-hidden="true"
          className={`border-l border-[#EDEDEA] ${weekend(d) ? "bg-[#F5F5F4]" : ""}`}
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
          className="border-t border-[#EDEDEA] pt-0.5 pr-1 text-right font-mono text-[10px] leading-none text-[#6B6F78]"
          style={{ gridColumn: 1, gridRow: `${slot + 2} / span 6` }}
        >
          {String(6 + slot / 2).padStart(2, "0")}
        </span>
      ))}
      {HOUR_SLOTS.map((slot) => (
        <span key={slot} aria-hidden="true" className="border-t border-[#EDEDEA]" style={{ gridColumn: "2 / -1", gridRow: slot + 2 }} />
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
              className="mx-px bg-[#C4247C]"
              style={{ gridColumn: col + 2, gridRow: `${start + 2} / ${end + 2}` }}
            />
          );
        }),
      )}
    </div>
  );
}
