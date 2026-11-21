"use client";

import { useId, useState, type ReactNode } from "react";

import { availableCount, coversShift } from "@/lib/availability";
import { effectiveCoverage, staffingTone, type StaffingTone } from "@/lib/coverage-conflict";
import { isWeekendDay, periodDays } from "@/lib/period";
import type { AvailabilityLink } from "@/lib/supabase";
import { coverageCodes, type ShopEmployee, type WorkPeriod } from "@/lib/store";
import type { ConstraintSpec, ShopConfig } from "@/lib/types.gen";

import { WEEKDAYS, codeClass } from "./ScheduleStep";
import { ui } from "./ui";

const TONES: Record<StaffingTone, { dot: string; text: string }> = {
  ok: { dot: "bg-[#12B76A]", text: "여유" },
  tight: { dot: "bg-[#FF7A1A]", text: "빠듯" },
  short: { dot: "bg-[#F04438]", text: "부족" },
};

export default function AvailabilityOverview({
  period, employees, rows, config, rules, preparation, submission,
}: {
  period: WorkPeriod;
  employees: ShopEmployee[];
  rows: AvailabilityLink[] | null;
  config: ShopConfig;
  rules: ConstraintSpec[];
  preparation: ReactNode;
  submission: ReactNode;
}) {
  const detailId = useId();
  const [week, setWeek] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const days = periodDays(period);
  const pages = Math.ceil(days.length / 7);
  const page = Math.min(week, pages - 1);
  const shown = days.slice(page * 7, (page + 1) * 7);
  const codes = coverageCodes(config);
  const rowById = new Map(rows?.map((row) => [row.employee_id, row]));
  const selected = employees.find((n) => n.id === selectedId) ?? employees[0];
  const selectedRow = selected && rowById.get(selected.id);
  const slotsList = employees.map((n) => rowById.get(n.id)?.slots ?? {});
  const label = (d: (typeof days)[number]) => `${WEEKDAYS[d.weekday]} ${d.month}/${d.dom}`;
  const totals = codes.map((shift) => shown.map((d) => {
    const count = availableCount(slotsList, d.date, shift, config);
    const kind = isWeekendDay(period, d.day, period.holidays) ? "weekend" : "weekday";
    return { count, tone: staffingTone(count, effectiveCoverage(rules, shift.code, kind, period, period.holidays)) };
  }));

  return (
    <div className={ui.workLayout}>
      <div className="flex min-w-0 flex-col gap-4">
        {preparation}
        {rows && (
          <section className={`${ui.card} flex min-w-0 flex-col gap-3 px-3! sm:px-5!`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={ui.cardTitle}>직원별 가능 시간</h3>
              {pages > 1 && (
                <div className="flex items-center gap-1">
                  <button type="button" disabled={page === 0} onClick={() => setWeek(page - 1)} className={`${ui.textSm} disabled:opacity-40`}>이전 주</button>
                  <span role="status" className={ui.help}>{page + 1}/{pages}주</span>
                  <button type="button" disabled={page === pages - 1} onClick={() => setWeek(page + 1)} className={`${ui.textSm} disabled:opacity-40`}>다음 주</button>
                </div>
              )}
            </div>
            <ul aria-label="근무조 범례" className="flex flex-wrap gap-2">
              {codes.map((shift) => <li key={shift.code} className={`${ui.badge} ${codeClass(shift.code, false, config)}`}>{shift.name}</li>)}
            </ul>
            <table aria-label="직원별 가능 시간과 날짜별 가능 인원" className="w-full table-fixed border-collapse text-center">
              <thead>
                <tr className="border-b border-[#EDEDEA] text-xs">
                  <th scope="col" className="w-[24%] py-2 text-left">직원</th>
                  {shown.map((d) => <th key={d.date} scope="col" className={`font-medium ${isWeekendDay(period, d.day, period.holidays) ? "text-[#C4247C]" : "text-[#4B4F57]"}`}>{label(d)}</th>)}
                </tr>
              </thead>
              <tbody>
                {employees.map((n) => {
                  const row = rowById.get(n.id);
                  const active = n.id === selected?.id;
                  return (
                    <tr key={n.id} onClick={() => setSelectedId(n.id)} className={`cursor-pointer border-b border-[#EDEDEA] hover:bg-[#F5F5F4] ${active ? "bg-[#FDEAF4]" : ""}`}>
                      <th scope="row" className="py-1.5 text-left">
                        <button type="button" aria-controls={detailId} aria-pressed={active} onClick={() => setSelectedId(n.id)} className="block w-full rounded px-1 py-1 text-left text-xs wrap-anywhere focus-visible:outline-2 focus-visible:outline-[#C4247C]">
                          {n.name}
                          <span className="block text-[11px] font-normal text-[#6B6F78]">{row?.submitted_at ? n.tags.join(" · ") : "미제출"}</span>
                        </button>
                      </th>
                      {shown.map((d) => (
                        <td key={d.date} className="px-0.5 py-1.5">
                          <div className="flex flex-col gap-0.5">
                            {codes.map((shift) => {
                              const available = coversShift(row?.slots[d.date] ?? [], shift, config);
                              return (
                                <span key={shift.code} className={`block h-1 overflow-hidden rounded-full border-0! ${available ? codeClass(shift.code, false, config) : "bg-[#EDEDEA]"}`}>
                                  {available && <span aria-hidden="true" className="block h-full bg-current" />}
                                  <span className="sr-only">{shift.name} {available ? "가능" : "불가"}</span>
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {codes.length > 0 && (
                  <tr>
                    <th scope="row" className="py-1 text-left text-xs font-medium">
                      <span className="sr-only">가능 인원</span>
                      {codes.map((shift) => <span key={shift.code} className="block leading-5 wrap-anywhere">{shift.name}</span>)}
                    </th>
                    {shown.map((d, j) => (
                      <td key={d.date} className="text-xs">
                        {codes.map((shift, i) => {
                          const { count, tone } = totals[i][j];
                          return (
                            <span key={shift.code} className="block leading-5">
                              <span className="sr-only">{shift.name} </span>
                              {tone && <span aria-hidden="true" className={`mr-0.5 inline-block size-1.5 rounded-full ${TONES[tone].dot}`} />}
                              {count}<span className="sr-only">명{tone && `, ${TONES[tone].text}`}</span>
                            </span>
                          );
                        })}
                      </td>
                    ))}
                  </tr>
                )}
              </tfoot>
            </table>
            {totals.some((row) => row.some(({ tone }) => tone)) && (
              <ul aria-label="필요 인원 대비 가능 인원" className={`${ui.help} flex flex-wrap gap-3`}>
                {Object.entries(TONES).map(([key, { dot, text }]) => <li key={key}><span aria-hidden="true" className={`mr-1 inline-block size-1.5 rounded-full ${dot}`} />{text}</li>)}
              </ul>
            )}
          </section>
        )}
      </div>
      <aside aria-label="제출 현황과 직원 상세" className={ui.workAside}>
        {submission}
        {rows && selected && (
          <section id={detailId} aria-label={`${selected.name} 가능 시간`} className={`${ui.card} flex flex-col gap-2`}>
            <h3 className={`${ui.cardTitle} wrap-anywhere`}>{selected.name} 가능 시간</h3>
            {selected.tags.length > 0 && <p className={`${ui.help} wrap-anywhere`}>{selected.tags.join(" · ")}</p>}
            {selectedRow?.submitted_at ? (
              <dl>
                {shown.map((d) => (
                  <div key={d.date} className="flex items-baseline justify-between gap-2 border-b border-[#EDEDEA] py-1.5 text-sm last:border-b-0">
                    <dt className="shrink-0">{label(d)}</dt>
                    <dd className="text-right text-[#4B4F57]">{(selectedRow.slots[d.date] ?? []).map(([start, end]) => `${start}~${end}`).join(" · ") || "가능 시간 없음"}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className={ui.help}>아직 제출하지 않았어요.</p>}
          </section>
        )}
      </aside>
    </div>
  );
}
