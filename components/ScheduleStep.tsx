"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { ApiError, errorMessage, explain, solve } from "@/lib/api";
import { toScheduleCsv } from "@/lib/csv";
import { availabilityFromLinks, isAvailabilityRule, mergeAvailabilityConflicts, unsubmittedCause } from "@/lib/availability";
import { historyLoadFor, isOperating } from "@/lib/continuity";
import { closingShift, DEFAULT_CONFIG, OFF_CODE, shiftTones } from "@/lib/rules";
import { dayHeader, dayOfDate, isWeekendDay, monthDay, periodDays, periodEnd } from "@/lib/period";
import {
  availabilityChanged,
  carryOverChanged,
  type Code,
  COVERAGE_SOURCE_TEXT,
  currentPeriod,
  disabledRulesFor,
  scheduleInputs,
  type Shop,
  toScheduleRequest,
  useAppStore,
  type WorkPeriod,
} from "@/lib/store";
import { loadAvailabilityLinks, lockAvailabilityLinks } from "@/lib/supabase";
import type {
  Conflict,
  ConstraintSpec,
  ExplainResponse,
  Employee,
  Period,
  RelaxationProposal,
  ScheduleRequest,
  ScheduleResult,
  ShiftDef,
  ShopConfig,
} from "@/lib/types.gen";
import { statsFromAssignments } from "@/lib/stats";
import { describeRule, formatDeviation, hardnessLabel, josa, presetName, scheduleInputsText } from "@/lib/wording";

import Dialog from "./Dialog";
import { Spinner, today } from "./RulesStep";
import { ui } from "./ui";

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 근무표 날짜 머리 두 줄(날짜 / 요일). 토요일 청록, 일요일·공휴일 빨강. */
export function DayHead({
  label,
  weekday,
  holiday,
  weekend,
  today: isToday = false,
}: {
  label: string;
  weekday: number;
  holiday: boolean;
  weekend: boolean;
  today?: boolean;
}) {
  const color = weekday === 0 || holiday ? "text-[#B42318]" : weekday === 6 ? "text-[#155E75]" : "text-[#66665E]";
  return (
    <span
      className={`flex flex-col items-center rounded-xs py-0.5 text-[11px] ${weekend ? "bg-[#F1EEE6]" : ""} ${color} ${
        isToday ? "border-b-2 border-[#155E75]" : ""
      }`}
    >
      <span className="font-mono font-medium tracking-[-0.04em] whitespace-nowrap">{label}</span>
      <span>{WEEKDAYS[weekday]}</span>
    </span>
  );
}

export const CELL =
  "relative w-[30px] h-7 rounded-xs inline-flex items-center justify-center font-mono transition-colors duration-[120ms]";
/** 근무조 색 단계(shiftTones): 이른 근무 밝게 → 늦은 근무 진하게. 기본 오픈·미들·마감은 0·2·4. */
const TONE_CLASS = [
  "bg-[#FFF1C2] text-[#5C4300]",
  "bg-[#FCDDA0] text-[#5C3A00]",
  "bg-[#F9CFAE] text-[#6E2A04]",
  "bg-[#56657F] text-white",
  "bg-[#263248] text-white",
];
/** 근무조를 합친 코드(더블 등) */
const MULTI_CLASS = "bg-[#E4DDF4] text-[#3E2A73]";
/** 근무 형태에 없는 코드 */
const OTHER_CODE_CLASS = "bg-[#E2E2DC] text-[#1B1B18]";
const OFF_CLASS = "text-[#6B6B63] font-normal border border-[#E2E2DC]";

/** 근무 코드 색과 글자 크기(3자 코드는 작게). 색은 근무 형태의 시작 시각 순서로 정한다. */
export function codeClass(code: Code, weekend: boolean, config: ShopConfig = DEFAULT_CONFIG): string {
  const tone = shiftTones(config)[code];
  const color =
    tone === "off"
      ? `${OFF_CLASS} ${weekend ? "bg-[#F1EEE6]" : "bg-white"}`
      : `${tone === "multi" ? MULTI_CLASS : tone === undefined ? OTHER_CODE_CLASS : TONE_CLASS[tone]} font-semibold border border-transparent`;
  return `${color} ${code.length >= 3 ? "text-[11px]" : "text-[13px]"}`;
}

/** 근무표 칸 글자: 휴무는 빈칸으로 두어 일하는 날만 눈에 띄게 한다(코드는 aria-label에 남는다). */
export const cellText = (code: Code) => (code === OFF_CODE ? "" : code);

/** 열로 보여 줄 근무 코드: 활성 코드 + 결과에 남은 꺼진 코드(config 순서). */
function shownCodes(config: ShopConfig, assignments?: ScheduleResult["assignments"]): ShiftDef[] {
  const used = new Set(Object.values(assignments ?? {}).flat());
  return config.shifts.filter((s) => s.active !== false || used.has(s.code));
}

/** 변환 전에 확정한 근무표처럼 통계가 옛 형식(counts 없음)인 결과. */
function isLegacyResult(result: ScheduleResult): boolean {
  return !Object.values(result.stats).every((s) => s.counts);
}

/** 변환 전에 확정한 근무표처럼 통계가 옛 형식(counts 없음)이면 배정으로 다시 센다(★12). */
function withStats(result: ScheduleResult, config: ShopConfig, period: Period, holidays: number[]): ScheduleResult {
  if (!isLegacyResult(result)) return result;
  return { ...result, stats: statsFromAssignments(result.assignments, config, period, holidays) };
}

type Req = Omit<ScheduleRequest, "input_version">;
/** 해가 없거나 시간이 초과된 마지막 풀이. version은 그 요청의 inputVersion. */
type Outcome =
  | { kind: "infeasible"; version: number; conflicts: Conflict[]; explanation: ExplainResponse | null }
  | { kind: "timeout"; version: number }
  | null;
type Cell = { employeeId: string; day: number };
export type Toast = { message: string; retry: () => void } | null;
type Load = { closings: number; weekends: number };

/** 최근 4주 마감이 평균보다 많았던 직원 중 이번 근무표 마감이 평균 이하인 사람. 해당자가 없거나 history가 비면 null. */
function easedClosings(rows: Employee[], result: ScheduleResult, history: Map<string, Load>, config: ShopConfig) {
  const closing = closingShift(config);
  if (history.size === 0 || rows.length === 0 || !closing) return null;
  const past = (n: Employee) => history.get(n.id)?.closings ?? 0;
  const now = (n: Employee) => result.stats[n.id]?.counts?.[closing.code] ?? result.assignments[n.id].filter((c) => c === closing.code).length;
  const avg = (f: (n: Employee) => number) => rows.reduce((sum, n) => sum + f(n), 0) / rows.length;
  const pastAvg = avg(past);
  const nowAvg = avg(now);
  const eased = rows.filter((n) => past(n) > pastAvg && now(n) <= nowAvg);
  return eased.length === 0 ? null : { closing, eased, past, now };
}

/** 누적 부담 근거 한 줄. */
function historyEvidence(rows: Employee[], result: ScheduleResult, history: Map<string, Load>, config: ShopConfig): string | null {
  const found = easedClosings(rows, result, history, config);
  if (!found) return null;
  const { closing, eased, past, now } = found;
  if (eased.length === 1) return `${eased[0].name} 최근 4주 ${closing.name} ${past(eased[0])}회 → 이번 근무표 ${now(eased[0])}회`;
  return `최근 4주 ${closing.name}${josa(closing.name, "이", "가")} 많았던 ${eased.length}명은 이번 근무표에서 ${closing.name}${josa(closing.name, "을", "를")} 줄였어요`;
}

/** 요약 지표의 "최근 4주 마감 배려" 칸. 최근 4주 마감이 가장 많았던 2명까지 적는다. */
function closingCare(rows: Employee[], result: ScheduleResult, history: Map<string, Load>, config: ShopConfig) {
  const found = easedClosings(rows, result, history, config);
  if (!found) return null;
  const { closing, eased, past, now } = found;
  const top = [...eased].sort((a, b) => past(b) - past(a)).slice(0, 2);
  return { label: `최근 4주 ${closing.name} 배려`, text: top.map((n) => `${n.name} ${past(n)}회 → ${now(n)}회`).join(" · ") };
}

export function toMessage(e: unknown): string {
  return errorMessage(e instanceof ApiError ? e : new ApiError("INTERNAL", String(e)));
}

/** 작성 중 근무표의 가능 시간을 링크 행에서 다시 읽어 store에 넣는다. 달라졌으면 true. 확정한 근무표는 링크가 잠겨 읽지 않는다. */
async function readAvailability(periodId: string): Promise<boolean> {
  const s = useAppStore.getState();
  const period = s.periods.find((p) => p.id === periodId);
  if (period?.status !== "draft") return false;
  try {
    return s.setAvailability(periodId, availabilityFromLinks(await loadAvailabilityLinks(period.start_date)));
  } catch (e) {
    throw new ApiError("NETWORK", String(e));
  }
}

/**
 * 근무표 만들기(/solve)와 해 없음 설명(/explain). 근무표 작성 ③과 확정 근무표가 함께 쓴다.
 * 확정본이 있으면 확정본에서 최소한으로 바꾼다.
 */
export function useSolve(periodId: string) {
  const setResult = useAppStore((s) => s.setResult);
  const [loading, setLoading] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [toast, setToast] = useState<Toast>(null);

  const runExplain = async (req: Req, conflicts: Conflict[], version: number) => {
    setExplaining(true);
    setToast(null);
    try {
      const res = await explain(req, conflicts);
      if (res.input_version !== useAppStore.getState().inputVersion) return;
      setOutcome((o) => (o?.kind === "infeasible" && o.version === version ? { ...o, explanation: res } : o));
    } catch (e) {
      setToast({ message: toMessage(e), retry: () => void runExplain(req, conflicts, version) });
    } finally {
      setExplaining(false);
    }
  };

  /** 지금 store로 요청 본문을 만든다. 확정본이 있으면 확정본에서 최소한으로 바꾼다. */
  const buildRequest = (): Req => {
    const s = useAppStore.getState();
    const p = s.periods.find((x) => x.id === periodId)!;
    const req = toScheduleRequest(s.shop!, p, s.periods, today());
    const base = p.versions.at(-1)?.assignments;
    if (!base) return req;
    return { ...req, previous: Object.fromEntries(req.employees.filter((n) => base[n.id]).map((n) => [n.id, base[n.id]])) };
  };

  const run = async () => {
    setLoading(true);
    setToast(null);
    try {
      await readAvailability(periodId);
      const req = buildRequest();
      const usedAvailability = useAppStore.getState().periods.find((p) => p.id === periodId)!.availability;
      const res = await solve(req);
      // 풀이 중 입력이 바뀌면 버린다(남은 결과에는 stale 배지가 뜬다)
      if (res.input_version !== useAppStore.getState().inputVersion) return;
      if (res.status === "ok") {
        setResult(periodId, res.result, req.carry_over ?? [], usedAvailability);
        setOutcome(null);
      } else if (res.status === "timeout") {
        setOutcome({ kind: "timeout", version: res.input_version });
      } else {
        setOutcome({ kind: "infeasible", version: res.input_version, conflicts: res.conflicts, explanation: null });
        setLoading(false);
        // 원인이 미제출이면 설명을 부르지 않는다(안내는 OutcomePanel이 한다)
        const s = useAppStore.getState();
        const p = s.periods.find((x) => x.id === periodId)!;
        if (unsubmittedFor(s.shop!, p, res.conflicts)) return;
        await runExplain(req, res.conflicts, res.input_version);
      }
    } catch (e) {
      setToast({ message: toMessage(e), retry: () => void run() });
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    explaining,
    busy: loading || explaining,
    outcome,
    clearOutcome: () => setOutcome(null),
    toast,
    setToast,
    run: () => void run(),
  };
}

export type Solve = ReturnType<typeof useSolve>;

/** 근무표 없음의 원인이 미제출인지. 확정한 근무표는 링크가 잠겨 제출이 끝났으므로 false. */
function unsubmittedFor(shop: Shop, period: WorkPeriod, conflicts: Conflict[]): boolean {
  if (period.status === "confirmed") return false;
  const active = shop.employees.filter((n) => n.active).map((n) => n.id);
  return unsubmittedCause(
    conflicts.map((c) => c.constraint_id),
    Object.keys(period.availability),
    active,
  );
}

export function downloadCsv(period: WorkPeriod, employees: Employee[], result: ScheduleResult) {
  const config = useAppStore.getState().shop?.config ?? DEFAULT_CONFIG;
  const csv = toScheduleCsv({ employees, period, holidays: period.holidays, assignments: result.assignments, config });
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `근무표-${period.start_date}_${periodEnd(period)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** API 오류 알림 + [다시 시도]. */
export function ToastAlert({ toast, busy, onClose }: { toast: NonNullable<Toast>; busy: boolean; onClose: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-lg border border-[#E8B4AE] bg-white py-2 pr-2 pl-4 text-sm text-[#9F1F14]">
      <span className="flex-1">{toast.message}</span>
      <button type="button" onClick={toast.retry} disabled={busy} className={ui.textSm}>
        다시 시도
      </button>
      <button type="button" onClick={onClose} aria-label="닫기" className={ui.textSm}>
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path d="m3 3 6 6M9 3 3 9" />
        </svg>
      </button>
    </div>
  );
}

/**
 * 근무표 본문: stale 배너, 해 없음 패널, 요약 지표, 근거 한 줄, 근무표(칸 고정), (actions), 통계.
 * readOnly면 칸을 누를 수 없다(끝난 근무표). outcomeAtGrid면 해 없음 패널을 근무표 자리(요약 지표 아래)에 둔다.
 */
export function ScheduleBody({
  period,
  solve: sv,
  busy,
  readOnly = false,
  hint,
  summaryLead,
  gridNote,
  actions,
  outcomeAtGrid = false,
}: {
  period: WorkPeriod;
  solve: Solve;
  busy: boolean;
  readOnly?: boolean;
  /** 요약 지표 오른쪽에 놓을 안내 */
  hint?: ReactNode;
  /** 요약 지표 왼쪽에 놓을 내용(확정 근무표의 바뀐 칸 배너) */
  summaryLead?: ReactNode;
  /** 근무표 제목 아래, 표 위에 놓을 한 줄 */
  gridNote?: ReactNode;
  /** 근무표와 통계 사이의 버튼 줄 */
  actions?: ReactNode;
  outcomeAtGrid?: boolean;
}) {
  const shop = useAppStore((s) => s.shop);
  const periods = useAppStore((s) => s.periods);
  const inputVersion = useAppStore((s) => s.inputVersion);
  const setFixed = useAppStore((s) => s.setFixed);
  const clearFixed = useAppStore((s) => s.clearFixed);
  const setDisabled = useAppStore((s) => s.setDisabled);
  const applyChanges = useAppStore((s) => s.applyChanges);
  const go = useAppStore((s) => s.go);
  const [selected, setSelected] = useState<Cell | null>(null);

  if (!shop) return null;
  const periodId = period.id;
  const now = today();
  const { employees, holidays = [], constraints = [], history: raw = null } = toScheduleRequest(shop, period, periods, now);
  const { resultVersion } = period;
  // 변환 전 결과는 희망 반영률·못 지킨 규칙을 셀 수 없어 숨긴다(★12)
  const legacy = period.result !== null && isLegacyResult(period.result);
  const confirmed = period.versions.at(-1)?.assignments ?? null;
  const solved = period.result && withStats(period.result, shop.config, period, holidays);
  // 확정본이 없으면 diff는 직전 결과와의 차이라 "확정본에서 바뀐 칸"으로 보여 주지 않는다
  const result = solved && confirmed === null ? { ...solved, diff: null } : solved;
  const { outcome } = sv;
  const history = new Map(historyLoadFor(raw, shop.config).map((h) => [h.employee_id, { closings: h.closings, weekends: h.weekends }]));
  // 운영 중인 기간에서 오늘 이전 날짜는 잠긴다(toScheduleRequest의 pastDayLocks와 같은 범위)
  const todayDay = dayOfDate(period, now);
  const pastDays = isOperating(period, now) && todayDay !== null ? todayDay - 1 : 0;

  const isWeekend = (d: number) => isWeekendDay(period, d, holidays);
  const fixed = new Map<string, Code>();
  for (const c of constraints) {
    if (c.type === "fixed_assignment" && c.enabled !== false) fixed.set(`${c.params.employee_id}-${c.params.day}`, c.params.shift);
  }

  const onSelect = (cell: Cell) => {
    if (!readOnly && cell.day > pastDays) setSelected(cell);
  };

  const onPick = (cell: Cell, code: Code | null) => {
    setSelected(null);
    if (code === null) clearFixed(periodId, cell.employeeId, cell.day);
    else setFixed(periodId, cell.employeeId, cell.day, code);
    sv.run();
  };

  const isConfirmed = result !== null && confirmed !== null && JSON.stringify(confirmed) === JSON.stringify(result.assignments);
  const isDraft = result !== null && confirmed !== null && !isConfirmed;
  const rows = result ? employees.filter((n) => result.assignments[n.id]) : [];
  const shownVersion = outcome ? outcome.version : resultVersion;
  const stale = !busy && shownVersion !== null && shownVersion !== inputVersion;
  const evidence = result ? historyEvidence(rows, result, history, shop.config) : null;
  const care = result ? closingCare(rows, result, history, shop.config) : null;
  const disabledRules = disabledRulesFor(shop, period).map((c) => ({
    name: presetName(c),
    text: describeRule(c, shop.config, employees, period).text,
  }));
  const unsubmitted = outcome?.kind === "infeasible" && unsubmittedFor(shop, period, outcome.conflicts);
  const noneSubmitted = !employees.some((n) => n.id in period.availability);
  const outcomePanel = outcome && (
    <OutcomePanel
      outcome={outcome}
      unsubmitted={unsubmitted}
      noneSubmitted={noneSubmitted}
      onGoAvailability={() => go({ screen: "period", periodId, step: 1 })}
      explaining={sv.explaining}
      busy={busy}
      constraints={constraints}
      employees={employees}
      period={period}
      hasResult={result !== null}
      onAccept={(p) => {
        applyChanges(periodId, p.changes);
        sv.run();
      }}
      onDisable={(id) => {
        setDisabled(periodId, id, true);
        sv.run();
      }}
      onToggle={(id, enabled) => setDisabled(periodId, id, !enabled)}
    />
  );

  return (
    <>
      {stale && (
        <div
          role="status"
          className="flex items-center justify-between rounded-lg border border-[#F1D3A8] bg-[#FDF0DC] py-1.5 pr-2 pl-4 text-sm text-[#7A4506]"
        >
          <span className={`${ui.badge} bg-white text-[#7A4506]`}>입력이 바뀌었어요. 다시 만들어 주세요</span>
          <button type="button" onClick={sv.run} disabled={busy} className={ui.secondarySm}>
            다시 만들기
          </button>
        </div>
      )}

      {!outcomeAtGrid && outcomePanel}

      {result && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-6">
            {summaryLead}
            <SummaryCard result={result} infeasible={outcome !== null} confirmed={isConfirmed} draft={isDraft} legacy={legacy} care={care} disabled={disabledRules} />
            {hint}
          </div>
          {legacy && <p className="-mt-2 text-sm text-[#66665E]">변환 전에 확정한 근무표예요. 희망 반영과 못 지킨 규칙은 보여 주지 않아요.</p>}
          {evidence && <p className="-mt-2 text-sm text-[#3D3D38]">{evidence}</p>}
        </>
      )}

      {outcomeAtGrid && outcomePanel}

      {result && (
        <section className={`${ui.card} flex flex-col gap-3`}>
          <div className="flex h-8 items-center justify-between gap-3">
            <h2 className={ui.cardTitle}>근무표</h2>
            {selected && (
              <CellEditor
                config={shop.config}
                codes={shop.config.shifts.filter((s) => s.active !== false)}
                label={`${employees.find((n) => n.id === selected.employeeId)?.name ?? selected.employeeId} ${monthDay(period, selected.day)}`}
                fixed={fixed.get(`${selected.employeeId}-${selected.day}`)}
                onPick={(code) => onPick(selected, code)}
                onCancel={() => setSelected(null)}
              />
            )}
          </div>
          {gridNote}
          <ScheduleGrid
            config={shop.config}
            rows={rows}
            result={result}
            period={period}
            holidays={holidays}
            isWeekend={isWeekend}
            fixed={fixed}
            selected={selected}
            disabled={busy}
            readOnly={readOnly}
            onSelect={onSelect}
            history={history}
            pastDays={pastDays}
            todayDay={todayDay}
            hideViolations={legacy}
          />
        </section>
      )}

      {actions}

      {result && <StatsTable config={shop.config} rows={rows} result={result} history={history} legacy={legacy} />}
    </>
  );
}

/** 근무표 작성 ③ 근무표: 요약 지표 → 근무표 → 버튼 줄 → 통계. 만들기 전 [근무표 만들기], 만든 뒤 [확정]. 확정하면 확정 근무표 화면으로 간다. */
export default function ScheduleStep() {
  const shop = useAppStore((s) => s.shop);
  const period = useAppStore(currentPeriod);
  const periods = useAppStore((s) => s.periods);
  const inputVersion = useAppStore((s) => s.inputVersion);
  const confirm = useAppStore((s) => s.confirm);
  const go = useAppStore((s) => s.go);
  const sv = useSolve(period?.id ?? "");
  const { setToast } = sv;
  const [confirming, setConfirming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const stepPeriodId = period?.id ?? "";

  // ③에 들어오면 가능 시간을 다시 읽는다. 달라졌으면 아래 배너가 뜬다
  useEffect(() => {
    const read = () => {
      readAvailability(stepPeriodId).catch((e) =>
        setToast({
          message: toMessage(e),
          retry: () => {
            setToast(null);
            read();
          },
        }),
      );
    };
    read();
  }, [stepPeriodId, setToast]);

  if (!shop || !period) return null;
  const periodId = period.id;
  const { result } = period;
  const busy = sv.busy || confirming;
  const { loading } = sv;

  // 마지막 생성에 쓴 가능 시간과 다르면 확정하지 않고 배너로 알린다. 링크를 잠근 뒤에 확정한다
  const onConfirm = async () => {
    setConfirming(true);
    setToast(null);
    try {
      await readAvailability(periodId);
      const latest = useAppStore.getState().periods.find((p) => p.id === periodId);
      if (latest && availabilityChanged(latest)) return;
      try {
        await lockAvailabilityLinks(period.start_date);
      } catch (e) {
        throw new ApiError("NETWORK", String(e));
      }
      confirm(periodId);
    } catch (e) {
      setToast({ message: toMessage(e), retry: () => void onConfirm() });
    } finally {
      setConfirming(false);
    }
  };
  const employees = toScheduleRequest(shop, period, periods, today()).employees;

  const remake = busy || employees.length === 0;
  const blocked = availabilityChanged(period);
  // 지금 입력으로 만든 근무표가 아니면(조건이 바뀌었거나, 다시 만들어도 근무표가 없으면) 확정하지 않는다
  const outdated = period.resultVersion !== inputVersion;

  return (
    <div className="flex flex-col gap-5">
      <h2 tabIndex={-1} data-step-title className={`${ui.cardTitle} outline-none`}>
        근무표
      </h2>

      {carryOverChanged(period, periods) && (
        <div role="status" className={ui.banner}>
          지난 근무표가 바뀌어 이어지는 근무가 달라졌어요. 다시 만들면 반영돼요
          <button type="button" onClick={sv.run} disabled={busy} className={ui.textSm}>
            다시 만들기
          </button>
        </div>
      )}

      {blocked && result && (
        <div role="status" className={ui.banner}>
          가능 시간이 바뀌었어요. 다시 만들어 주세요
          <button type="button" onClick={sv.run} disabled={busy} className={ui.textSm}>
            다시 만들기
          </button>
        </div>
      )}

      {sv.toast && <ToastAlert toast={sv.toast} busy={busy} onClose={() => sv.setToast(null)} />}

      <ScheduleBody
        period={period}
        solve={sv}
        busy={busy}
        outcomeAtGrid
        hint={
          <p className="ml-auto max-w-[300px] text-right text-[13px] leading-relaxed text-[#3D3D38]">
            칸을 누르면 바꿀 수 있어요. <InlineLock /> 고정한 칸은 다시 만들 때 그대로 둬요
          </p>
        }
        actions={
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => go({ screen: "period", periodId, step: 2 })} className={ui.secondary}>
              이전
            </button>
            {!result ? (
              <div className="flex items-center gap-3">
                <p className="max-w-[420px] text-right text-sm leading-relaxed text-[#3D3D38]">
                  {scheduleInputsText(scheduleInputs(shop, period, periods)).map((p, i) =>
                    "value" in p ? (
                      <span key={i} className="font-mono">
                        {p.text}
                      </span>
                    ) : (
                      p.text
                    ),
                  )}
                </p>
                <button type="button" onClick={sv.run} disabled={remake} className={ui.primaryLg}>
                  {loading && <Spinner />}
                  {loading ? "만드는 중…" : "근무표 만들기"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {blocked ? (
                  <p className={`${ui.help} mr-1`}>가능 시간이 바뀌어 다시 만들어야 확정할 수 있어요</p>
                ) : (
                  outdated && <p className={`${ui.help} mr-1`}>지금 조건으로 만든 근무표만 확정할 수 있어요</p>
                )}
                <button type="button" onClick={() => downloadCsv(period, employees, result)} disabled={busy} className={ui.text}>
                  CSV 받기
                </button>
                <button type="button" onClick={sv.run} disabled={remake} className={ui.secondary}>
                  {loading && <Spinner />}
                  {loading ? "만드는 중…" : "다시 만들기"}
                </button>
                <button type="button" onClick={() => setConfirmOpen(true)} disabled={busy || blocked || outdated} className={ui.primaryLg}>
                  확정
                </button>
              </div>
            )}
          </div>
        }
      />

      {/* 확정은 되돌릴 수 없어(직원 링크 잠김) 한 번 묻는다. 끝나면(성공·실패) 닫는다 */}
      {confirmOpen && (
        <Dialog
          title="근무표를 확정할까요?"
          onClose={() => setConfirmOpen(false)}
          secondary={{ label: "취소", onClick: () => setConfirmOpen(false), disabled: confirming }}
          primary={{
            label: confirming ? "확정하는 중…" : "확정",
            onClick: () => void onConfirm().finally(() => setConfirmOpen(false)),
            disabled: confirming,
          }}
        >
          <p>
            확정하면 직원 링크가 잠겨요.
            <br />
            이후 변경은 변경 입력으로만 할 수 있어요.
          </p>
        </Dialog>
      )}
    </div>
  );
}

/** 문장 안의 자물쇠. */
export function InlineLock() {
  return (
    <svg aria-label="자물쇠" role="img" viewBox="0 0 9 9" className="inline size-3 align-[-1px]" fill="none" stroke="currentColor" strokeWidth={1.2}>
      <rect x="1.5" y="4" width="6" height="4.5" rx="0.5" />
      <path d="M3 4V2.8a1.5 1.5 0 0 1 3 0V4" />
    </svg>
  );
}

export function OutcomePanel({
  outcome,
  unsubmitted = false,
  noneSubmitted = false,
  onGoAvailability,
  explaining,
  busy,
  constraints,
  employees,
  period,
  hasResult,
  onAccept,
  onDisable,
  onToggle,
}: {
  outcome: NonNullable<Outcome>;
  /** 원인이 미제출이면 안내와 [① 가능 시간으로]만 보인다 */
  unsubmitted?: boolean;
  /** 활성 직원 중 제출한 사람이 없음 */
  noneSubmitted?: boolean;
  onGoAvailability?: () => void;
  explaining: boolean;
  busy: boolean;
  constraints: ConstraintSpec[];
  employees: Employee[];
  period: Period;
  hasResult: boolean;
  onAccept: (p: RelaxationProposal) => void;
  onDisable: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const [dismissed, setDismissed] = useState<RelaxationProposal[]>([]);
  const config = useAppStore((s) => s.shop?.config) ?? DEFAULT_CONFIG;
  const explanation = outcome.kind === "infeasible" ? outcome.explanation : null;
  // 다시 풀어 검증된 제안만 보여준다(ADR-004)
  const proposals = (explanation?.proposals ?? []).filter((p) => p.verified_summary && !dismissed.includes(p));
  const conflicts = outcome.kind === "infeasible" ? mergeAvailabilityConflicts(outcome.conflicts) : [];
  const unknownCause = outcome.kind === "timeout" || conflicts.length === 0;
  const ruleConflicts = conflicts.filter((c) => !isAvailabilityRule(c.constraint_id));
  const availabilityNames = conflicts.filter((c) => isAvailabilityRule(c.constraint_id)).map((c) => c.source_text.replace(/ 가능 시간$/, ""));
  // 가능 시간은 직원이 정한 것이라 끌 수 없다
  const hardList = constraints.filter((c) => (c.hardness ?? "hard") === "hard" && !isAvailabilityRule(c.id));

  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-[#E8B4AE] bg-white px-[18px] py-4">
      <div className="flex items-center gap-2">
        <span className={`${ui.badge} ${ui.badgeTone.none}`}>{outcome.kind === "timeout" ? "시간 초과" : "근무표 없음"}</span>
        <h2 className={ui.cardTitle}>
          {outcome.kind === "timeout" ? "시간 안에 근무표를 만들지 못했어요" : "이 조건으로는 근무표를 만들 수 없어요"}
        </h2>
        {hasResult && <span className={ui.help}>아래는 마지막으로 만든 근무표예요.</span>}
      </div>

      {unsubmitted && (
        <div className="flex flex-col items-start gap-1.5">
          <p className="text-sm text-[#1B1B18]">
            {noneSubmitted
              ? "아직 가능 시간을 제출한 직원이 없어요. ①에서 링크를 보내고 제출을 기다려 주세요"
              : `${availabilityNames.join(", ")}의 가능 시간이 아직 없어요. 제출을 기다리거나 ①에서 확인해 주세요`}
          </p>
          {onGoAvailability && (
            <button type="button" onClick={onGoAvailability} className={ui.textSm}>
              ① 가능 시간으로
            </button>
          )}
        </div>
      )}

      {!unsubmitted && (
        <>
      {outcome.kind === "infeasible" && explaining && !explanation && (
        <p className="flex items-center gap-2 text-sm text-[#66665E]">
          <Spinner />
          원인을 분석하는 중…
        </p>
      )}

      {proposals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-[#1B1B18]">이렇게 바꾸면 만들 수 있어요</h3>
          <div className="grid grid-cols-2 gap-4">
            {proposals.map((p, i) => (
              <ProposalCard
                key={i}
                proposal={p}
                changes={p.changes.flatMap((ch) => {
                  const c = constraints.find((x) => x.id === ch.constraint_id);
                  if (!c) return [];
                  // 바꾸는 것만 결정적으로 쓴다(값·끄기·반드시/가능하면). 어느 규칙인지는 원문으로 붙인다
                  const quote = `“${c.source_text}”`;
                  if (ch.action === "disable") return [{ change: "이번 근무표에서만 끄기", quote }];
                  if (ch.action === "set_hardness" && ch.hardness)
                    return [{ change: `${hardnessLabel(c.hardness ?? "hard")} → ${hardnessLabel(ch.hardness)}`, quote }];
                  const v = c.type === "rule" ? c.values?.[ch.name ?? ""] : undefined;
                  return v ? [{ change: `${v.label} ${v.value} → ${ch.value}`, quote }] : [];
                })}
                busy={busy}
                onAccept={() => onAccept(p)}
                onDismiss={() => setDismissed((d) => [...d, p])}
              />
            ))}
          </div>
        </div>
      )}

      {!unknownCause && ruleConflicts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-[#1B1B18]">함께 지킬 수 없는 규칙</h3>
          <p className={ui.help}>하나를 끄면 바로 다시 만들어요. 원래 설정은 그대로 남아요.</p>
          <ul className="flex flex-col">
            {ruleConflicts.map((c) => {
              const found = constraints.find((x) => x.id === c.constraint_id);
              return (
                <li key={c.constraint_id} className="flex items-center justify-between gap-3 border-b border-[#EFEFEB] py-1.5 last:border-b-0">
                  <span className="flex items-baseline gap-2 text-sm text-[#1B1B18]">
                    <span className="text-xs font-medium text-[#66665E]">{found ? presetName(found) : "규칙"}</span>
                    {c.source_text !== COVERAGE_SOURCE_TEXT && <>“{c.source_text}”</>}
                    {found && (
                      <span className="font-mono text-xs text-[#66665E]">{describeRule(found, config, employees, period).text}</span>
                    )}
                  </span>
                  {found && (
                    <button type="button" disabled={busy} onClick={() => onDisable(c.constraint_id)} className={ui.secondarySm}>
                      이번 근무표에서만 끄기
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {availabilityNames.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-[#1B1B18]">가능 시간도 함께 걸려 있어요</h3>
          <p className="text-sm text-[#1B1B18]">{availabilityNames.join(", ")}</p>
          <p className={ui.help}>가능 시간은 직원이 정한 것이라 끌 수 없어요. 더 일할 수 있는지 물어보면 해결될 수도 있어요.</p>
        </div>
      )}

      {unknownCause && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-[#1B1B18]">
            {outcome.kind === "timeout"
              ? "'반드시' 규칙을 하나씩 꺼서 확인해 주세요."
              : "원인을 찾지 못했어요. 규칙을 하나씩 꺼서 확인해 주세요."}
            <span className={ui.help}> 끄거나 켠 뒤 [다시 만들기]를 눌러 주세요.</span>
          </p>
          <ul className="flex flex-col">
            {hardList.map((c) => {
              const on = c.enabled !== false;
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 border-b border-[#EFEFEB] py-1.5 last:border-b-0">
                  <span className={`flex items-baseline gap-2 text-sm ${on ? "text-[#1B1B18]" : "text-[#66665E]"}`}>
                    <span className="text-xs font-medium text-[#66665E]">{presetName(c)}</span>“{c.source_text}”
                    <span className="font-mono text-xs text-[#66665E]">{describeRule(c, config, employees, period).text}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={!on}
                    onClick={() => onToggle(c.id, !on)}
                    className={ui.secondarySm}
                  >
                    {on ? "이번 근무표에서만 끄기" : "다시 켜기"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {explanation && (
        <details className="border-t border-[#EFEFEB] pt-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-[#1B1B18]">왜 만들 수 없나요?</summary>
          <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-[#3D3D38]">
            {explanation.text}
            {explanation.fallback && (
              <span className="text-[#66665E]"> 자동 설명을 만들지 못해 함께 지킬 수 없는 규칙만 보여 줘요.</span>
            )}
          </p>
        </details>
      )}
        </>
      )}
    </section>
  );
}

function ProposalCard({
  proposal,
  changes,
  busy,
  onAccept,
  onDismiss,
}: {
  proposal: RelaxationProposal;
  /** 바꾸는 것("최대 연속 근무 5 → 6")과 그 규칙의 원문 */
  changes: { change: string; quote: string }[];
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const s = proposal.verified_summary!;
  return (
    <article className={`${ui.card} flex flex-col gap-2.5`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-[#1B1B18]">{proposal.title}</h3>
        <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>검증됨</span>
      </div>
      {changes.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {changes.map((t, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-[#1B1B18]">{t.change}</span>
              <span className="text-xs text-[#66665E]">{t.quote}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-relaxed text-[#3D3D38]">{proposal.description}</p>
      )}
      <p className="text-xs text-[#66665E]">
        이렇게 바꾸면 근무표를 만들 수 있어요 · 희망 반영{" "}
        <span className="font-mono">
          {s.preferences_met}/{s.preferences_total}
        </span>
        {s.soft_violation_count > 0 && (
          <>
            {" "}
            · 못 지킨 가능하면 규칙 <span className="font-mono">{s.soft_violation_count}</span>
          </>
        )}
      </p>
      <p className="text-xs text-[#66665E]">이번 근무표에만 적용돼요. 매장 조건은 그대로예요</p>
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onDismiss} className={ui.textSm}>
          무시
        </button>
        <button type="button" disabled={busy} onClick={onAccept} className={ui.primarySm}>
          수락
        </button>
      </div>
    </article>
  );
}

export function SummaryCard({
  result,
  infeasible,
  confirmed,
  draft,
  legacy = false,
  care = null,
  disabled = [],
}: {
  result: ScheduleResult;
  infeasible: boolean;
  confirmed: boolean;
  draft: boolean;
  /** 변환 전 결과: 희망 반영·못 지킨 규칙 칸을 숨긴다 */
  legacy?: boolean;
  /** "최근 4주 마감 배려" 칸. 없으면 그리지 않는다 */
  care?: { label: string; text: string } | null;
  /** 이번 근무표에서 끈 규칙(제목 · 해석 문장). 비어 있으면 칸을 그리지 않는다 */
  disabled?: { name: string; text: string }[];
}) {
  const { summary } = result;
  const item = "flex flex-col gap-1 border-r border-[#E2E2DC] px-5 py-3.5 last:border-r-0";
  const label = "text-xs font-medium text-[#66665E]";
  const value = "font-mono text-xl font-semibold";
  return (
    <section className="flex items-stretch rounded-lg border border-[#E2E2DC] bg-white">
      <div className={item}>
        <span className={label}>결과</span>
        <span className="flex h-7 items-center gap-2">
          {infeasible ? (
            <span className={`${ui.badge} bg-[#FBE9E7] text-[#9F1F14]`}>근무표 없음</span>
          ) : (
            <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>반드시 규칙을 모두 지켰어요</span>
          )}
          {disabled.length > 0 && <span className={`${ui.badge} bg-[#FDF0DC] text-[#7A4506]`}>끈 규칙 {disabled.length}개</span>}
          {!result.optimal && <span className={`${ui.badge} bg-[#FDF0DC] text-[#7A4506]`}>더 나은 배치가 있을 수 있어요</span>}
          {confirmed && <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>확정</span>}
          {draft && <span className={`${ui.badge} border border-[#C9C9C1] bg-white text-[#3D3D38]`}>작성 중</span>}
        </span>
      </div>
      {!legacy && (
        <>
          <div className={item}>
            <span className={label}>희망 반영</span>
            <span className={`${value} text-[#1B1B18]`}>
              {summary.preferences_met}/{summary.preferences_total}
            </span>
            <span className={label}>희망·기피 요청이 걸린 날 중 지킨 날</span>
          </div>
          <div className={item}>
            <span className={label}>못 지킨 가능하면 규칙</span>
            <span className={`${value} text-[#A15C07]`}>{summary.soft_violation_count}</span>
          </div>
        </>
      )}
      {disabled.length > 0 && (
        <div className={item}>
          <span className={label}>이번 근무표에서 끈 규칙</span>
          <span className={`${value} text-[#1B1B18]`}>{disabled.length}개</span>
          <ul className="flex flex-col text-xs text-[#3D3D38]">
            {disabled.slice(0, 3).map((d, i) => (
              <li key={i}>
                {d.name} · {d.text}
              </li>
            ))}
            {disabled.length > 3 && <li>외 {disabled.length - 3}개</li>}
          </ul>
        </div>
      )}
      {result.diff && (
        <div className={item}>
          <span className={label}>확정본에서 바뀐 칸</span>
          <span className={`${value} text-[#1B1B18]`}>{result.diff.length}칸</span>
        </div>
      )}
      {care && (
        <div className={item}>
          <span className={label}>{care.label}</span>
          <span className="flex h-7 items-center text-[13px] font-medium text-[#1B1B18]">{care.text}</span>
        </div>
      )}
    </section>
  );
}

function CellEditor({
  config,
  codes,
  label,
  fixed,
  onPick,
  onCancel,
}: {
  config: ShopConfig;
  /** 고를 수 있는 근무 코드(활성 코드) */
  codes: ShiftDef[];
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
      {codes.map(({ code, name }) => (
        <button
          key={code}
          type="button"
          onClick={() => onPick(code)}
          aria-label={`${code}${josa(code, "으로", "로")} 고정`}
          title={name}
          aria-pressed={fixed === code}
          className={`${CELL} ${codeClass(code, false, config)} hover:opacity-80 aria-pressed:outline-2 aria-pressed:outline-[#155E75] aria-pressed:outline-offset-1`}
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

export function ScheduleGrid({
  config = DEFAULT_CONFIG,
  rows,
  result,
  period,
  holidays,
  isWeekend,
  fixed,
  selected,
  disabled,
  readOnly = false,
  onSelect,
  history,
  pastDays = 0,
  todayDay = null,
  hideViolations = false,
  cellStyle,
  totalCodes,
  legend = true,
  highlightId,
}: {
  /** 매장 근무 형태. 합계 열과 하단 합계 행이 이 코드를 따른다 */
  config?: ShopConfig;
  rows: Employee[];
  result: ScheduleResult;
  period: Period;
  holidays: number[];
  isWeekend: (d: number) => boolean;
  fixed: Map<string, Code>;
  selected: Cell | null;
  disabled: boolean;
  /** 끝난 근무표: 칸을 편집하지 않는다 */
  readOnly?: boolean;
  onSelect: (cell: Cell) => void;
  /** 직원별 최근 4주 마감·주말. 없으면 0 */
  history?: Map<string, Load>;
  /** 운영 중 기간의 잠긴 지난 날짜 수(1..pastDays) */
  pastDays?: number;
  /** 오늘의 기간 인덱스(열 머리 밑줄) */
  todayDay?: number | null;
  /** 변환 전 결과: 못 지킨 규칙 표시를 숨긴다 */
  hideViolations?: boolean;
  /** 칸마다 줄 인라인 스타일(랜딩 시퀀스의 지연) */
  cellStyle?: (employeeId: string, day: number) => CSSProperties;
  /** 하단 합계 행을 이 근무조로 줄인다. 없으면 모두 */
  totalCodes?: Code[];
  /** 표 위 근무조 범례(색·이름·시각). 랜딩 시퀀스는 끈다 */
  legend?: boolean;
  /** 이름 칸을 강조할 행(직원 화면의 자기 행) */
  highlightId?: string;
}) {
  const pdays = periodDays(period);
  const codes = shownCodes(config, result.assignments);
  // 하단 합계는 근무조(복합 코드는 세는 근무조마다 더한다)
  const teams = codes.filter((s) => s.code !== "O" && !s.parts?.length && (!totalCodes || totalCodes.includes(s.code)));
  const covers = (code: Code, team: Code) =>
    code === team || (config.shifts.find((s) => s.code === code)?.parts ?? []).includes(team);
  // 최근 4주 기록이 하나도 없으면(첫 근무표) 누적 부담 열을 그리지 않는다
  const showHistory = [...(history?.values() ?? [])].some((h) => h.closings > 0 || h.weekends > 0);
  const dayList = pdays.map((p) => p.day);
  // grid-cols-[150px_repeat(N,30px)_repeat(K,34px)_repeat(2,44px)], N = 기간 길이, K = 근무 코드 수
  const grid = {
    gridTemplateColumns: `150px repeat(${period.length}, 30px) repeat(${codes.length}, 34px)${showHistory ? " repeat(2, 44px)" : ""}`,
  };
  const rowClass = "grid gap-x-0.5";
  const weekendBg = (d: number) => (isWeekend(d) ? "bg-[#F1EEE6]" : "");
  const changed = new Set((result.diff ?? []).map((c) => `${c.employee_id}-${c.day}`));
  const violations = new Map<string, string[]>();
  for (const v of hideViolations ? [] : result.soft_violations) {
    if (!v.employee_id || !v.day) continue;
    const key = `${v.employee_id}-${v.day}`;
    violations.set(key, [...(violations.get(key) ?? []), v.detail]);
  }
  const total = "flex h-7 items-center justify-center font-mono text-[13px] font-medium text-[#1B1B18]";
  const swatch = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-xs font-mono";

  return (
    <div className="flex flex-col gap-3">
      {legend && (
        <ul aria-label="근무조" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {codes.map(({ code, name, start, end }) => (
            <li key={code} className="flex items-center gap-1.5 text-[13px] text-[#3D3D38]">
              <span aria-hidden="true" className={`${swatch} ${codeClass(code, false, config)}`}>
                {cellText(code)}
              </span>
              {code === OFF_CODE ? "빈칸 휴무" : name}
              {start && end && <span className="font-mono text-xs text-[#66665E]">{start}~{end}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto">
        <div className="flex w-max flex-col gap-0.5">
          <div className={rowClass} style={grid}>
            <span className="flex items-end text-xs font-medium text-[#66665E]">이름</span>
            {pdays.map(({ day: d, weekday: w }) => (
              <DayHead key={d} label={dayHeader(period, d)} weekday={w} holiday={holidays.includes(d)} weekend={isWeekend(d)} today={d === todayDay} />
            ))}
            {codes.map(({ code, name }) => (
              <span key={code} title={name} className="flex items-end justify-center font-mono text-xs font-semibold text-[#66665E]">
                {code}
              </span>
            ))}
            {/* 누적 부담(최근 4주) */}
            {showHistory && [`최근 4주\n${closingShift(config)?.name ?? "마감"}`, "최근 4주\n주말"].map((label) => (
              <span key={label} className="flex items-end justify-center text-center text-[11px] leading-tight font-medium whitespace-pre-line text-[#66665E]">
                {label}
              </span>
            ))}
          </div>

          {rows.map((n) => {
            const row = result.assignments[n.id];
            const s = result.stats[n.id];
            return (
              <div key={n.id} className={rowClass} style={grid}>
                <span
                  className={`flex h-7 items-center truncate text-sm text-[#1B1B18] ${n.id === highlightId ? "rounded-xs bg-[#F0F6F8] px-1.5 font-semibold" : ""}`}
                >
                  {n.name}
                  {n.tags?.length ? <span className="ml-1.5 truncate text-xs font-medium text-[#66665E]">{n.tags.join(" · ")}</span> : null}
                </span>
                {row.map((code, i) => {
                  const d = i + 1;
                  const { month: m, dom } = pdays[i];
                  const key = `${n.id}-${d}`;
                  const isSel = selected?.employeeId === n.id && selected.day === d;
                  const warn = violations.get(key);
                  const past = d <= pastDays;
                  if (readOnly) {
                    return (
                      <div
                        key={d}
                        aria-label={`${n.name} ${m}월 ${dom}일 ${code}`}
                        title={warn ? warn.join(", ") : undefined}
                        style={cellStyle?.(n.id, d)}
                        className={`${CELL} ${codeClass(code, isWeekend(d), config)}`}
                      >
                        {cellText(code)}
                        {warn && <span aria-hidden="true" className="absolute bottom-px left-px size-[5px] rounded-full bg-[#A15C07]" />}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={disabled}
                      aria-disabled={past || undefined}
                      onClick={() => !past && onSelect({ employeeId: n.id, day: d })}
                      aria-label={`${n.name} ${m}월 ${dom}일 ${code}`}
                      title={past ? "지난 날짜는 바꿀 수 없어요" : warn ? warn.join(", ") : undefined}
                      style={cellStyle?.(n.id, d)}
                      className={`${CELL} ${codeClass(code, isWeekend(d), config)} ${
                        past ? "cursor-not-allowed opacity-55" : "hover:opacity-80"
                      } disabled:cursor-wait ${
                        changed.has(key) ? "shadow-[inset_0_0_0_2px_#D97706]" : ""
                      } ${isSel ? "outline-2 outline-offset-1 outline-[#155E75]" : ""}`}
                    >
                      {cellText(code)}
                      {(past || fixed.has(key)) && <LockIcon />}
                      {warn && <span aria-hidden="true" className="absolute bottom-px left-px size-[5px] rounded-full bg-[#A15C07]" />}
                    </button>
                  );
                })}
                {codes.map(({ code }) => (
                  <span key={code} className={total}>
                    {s?.counts?.[code] ?? row.filter((x) => x === code).length}
                  </span>
                ))}
                {showHistory && (
                  <>
                    <span className={total}>{history?.get(n.id)?.closings ?? 0}</span>
                    <span className={total}>{history?.get(n.id)?.weekends ?? 0}</span>
                  </>
                )}
              </div>
            );
          })}

          {teams.map(({ code }, i) => (
            <div key={code} className={`${rowClass} ${i === 0 ? "mt-1.5 border-t border-[#EFEFEB] pt-1.5" : ""}`} style={grid}>
              <span className="flex h-7 items-center text-xs font-medium text-[#66665E]">{code} 합계</span>
              {dayList.map((d) => (
                <span key={d} className={`${total} rounded-xs ${weekendBg(d)}`}>
                  {rows.filter((n) => covers(result.assignments[n.id][d - 1], code)).length}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatsTable({
  config,
  rows,
  result,
  history,
  legacy = false,
}: {
  config: ShopConfig;
  rows: Employee[];
  result: ScheduleResult;
  history: Map<string, Load>;
  /** 변환 전 결과: 희망 반영률 열을 숨긴다 */
  legacy?: boolean;
}) {
  const codes = shownCodes(config, result.assignments);
  const thBase = "px-3 py-2 text-xs font-medium whitespace-nowrap text-[#66665E]";
  const th = `${thBase} text-right`;
  const td = "px-3 py-1.5 text-right font-mono text-[13px] font-medium text-[#1B1B18]";
  const showHistory = [...history.values()].some((h) => h.closings > 0 || h.weekends > 0);
  // 근무표를 먼저 보도록 통계는 접어 두고 버튼으로 펼친다
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div>
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={ui.secondary}>
          개인별 통계 보기
        </button>
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className={ui.sectionTitle}>개인별 통계</h2>
        <div className="flex items-baseline gap-3">
          <p className={ui.help}>“왜 나만 주말이 많아요?”에 보여 줄 근거예요.</p>
          <button type="button" aria-expanded onClick={() => setOpen(false)} className={ui.textSm}>
            접기
          </button>
        </div>
      </div>
      <div className={`${ui.card} overflow-x-auto`}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#E2E2DC]">
              <th className={`${thBase} text-left`}>이름</th>
              {codes.map(({ code, name }) => (
                <th key={code} title={name} className={`${th} font-mono`}>
                  {code}
                </th>
              ))}
              <th className={th}>근무 시간</th>
              <th className={th}>주말·공휴일 근무</th>
              <th className={th}>최대 연속 근무</th>
              {!legacy && <th className={th}>희망 반영률</th>}
              <th className={th}>평균보다 많은 근무일</th>
              {showHistory && (
                <>
                  <th className={th}>최근 4주 {closingShift(config)?.name ?? "마감"}</th>
                  <th className={th}>최근 4주 주말</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const s = result.stats[n.id];
              if (!s) return null;
              return (
                <tr key={n.id} className="border-b border-[#EFEFEB] last:border-b-0">
                  <td className="px-3 py-1.5 text-sm text-[#1B1B18]">{n.name}</td>
                  {codes.map(({ code }) => (
                    <td key={code} className={td}>
                      {s.counts?.[code] ?? 0}
                    </td>
                  ))}
                  <td className={td}>{s.hours ?? 0}시간</td>
                  <td className={td}>{s.weekend_holiday_work}</td>
                  <td className={td}>{s.max_consecutive_work}일</td>
                  {!legacy && (
                    <td className={td}>{s.preference_rate === null ? "–" : `${Math.round(s.preference_rate * 100)}%`}</td>
                  )}
                  <td className={`${td} ${Math.round(s.deviation) > 0 ? "text-[#A15C07]!" : ""}`}>{formatDeviation(s.deviation)}</td>
                  {showHistory && (
                    <>
                      <td className={td}>{history.get(n.id)?.closings ?? 0}</td>
                      <td className={td}>{history.get(n.id)?.weekends ?? 0}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
