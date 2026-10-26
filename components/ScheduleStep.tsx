"use client";

import { useState } from "react";

import { ApiError, errorMessage, solve } from "@/lib/api";
import { toScheduleCsv } from "@/lib/csv";
import { type Assignments, type Code, useAppStore } from "@/lib/store";
import type { Nurse, ScheduleRequest, ScheduleResult } from "@/lib/types.gen";

import { Spinner } from "./RulesStep";
import { ui } from "./ui";

const CODES: Code[] = ["D", "E", "N", "O"];
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const CELL =
  "relative w-[30px] h-7 rounded-xs inline-flex items-center justify-center font-mono text-[13px] transition-colors duration-[120ms]";
const CODE_CLASS: Record<Code, string> = {
  D: "bg-[#FFF1C2] text-[#5C4300] font-semibold border border-transparent",
  E: "bg-[#F9CFAE] text-[#6E2A04] font-semibold border border-transparent",
  N: "bg-[#263248] text-white font-semibold border border-transparent",
  O: "text-[#6B6B63] font-normal border border-[#E2E2DC]",
};

function codeClass(code: Code, weekend: boolean): string {
  return code === "O" ? `${CODE_CLASS.O} ${weekend ? "bg-[#F1EEE6]" : "bg-white"}` : CODE_CLASS[code];
}

type Outcome = "infeasible" | "timeout" | null;
type Cell = { nurseId: string; day: number };

export default function ScheduleStep() {
  const nurses = useAppStore((s) => s.nurses);
  const period = useAppStore((s) => s.period);
  const holidays = useAppStore((s) => s.holidays);
  const constraints = useAppStore((s) => s.constraints);
  const result = useAppStore((s) => s.result);
  const confirmed = useAppStore((s) => s.confirmed);
  const setResult = useAppStore((s) => s.setResult);
  const setFixed = useAppStore((s) => s.setFixed);
  const clearFixed = useAppStore((s) => s.clearFixed);
  const confirm = useAppStore((s) => s.confirm);
  const setStep = useAppStore((s) => s.setStep);

  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
  // 마지막 요청을 다시 시도할 때 같은 previous로 보낸다
  const [lastPrevious, setLastPrevious] = useState<Assignments | null>(null);

  const run = async (previous: Assignments | null) => {
    setLoading(true);
    setError(null);
    setLastPrevious(previous);
    const s = useAppStore.getState();
    const req: Omit<ScheduleRequest, "input_version"> = {
      nurses: s.nurses as ScheduleRequest["nurses"],
      period: s.period,
      holidays: s.holidays,
      constraints: s.constraints,
      carry_over: s.carryOver,
      ...(previous && { previous }),
    };
    try {
      const res = await solve(req);
      if (res.input_version !== useAppStore.getState().inputVersion) return; // 풀이 중 입력이 바뀌면 버린다
      if (res.status === "ok") {
        setResult(res.result);
        setOutcome(null);
      } else {
        setOutcome(res.status);
      }
    } catch (e) {
      setError(errorMessage(e instanceof ApiError ? e : new ApiError("INTERNAL", String(e))));
    } finally {
      setLoading(false);
    }
  };

  const days = new Date(period.year, period.month, 0).getDate();
  const isWeekend = (d: number) => {
    const dow = new Date(period.year, period.month - 1, d).getDay();
    return dow === 0 || dow === 6 || holidays.includes(d);
  };
  const fixed = new Map<string, Code>();
  for (const c of constraints) {
    if (c.type === "fixed_assignment" && c.enabled !== false) fixed.set(`${c.params.nurse_id}-${c.params.day}`, c.params.shift);
  }

  const onPick = (cell: Cell, code: Code | null) => {
    setSelected(null);
    if (code === null) clearFixed(cell.nurseId, cell.day);
    else setFixed(cell.nurseId, cell.day, code);
    void run(result?.assignments ?? null);
  };

  const download = () => {
    if (!result) return;
    const csv = toScheduleCsv({ nurses, period, holidays, assignments: result.assignments, stats: result.stats });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `근무표-${period.year}-${String(period.month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isConfirmed = result !== null && confirmed !== null && JSON.stringify(confirmed) === JSON.stringify(result.assignments);
  const rows = result ? nurses.filter((n) => result.assignments[n.id]) : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold text-[#1B1B18]">근무표</h1>
          <p className="text-sm leading-relaxed text-[#3D3D38]">
            칸을 눌러 근무를 고정하면 나머지를 최소한으로 바꿔 다시 풀어요.
            {confirmed && " 확정본이 있으면 [생성]도 확정본에서 최소한으로 바꿔요."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <>
              <button type="button" onClick={confirm} disabled={loading || isConfirmed} className={ui.secondary}>
                {isConfirmed ? "확정됨" : "확정"}
              </button>
              <button type="button" onClick={download} disabled={loading} className={ui.secondary}>
                CSV 다운로드
              </button>
            </>
          )}
          <button type="button" onClick={() => void run(confirmed)} disabled={loading || nurses.length === 0} className={ui.primary}>
            {loading && <Spinner />}
            {loading ? "푸는 중…" : "생성"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between rounded-lg border border-[#E8B4AE] bg-white py-1.5 pr-2 pl-4 text-sm text-[#9F1F14]">
          {error}
          <button type="button" onClick={() => void run(lastPrevious)} className={ui.textSm}>
            다시 시도
          </button>
        </div>
      )}
      {outcome && (
        <p role="status" className="rounded-lg border border-[#E8B4AE] bg-white px-4 py-2.5 text-sm text-[#9F1F14]">
          {outcome === "infeasible" ? "해가 없습니다." : "시간 안에 풀지 못했습니다."}
          {result && <span className="text-[#66665E]"> 아래는 마지막으로 풀린 근무표예요.</span>}
        </p>
      )}

      {result ? (
        <>
          <SummaryCard result={result} outcome={outcome} confirmed={isConfirmed} />
          <section className={`${ui.card} flex flex-col gap-3`}>
            <div className="flex h-8 items-center justify-between gap-3">
              <h2 className={ui.cardTitle}>근무표</h2>
              {selected && (
                <CellEditor
                  label={`${nurses.find((n) => n.id === selected.nurseId)?.name ?? selected.nurseId} ${period.month}/${selected.day}`}
                  fixed={fixed.get(`${selected.nurseId}-${selected.day}`)}
                  onPick={(code) => onPick(selected, code)}
                  onCancel={() => setSelected(null)}
                />
              )}
            </div>
            <ScheduleGrid
              rows={rows}
              result={result}
              month={period.month}
              days={days}
              dow={(d) => new Date(period.year, period.month - 1, d).getDay()}
              holidays={holidays}
              isWeekend={isWeekend}
              fixed={fixed}
              selected={selected}
              disabled={loading}
              onSelect={setSelected}
            />
          </section>
          <StatsTable rows={rows} result={result} />
        </>
      ) : (
        !outcome && <p className="text-sm text-[#66665E]">[생성]을 누르면 지금까지 적용한 규칙과 요청으로 근무표를 만들어요.</p>
      )}

      <div>
        <button type="button" onClick={() => setStep(3)} className={ui.secondary}>
          이전
        </button>
      </div>
    </div>
  );
}

function SummaryCard({ result, outcome, confirmed }: { result: ScheduleResult; outcome: Outcome; confirmed: boolean }) {
  const { summary } = result;
  const item = "flex flex-col gap-1 border-r border-[#E2E2DC] px-5 py-3.5";
  const label = "text-xs font-medium text-[#66665E]";
  const value = "font-mono text-xl font-semibold";
  return (
    <section className="flex items-stretch rounded-lg border border-[#E2E2DC] bg-white">
      <div className={item}>
        <span className={label}>해 상태</span>
        <span className="flex h-7 items-center gap-2">
          {outcome ? (
            <span className={`${ui.badge} bg-[#FBE9E7] text-[#9F1F14]`}>해 없음</span>
          ) : (
            <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>해 있음</span>
          )}
          {!result.optimal && <span className={`${ui.badge} bg-[#FDF0DC] text-[#7A4506]`}>최적이 아닐 수 있음</span>}
          {confirmed && <span className={`${ui.badge} bg-[#1B1B18] text-white`}>확정됨</span>}
        </span>
      </div>
      <div className={item}>
        <span className={label}>희망 반영</span>
        <span className={`${value} text-[#1B1B18]`}>
          {summary.preferences_met}/{summary.preferences_total}
        </span>
      </div>
      <div className={item}>
        <span className={label}>soft 위반</span>
        <span className={`${value} text-[#A15C07]`}>{summary.soft_violation_count}</span>
      </div>
      {result.diff && (
        <div className={item}>
          <span className={label}>이전 대비 변경</span>
          <span className={`${value} text-[#1B1B18]`}>{result.diff.length}칸</span>
        </div>
      )}
    </section>
  );
}

function CellEditor({
  label,
  fixed,
  onPick,
  onCancel,
}: {
  label: string;
  fixed: Code | undefined;
  onPick: (code: Code | null) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-[#3D3D38]">
        <span className="font-mono">{label}</span> 고정
      </span>
      {CODES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onPick(code)}
          aria-label={`${code}로 고정`}
          aria-pressed={fixed === code}
          className={`${CELL} ${codeClass(code, false)} hover:opacity-80 aria-pressed:outline-2 aria-pressed:outline-[#155E75] aria-pressed:outline-offset-1`}
        >
          {code}
        </button>
      ))}
      {fixed && (
        <button type="button" onClick={() => onPick(null)} className={ui.textSm}>
          고정 해제
        </button>
      )}
      <button type="button" onClick={onCancel} className={ui.textSm}>
        취소
      </button>
    </div>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 9 9" className="absolute top-px right-px size-[9px]" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="1.5" y="4" width="6" height="4.5" rx="0.5" />
      <path d="M3 4V2.8a1.5 1.5 0 0 1 3 0V4" />
    </svg>
  );
}

function ScheduleGrid({
  rows,
  result,
  month,
  days,
  dow,
  holidays,
  isWeekend,
  fixed,
  selected,
  disabled,
  onSelect,
}: {
  rows: Nurse[];
  result: ScheduleResult;
  month: number;
  days: number;
  dow: (d: number) => number;
  holidays: number[];
  isWeekend: (d: number) => boolean;
  fixed: Map<string, Code>;
  selected: Cell | null;
  disabled: boolean;
  onSelect: (cell: Cell) => void;
}) {
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const grid = { gridTemplateColumns: `150px 44px repeat(${days}, 30px) repeat(4, 34px)` };
  const rowClass = "grid gap-x-0.5";
  const weekendBg = (d: number) => (isWeekend(d) ? "bg-[#F1EEE6]" : "");
  const changed = new Set((result.diff ?? []).map((c) => `${c.nurse_id}-${c.day}`));
  const violations = new Map<string, string[]>();
  for (const v of result.soft_violations) {
    if (!v.nurse_id || !v.day) continue;
    const key = `${v.nurse_id}-${v.day}`;
    violations.set(key, [...(violations.get(key) ?? []), v.detail]);
  }
  const total = "flex h-7 items-center justify-center font-mono text-[13px] font-medium text-[#1B1B18]";

  return (
    <div className="overflow-x-auto">
      <div className="flex w-max flex-col gap-0.5">
        <div className={rowClass} style={grid}>
          <span className="flex items-end text-xs font-medium text-[#66665E]">이름</span>
          <span className="flex items-end text-xs font-medium text-[#66665E]">연차</span>
          {dayList.map((d) => {
            const w = dow(d);
            const color = w === 0 || holidays.includes(d) ? "text-[#B42318]" : w === 6 ? "text-[#155E75]" : "text-[#66665E]";
            return (
              <span key={d} className={`flex flex-col items-center rounded-xs py-0.5 font-mono ${weekendBg(d)} ${color}`}>
                <span className="text-[13px] font-medium">{d}</span>
                <span className="text-[11px]">{WEEKDAYS[w]}</span>
              </span>
            );
          })}
          {CODES.map((c) => (
            <span key={c} className="flex items-end justify-center font-mono text-xs font-semibold text-[#66665E]">
              {c}
            </span>
          ))}
        </div>

        {rows.map((n) => {
          const row = result.assignments[n.id];
          const s = result.stats[n.id];
          return (
            <div key={n.id} className={rowClass} style={grid}>
              <span className="flex h-7 items-center truncate text-sm text-[#1B1B18]">
                {n.name}
                {n.night_only && <span className="ml-1.5 text-xs font-medium text-[#66665E]">N전담</span>}
              </span>
              <span className="flex h-7 items-center font-mono text-[13px] text-[#3D3D38]">{n.years}</span>
              {row.map((code, i) => {
                const d = i + 1;
                const key = `${n.id}-${d}`;
                const isSel = selected?.nurseId === n.id && selected.day === d;
                const warn = violations.get(key);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelect({ nurseId: n.id, day: d })}
                    aria-label={`${n.name} ${month}월 ${d}일 ${code}`}
                    title={warn ? warn.join(", ") : undefined}
                    className={`${CELL} ${codeClass(code, isWeekend(d))} hover:opacity-80 disabled:cursor-wait ${
                      changed.has(key) ? "shadow-[inset_0_0_0_2px_#D97706]" : ""
                    } ${isSel ? "outline-2 outline-offset-1 outline-[#155E75]" : ""}`}
                  >
                    {code}
                    {fixed.has(key) && <LockIcon />}
                    {warn && <span aria-hidden="true" className="absolute bottom-px left-px size-[5px] rounded-full bg-[#A15C07]" />}
                  </button>
                );
              })}
              {CODES.map((c) => (
                <span key={c} className={total}>
                  {s?.[c] ?? row.filter((x) => x === c).length}
                </span>
              ))}
            </div>
          );
        })}

        {(["D", "E", "N"] as const).map((code) => (
          <div key={code} className={`${rowClass} ${code === "D" ? "mt-1.5 border-t border-[#EFEFEB] pt-1.5" : ""}`} style={grid}>
            <span className="flex h-7 items-center text-xs font-medium text-[#66665E]">{code} 합계</span>
            <span />
            {dayList.map((d) => (
              <span key={d} className={`${total} rounded-xs ${weekendBg(d)}`}>
                {rows.filter((n) => result.assignments[n.id][d - 1] === code).length}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsTable({ rows, result }: { rows: Nurse[]; result: ScheduleResult }) {
  const thBase = "px-3 py-2 text-xs font-medium whitespace-nowrap text-[#66665E]";
  const th = `${thBase} text-right`;
  const td = "px-3 py-1.5 text-right font-mono text-[13px] font-medium text-[#1B1B18]";
  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <h2 className={ui.cardTitle}>개인별 통계</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#E2E2DC]">
              <th className={`${thBase} text-left`}>이름</th>
              {CODES.map((c) => (
                <th key={c} className={`${th} font-mono`}>
                  {c}
                </th>
              ))}
              <th className={th}>주말·공휴일 근무</th>
              <th className={th}>최대 연속 근무</th>
              <th className={th}>희망 반영률</th>
              <th className={th}>평균 대비 편차</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const s = result.stats[n.id];
              if (!s) return null;
              return (
                <tr key={n.id} className="border-b border-[#EFEFEB] last:border-b-0">
                  <td className="px-3 py-1.5 text-sm text-[#1B1B18]">{n.name}</td>
                  {CODES.map((c) => (
                    <td key={c} className={td}>
                      {s[c]}
                    </td>
                  ))}
                  <td className={td}>{s.weekend_holiday_work}</td>
                  <td className={td}>{s.max_consecutive_work}일</td>
                  <td className={td}>{s.preference_rate === null ? "–" : `${Math.round(s.preference_rate * 100)}%`}</td>
                  <td className={td}>
                    {s.deviation > 0 ? "+" : ""}
                    {s.deviation.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
