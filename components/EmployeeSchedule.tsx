"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { employeeDays, employeeTotals, weekPages, type EmployeeDay } from "@/lib/confirmed-view";
import { formatRange, isWeekendDay } from "@/lib/period";
import { OFF_CODE } from "@/lib/rules";
import { getConfirmedSchedule, type ConfirmedSchedule } from "@/lib/supabase";
import type { Employee, ScheduleResult, ShiftDef, ShopConfig } from "@/lib/types.gen";

import { LoadMessage, PAGE, TopLine } from "./AvailabilityForm";
import { CELL, cellText, codeClass, ScheduleGrid } from "./ScheduleStep";
import { shortTime } from "./ShopHome";
import { ui } from "./ui";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const NO_FIXED = new Map<string, string>();

type Load = { kind: "loading" } | { kind: "error" } | { kind: "not_found" } | { kind: "ok"; schedule: ConfirmedSchedule };

/** 확정된 근무표(/a/{공용 토큰}에서 이름을 고른 뒤). 토큰 DB 함수로만 읽고 store를 쓰지 않는다. 보기 전용이다. */
export default function EmployeeSchedule({ token, name, onBack }: { token: string; name: string; onBack: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    getConfirmedSchedule(token)
      .then((schedule) => {
        if (live) setLoad(schedule ? { kind: "ok", schedule } : { kind: "not_found" });
      })
      .catch(() => {
        if (live) setLoad({ kind: "error" });
      });
    return () => {
      live = false;
    };
  }, [token, attempt]);

  const retry = () => setAttempt((n) => n + 1);
  if (load.kind === "ok") return <ScheduleView schedule={load.schedule} name={name} onBack={onBack} />;
  if (load.kind === "not_found")
    return (
      <main className={`${PAGE} flex-col gap-4 py-6`}>
        <TopLine label="근무표" />
        <div role="alert" className={ui.banner}>
          확정 근무표를 아직 불러올 수 없어요. 잠시 뒤 다시 열어 주세요
          <button type="button" onClick={retry} className={ui.textSm}>
            다시 시도
          </button>
        </div>
      </main>
    );
  return <LoadMessage kind={load.kind} onRetry={retry} label="근무표" />;
}

function ScheduleView({ schedule, name, onBack }: { schedule: ConfirmedSchedule; name: string; onBack: () => void }) {
  const range = { start_date: schedule.period_start, length: schedule.period_length };
  const config: ShopConfig | undefined = schedule.shifts.length ? { shifts: schedule.shifts as ShopConfig["shifts"] } : undefined;
  const days = employeeDays(schedule, name);
  // 직원 id가 없으므로 이름을 행 id로 쓴다(명단에서 이름은 겹치지 않는다)
  const rows: Employee[] = schedule.rows.map((r) => ({ id: r.name, name: r.name, active: true, tags: [] }));
  const result: ScheduleResult = {
    assignments: Object.fromEntries(schedule.rows.map((r) => [r.name, r.codes])),
    summary: { preferences_total: 0, preferences_met: 0, soft_violation_count: 0 },
    stats: {},
    soft_violations: [],
    diff: null,
    optimal: true,
  };

  return (
    <main className={`${PAGE} flex-col gap-6 py-6`}>
      <TopLine label="근무표" />
      <header className="flex items-start gap-3">
        <div className="mr-auto flex min-w-0 flex-col gap-1">
          <h1 className={ui.pageTitle}>
            {schedule.shop_name} · {name}님의 근무표
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-[#66665E]">
            <span className="font-mono">{formatRange(range)}</span>
            <span>
              확정 <span className="font-mono">{shortTime(schedule.confirmed_at)}</span>
            </span>
          </p>
        </div>
        <button type="button" onClick={onBack} className={`${ui.textSm} shrink-0`}>
          이름 다시 고르기
        </button>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className={ui.sectionTitle}>내 근무</h2>
        {days ? (
          weekPages(days).map((week) => <WeekCard key={week[0].date} name={name} week={week} shifts={schedule.shifts} config={config} />)
        ) : (
          <p className="text-sm text-[#3D3D38]">이 근무표에는 {name}님의 근무가 없어요.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={ui.sectionTitle}>전체 근무표</h2>
        <div className={ui.card}>
          <ScheduleGrid
            config={config}
            rows={rows}
            result={result}
            period={range}
            holidays={schedule.holidays}
            isWeekend={(d) => isWeekendDay(range, d, schedule.holidays)}
            fixed={NO_FIXED}
            selected={null}
            disabled
            readOnly
            onSelect={() => {}}
            hideViolations
            highlightId={name}
          />
        </div>
      </section>

      <Link href="/privacy" className={`${ui.text} self-start`}>
        개인정보처리방침
      </Link>
    </main>
  );
}

/** 한 주(최대 7일). 칸마다 요일·날짜, 근무 셀, 근무조 이름과 시각. */
function WeekCard({ name, week, shifts, config }: { name: string; week: EmployeeDay[]; shifts: ShiftDef[]; config: ShopConfig | undefined }) {
  const { workDays, hours } = employeeTotals(week, shifts);
  return (
    <div className={`${ui.card} flex flex-col gap-3`}>
      <p className="text-[13px] font-medium text-[#3D3D38]">
        근무 <span className="font-mono">{workDays}</span>일 · <span className="font-mono">{hours}</span>시간
      </p>
      <ul className="flex flex-col gap-1 sm:grid sm:grid-cols-7 sm:gap-2">
        {week.map((d) => {
          const [, month, dom] = d.date.split("-").map(Number);
          const holiday = d.weekend && d.weekday !== 0 && d.weekday !== 6;
          const color = d.weekday === 0 || holiday ? "text-[#B42318]" : d.weekday === 6 ? "text-[#155E75]" : "text-[#3D3D38]";
          const off = d.code === "" || d.code === OFF_CODE;
          return (
            <li
              key={d.date}
              className={`flex items-center gap-3 rounded-md px-2 py-1.5 sm:flex-col sm:gap-1.5 sm:px-0 sm:py-2 ${d.weekend ? "bg-[#F1EEE6]" : ""}`}
            >
              <span className={`w-14 font-mono text-xs font-medium sm:w-auto ${color}`}>
                {WEEKDAYS[d.weekday]} {month}/{dom}
              </span>
              <span
                role="img"
                aria-label={`${name} ${month}월 ${dom}일 ${d.code}`}
                className={`${CELL} ${off ? codeClass(OFF_CODE, d.weekend, config) : codeClass(d.code, d.weekend, config)}`}
              >
                {cellText(d.code)}
              </span>
              <span className={`text-xs sm:text-center ${off ? "text-[#66665E]" : "text-[#1B1B18]"}`}>{d.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
