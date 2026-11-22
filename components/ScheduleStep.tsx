"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { ApiError, errorMessage, explain, solve } from "@/lib/api";
import { toScheduleCsv } from "@/lib/csv";
import { availabilityFromLinks, coversShift, isAvailabilityRule, mergeAvailabilityConflicts, unsubmittedCause } from "@/lib/availability";
import { coverageDays } from "@/lib/coverage-conflict";
import { demoExplanation } from "@/lib/demo";
import { coverageShortages, type Shortage } from "@/lib/shortage";
import { DEMO_DOC } from "@/lib/demo-doc";
import { diffAssignments, historyLoadFor, isOperating } from "@/lib/continuity";
import { closingShift, DEFAULT_CONFIG, OFF_CODE, ruleShape, shiftTones } from "@/lib/rules";
import { dateOfDay, dayHeader, dayOfDate, isWeekendDay, monthDay, periodDays, periodEnd } from "@/lib/period";
import {
  availabilityChanged,
  carryOverChanged,
  type Code,
  COVERAGE_SOURCE_TEXT,
  currentPeriod,
  disabledRulesFor,
  exceptedRulesFor,
  refEmployees,
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
import { describeRule, formatDeviation, hardnessLabel, josa, presetName, roleLabel, violationWhere, type ScheduleInputs } from "@/lib/wording";

import Dialog from "./Dialog";
import { Spinner, today } from "./RulesStep";
import { StepBar } from "./Stepper";
import { ui } from "./ui";

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 근무표 날짜 머리 두 줄(날짜 / 요일). 토요일 강조색, 일요일·공휴일 빨강. */
export function DayHead({
  label,
  weekday,
  holiday,
  weekend,
  today: isToday = false,
  marked = false,
}: {
  label: string;
  weekday: number;
  holiday: boolean;
  weekend: boolean;
  today?: boolean;
  /** 못 지킨 규칙 목록에서 고른 날 */
  marked?: boolean;
}) {
  const color = weekday === 0 || holiday ? "text-[#B42318]" : weekday === 6 ? "text-[#C4247C]" : "text-[#6B6F78]";
  return (
    <span
      className={`flex flex-col items-center rounded-xs py-0.5 text-[11px] ${weekend ? "bg-[#F5F5F4]" : ""} ${color} ${
        isToday ? "border-b-2 border-[#C4247C]" : ""
      } ${marked ? "ring-2 ring-inset ring-[#B42318]" : ""}`}
    >
      <span className="font-mono font-medium tracking-[-0.04em] whitespace-nowrap">{label}</span>
      <span>{WEEKDAYS[weekday]}</span>
    </span>
  );
}

export const CELL =
  "relative w-[30px] h-7 rounded-lg inline-flex items-center justify-center font-mono transition-colors duration-[120ms]";
/** 근무조 색 단계(shiftTones): 오픈은 파랑, 미들은 초록, 마감은 보라. 기본 오픈·미들·마감은 0·2·4. */
const TONE_CLASS = [
  "bg-[#E5EDFF] text-[#1E4FD8]",
  "bg-[#E0F2FE] text-[#075985]",
  "bg-[#DDF7E9] text-[#067647]",
  "bg-[#FCE7F6] text-[#C11574]",
  "bg-[#EEE9FF] text-[#5925DC]",
];
/** 근무조를 합친 코드(더블 등) */
const MULTI_CLASS = "bg-[#EEE9FF] text-[#5925DC]";
/** 근무 형태에 없는 코드 */
const OTHER_CODE_CLASS = "bg-[#EDEDEA] text-[#111214]";
const OFF_CLASS = "bg-[#FFEBDB] text-[#B93815] font-normal border border-transparent";

/** 근무 코드 색과 글자 크기(3자 코드는 작게). 색은 근무 형태의 시작 시각 순서로 정한다. */
export function codeClass(code: Code, config: ShopConfig = DEFAULT_CONFIG): string {
  const tone = shiftTones(config)[code];
  const color =
    tone === "off"
      ? OFF_CLASS
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
  // 체험은 링크가 없고 가능 시간이 문서에 들어 있다
  if (s.demo) return false;
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
        // 체험은 LLM을 부르지 않고 저장된 설명을 쓴다. 요청이 저장 시점과 다르면 설명 없이 둔다
        if (s.demo) {
          const explanation = demoExplanation(DEMO_DOC, req, res.input_version);
          setOutcome((o) => (o?.kind === "infeasible" && o.version === res.input_version ? { ...o, explanation } : o));
          return;
        }
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
    <div role="alert" className="flex items-center gap-3 rounded-2xl border border-[#FECDCA] bg-white py-2 pr-2 pl-4 text-sm text-[#B42318]">
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
  reviewPanel = false,
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
  /** 맨 아래 버튼 줄(근무표 작성 ③의 고정 바) */
  actions?: ReactNode;
  outcomeAtGrid?: boolean;
  reviewPanel?: boolean;
}) {
  const shop = useAppStore((s) => s.shop);
  const periods = useAppStore((s) => s.periods);
  const inputVersion = useAppStore((s) => s.inputVersion);
  const setFixed = useAppStore((s) => s.setFixed);
  const clearFixed = useAppStore((s) => s.clearFixed);
  const setDisabled = useAppStore((s) => s.setDisabled);
  const exceptDays = useAppStore((s) => s.exceptDays);
  const applyChanges = useAppStore((s) => s.applyChanges);
  const go = useAppStore((s) => s.go);
  const [selected, setSelected] = useState<Cell | null>(null);
  // 못 지킨 규칙 목록에서 고른 날. 다시 만들면(solved가 바뀌면) 지운다
  const [mark, setMark] = useState<{ day: number; result: ScheduleResult } | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const reviewId = useId();
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const selectedButton = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (reviewPanel && selected) reviewHeading.current?.focus();
  }, [reviewPanel, selected]);

  if (!shop) return null;
  const periodId = period.id;
  const now = today();
  const { employees, holidays = [], constraints = [], history: raw = null } = toScheduleRequest(shop, period, periods, now);
  const { resultVersion } = period;
  // 변환 전 결과는 희망 반영률·못 지킨 규칙을 셀 수 없어 숨긴다(★12)
  const legacy = period.result !== null && isLegacyResult(period.result);
  const confirmed = period.versions.at(-1)?.assignments ?? null;
  const solved = period.result && withStats(period.result, shop.config, period, holidays);
  // 바뀐 칸은 마지막 확정본과 비교한다. 솔버의 diff는 직전 결과와의 차이라 확정 직후에도 남는다. 확정본이 없거나 같으면 보여 주지 않는다
  const changed = solved && confirmed ? diffAssignments(confirmed, solved.assignments) : [];
  const result = solved && { ...solved, diff: changed.length ? changed : null };
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

  const onSelect = (cell: Cell, trigger: HTMLButtonElement) => {
    if (readOnly || cell.day <= pastDays) return;
    selectedButton.current = trigger;
    setSelected(cell);
  };

  // 못 지킨 규칙을 누르면: 직원 칸이면 그 칸을 열고, 날짜만 있으면 그날 머리글을 표시한다
  const showViolation = (employeeId: string | null, day: number) => {
    const { month, dom } = periodDays(period)[day - 1];
    const name = employees.find((n) => n.id === employeeId)?.name;
    const cell = name ? document.querySelector<HTMLButtonElement>(`button[aria-label^="${name} ${month}월 ${dom}일 "]`) : null;
    if (employeeId && cell) {
      cell.scrollIntoView({ block: "nearest", inline: "center" });
      cell.focus();
      onSelect({ employeeId, day }, cell);
      return;
    }
    if (solved) setMark({ day, result: solved });
  };

  const closeEditor = () => {
    setSelected(null);
    if (reviewPanel) selectedButton.current?.focus();
  };

  const onPick = (cell: Cell, code: Code | null) => {
    closeEditor();
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
  const pdays = periodDays(period);
  const exceptedRules = exceptedRulesFor(shop, period).map(({ rule, days }) => ({
    text: describeRule(rule, shop.config, employees, period).text,
    when: days.map((d) => `${WEEKDAY_SHORT[pdays[d - 1].weekday]} ${monthDay(period, d)}`).join(", "),
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
      holidays={holidays}
      hasResult={result !== null}
      onAccept={(p) => {
        applyChanges(periodId, p.changes);
        sv.run();
      }}
      onDisable={(id) => {
        setDisabled(periodId, id, true);
        sv.run();
      }}
      onExcept={(id, days) => {
        exceptDays(periodId, id, days);
        sv.run();
      }}
      onToggle={(id, enabled) => setDisabled(periodId, id, !enabled)}
    />
  );

  const summary = result && (
    <SummaryLine result={result} infeasible={outcome !== null} confirmed={isConfirmed} draft={isDraft} legacy={legacy} care={care} disabled={disabledRules} excepted={exceptedRules} stacked={reviewPanel} />
  );
  const selectedEmployee = selected && employees.find((n) => n.id === selected.employeeId);
  const currentCode = selected && result?.assignments[selected.employeeId]?.[selected.day - 1];
  const cellRules = reviewPanel && selected && selectedEmployee && result ? constraints.filter((c) => {
    if (c.enabled === false || c.type === "fixed_assignment" || isAvailabilityRule(c.id)) return false;
    const shape = ruleShape(c);
    const scope = c.body.kind === "require" ? c.body.for_each : c.body;
    const people = scope.people;
    const ids = people?.ids ?? (!people?.tags?.length ? refEmployees(c) : []);
    const tags = selectedEmployee.tags ?? [];
    if ((people?.ids != null || ids.length > 0) && !ids.includes(selected.employeeId)) return false;
    if (people?.tags != null && !people.tags.some((tag) => tags.includes(tag))) return false;
    if (people?.exclude_tags?.some((tag) => tags.includes(tag))) return false;
    if (!coverageDays(shape && "days" in shape ? shape.days : scope.days, period, holidays).includes(selected.day)) return false;
    if (shape?.kind === "count" && shape.per === "day") {
      const codes = [currentCode, ...(shop.config.shifts.find((shift) => shift.code === currentCode)?.parts ?? [])];
      if (shape.shifts.in && !shape.shifts.in.some((code) => codes.includes(code))) return false;
      if (shape.shifts.not_in?.some((code) => codes.includes(code))) return false;
    }
    return true;
  }) : [];
  const editor = selected && (
    <CellEditor
      config={shop.config}
      codes={shop.config.shifts.filter((s) => s.active !== false)}
      label={`${selectedEmployee?.name ?? selected.employeeId} ${monthDay(period, selected.day)}`}
      fixed={fixed.get(`${selected.employeeId}-${selected.day}`)}
      onPick={(code) => onPick(selected, code)}
      onCancel={closeEditor}
      current={reviewPanel ? currentCode ?? undefined : undefined}
      available={reviewPanel ? (shift) => coversShift(period.availability[selected.employeeId]?.[dateOfDay(period, selected.day)] ?? [], shift, shop.config) : undefined}
    />
  );

  return (
    <>
      {stale && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#FFD3B0] bg-[#FFEBDB] py-1.5 pr-2 pl-4 text-sm text-[#B93815]"
        >
          <span className={`${ui.badge} bg-white text-[#B93815]`}>입력이 바뀌었어요. 다시 만들어 주세요</span>
          <button type="button" onClick={sv.run} disabled={busy} className={ui.secondarySm}>
            다시 만들기
          </button>
        </div>
      )}

      {!outcomeAtGrid && outcomePanel}

      {result && (
        <>
          {!reviewPanel && summary}
          {summaryLead}
          {legacy && <p className="text-sm text-[#6B6F78]">변환 전에 확정한 근무표예요. 희망 반영과 못 지킨 규칙은 보여 주지 않아요.</p>}
          {evidence && <p className="text-sm text-[#4B4F57]">{evidence}</p>}
        </>
      )}

      {outcomeAtGrid && outcomePanel}

      {result && (
        <div className={reviewPanel ? ui.workLayout : undefined}>
          <section aria-label="근무표" className={`${ui.card} flex min-w-0 flex-col gap-3`}>
            <ScheduleGrid
              fluid
              legendAside={reviewPanel ? undefined : editor ?? hint ?? gridNote}
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
              detailId={reviewPanel ? reviewId : undefined}
              history={history}
              pastDays={pastDays}
              todayDay={todayDay}
              hideViolations={legacy}
              markedDay={mark && mark.result === solved ? mark.day : null}
            />
            {/* 근무표를 먼저 보도록 통계는 접어 두고, 펼치면 근무표 바로 아래에 둔다 */}
            {!statsOpen && (
              <div className="flex justify-end border-t border-[#F5F5F4] pt-2">
                <button type="button" aria-expanded={false} onClick={() => setStatsOpen(true)} className={ui.textSm}>
                  개인별 통계 보기
                </button>
              </div>
            )}
          </section>
          {reviewPanel && (
            <aside id={reviewId} aria-label="근무표 확인 패널" className={ui.workAside}>
              <section className={`${ui.card} flex flex-col gap-3`} onKeyDown={(e) => {
                if (selected && e.key === "Escape") closeEditor();
              }}>
                {selected ? (
                  <>
                    <button type="button" onClick={closeEditor} className={`${ui.textSm} self-start`}>← 결과 요약</button>
                    <h3 ref={reviewHeading} tabIndex={-1} className={`${ui.cardTitle} wrap-anywhere`}>
                      {selectedEmployee?.name} · {monthDay(period, selected.day)}
                    </h3>
                    <p className={ui.help}>지금: {shop.config.shifts.find((s) => s.code === currentCode)?.name ?? currentCode}</p>
                    {editor}
                    <div className="flex flex-col gap-1.5">
                      <h4 className={ui.label}>이 칸과 관련된 규칙</h4>
                      {cellRules.length ? (
                        <ul className="flex flex-col gap-1 text-sm">
                          {cellRules.map((rule) => <li key={rule.id} className="wrap-anywhere">{describeRule(rule, shop.config, employees, period).text}</li>)}
                        </ul>
                      ) : <p className={ui.help}>해당하는 규칙이 없어요.</p>}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className={ui.cardTitle}>결과 요약</h3>
                    {summary}
                    {!legacy && result.soft_violations.length > 0 && (
                      <ul aria-label="못 지킨 선호 규칙 목록" className="max-h-48 space-y-2 overflow-y-auto text-sm text-[#4B4F57]" tabIndex={0}>
                        {result.soft_violations.map((violation, index) => {
                          const rule = constraints.find((item) => item.id === violation.constraint_id);
                          const where = violationWhere(violation, period, employees);
                          const day = violation.day;
                          return (
                            <li key={`${violation.constraint_id}-${index}`}>
                              <button
                                type="button"
                                disabled={!day}
                                onClick={() => day && showViolation(violation.employee_id ?? null, day)}
                                className="w-full rounded-lg bg-[#F5F5F4] p-2 text-left wrap-anywhere enabled:hover:bg-[#EDEDEA] focus-visible:outline-2 focus-visible:outline-[#C4247C]"
                              >
                                {rule && <span className="block font-semibold">{presetName(rule)}</span>}
                                {where && <span className="font-medium text-[#B42318]">{where} · </span>}
                                {violation.detail}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {hint ?? gridNote}
                  </>
                )}
              </section>
            </aside>
          )}
        </div>
      )}

      {result && statsOpen && (
        <StatsTable config={shop.config} rows={rows} result={result} history={history} legacy={legacy} onClose={() => setStatsOpen(false)} />
      )}

      {actions}
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
  const demo = useAppStore((s) => s.demo);
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
    // 체험은 직원 링크를 잠그거나 서버에 저장하지 않고, 이 브라우저 안에서만 확정한다
    if (demo) {
      confirm(periodId);
      return;
    }
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
      {/* 스테퍼와 페이지 제목에 이미 "근무표"가 있어 화면에는 보이지 않는다. 단계를 옮기면 여기로 포커스가 온다 */}
      <h2 tabIndex={-1} data-step-title className="sr-only">
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

      {!result && !sv.outcome && <ReadyCard inputs={scheduleInputs(shop, period, periods)} />}

      <ScheduleBody
        period={period}
        solve={sv}
        busy={busy}
        outcomeAtGrid
        reviewPanel
        hint={
          <p className="text-[13px] text-[#6B6F78]">
            <span>칸을 누르면 바꿀 수 있어요.</span>{" "}
            <span className="whitespace-nowrap">
              <InlineLock /> 고정한 칸은 다시 만들 때 그대로 둬요
            </span>
          </p>
        }
        actions={
          <StepBar current={3} total={3} caption="근무표">
            {result &&
              (blocked ? (
                <p className={ui.help}>가능 시간이 바뀌어 다시 만들어야 확정할 수 있어요</p>
              ) : (
                outdated && <p className={ui.help}>지금 조건으로 만든 근무표만 확정할 수 있어요</p>
              ))}
            <button type="button" onClick={() => go({ screen: "period", periodId, step: 2 })} className={ui.secondaryLg}>
              이전
            </button>
            {result ? (
              <>
                <button type="button" onClick={() => downloadCsv(period, employees, result)} disabled={busy} className={ui.text}>
                  CSV 받기
                </button>
                <button type="button" onClick={sv.run} disabled={remake} className={ui.secondaryLg}>
                  {loading && <Spinner />}
                  {loading ? "만드는 중…" : "다시 만들기"}
                </button>
                <button
                  type="button"
                  onClick={() => (demo ? void onConfirm() : setConfirmOpen(true))}
                  disabled={busy || blocked || outdated}
                  className={ui.primaryLg}
                >
                  확정
                </button>
              </>
            ) : (
              <button type="button" onClick={sv.run} disabled={remake} className={ui.primaryLg}>
                {loading && <Spinner />}
                {loading ? "만드는 중…" : "근무표 만들기"}
              </button>
            )}
          </StepBar>
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

/** ③ 만들기 전: 무엇으로 만드는지 확인하는 카드. 만들기 버튼은 아래 고정 바에 있다. */
function ReadyCard({ inputs }: { inputs: ScheduleInputs }) {
  const allIn = inputs.submitted === inputs.employees;
  const checks = [
    { ok: allIn, text: `제출 ${inputs.submitted}/${inputs.employees}명` },
    { ok: true, text: `필수 규칙 ${inputs.hard}개` },
    { ok: true, text: `선호 규칙 ${inputs.soft}개` },
    ...(inputs.disabled > 0 ? [{ ok: false, text: `이번 근무표에서 끈 규칙 ${inputs.disabled}개` }] : []),
    ...(inputs.carryDays > 0 ? [{ ok: true, text: `지난 근무 ${inputs.carryDays}일 이어받음` }] : []),
  ];
  return (
    <section aria-label="근무표 만들기 전 확인" className="flex flex-col gap-4 rounded-3xl border-[1.5px] border-[#2558F0] bg-[#F2F6FF] px-6 py-6">
      <span className="inline-flex h-7 items-center gap-1.5 self-start rounded-full bg-[#2558F0] px-3 text-[13px] font-semibold text-white">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round">
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" />
        </svg>
        만들 준비
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-2xl font-bold tracking-[-0.03em] text-[#111214]">{allIn ? "근무표를 만들 차례예요" : "아직 안 낸 직원이 있어요"}</p>
        <p className="text-[15px] text-[#4B4F57]">
          {allIn ? "필수 규칙을 하나도 어기지 않는 근무표를 찾아요" : "기다리지 않고 지금 만들어도 돼요"}
        </p>
      </div>
      <ul aria-label="만들 때 쓰는 것" className="flex flex-wrap items-center gap-2">
        {checks.map((c) => (
          <li key={c.text} className="inline-flex h-[34px] items-center gap-1.5 rounded-full bg-white px-3 text-[13.5px] font-medium text-[#111214]">
            {c.ok ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="#12B76A" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : (
              <span aria-hidden="true" className="size-1.5 rounded-full bg-[#FF7A1A]" />
            )}
            {c.text}
          </li>
        ))}
      </ul>
    </section>
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
  holidays,
  hasResult,
  onAccept,
  onDisable,
  onExcept,
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
  holidays: number[];
  hasResult: boolean;
  onAccept: (p: RelaxationProposal) => void;
  onDisable: (id: string) => void;
  /** [그날만 빼고 만들기]: 그 규칙에서 그 날들만 빼고 다시 만든다 */
  onExcept: (id: string, days: number[]) => void;
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
  // 가능 시간만으로 인원을 채울 수 없는 날(규칙마다). 다른 규칙과 겹쳐 막힌 경우는 비어 있다
  const shortages =
    outcome.kind === "infeasible"
      ? coverageShortages(outcome.conflicts.map((c) => c.constraint_id), constraints, employees, config, period, holidays)
      : [];
  // 가능 시간은 직원이 정한 것이라 끌 수 없다
  const hardList = constraints.filter((c) => (c.hardness ?? "hard") === "hard" && !isAvailabilityRule(c.id));

  return (
    <section className="flex flex-col gap-3.5 rounded-2xl border border-[#FECDCA] bg-white px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${ui.badge} ${ui.badgeTone.none}`}>{outcome.kind === "timeout" ? "시간 초과" : "근무표 없음"}</span>
        <h2 className={ui.cardTitle}>
          {outcome.kind === "timeout" ? "시간 안에 근무표를 만들지 못했어요" : "이 조건으로는 근무표를 만들 수 없어요"}
        </h2>
        {hasResult && <span className={ui.help}>아래는 마지막으로 만든 근무표예요.</span>}
      </div>

      {unsubmitted && (
        <div className="flex flex-col items-start gap-1.5">
          <p className="text-sm text-[#111214]">
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
      {(shortages.length > 0 || explanation || (outcome.kind === "infeasible" && explaining)) && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold text-[#111214]">왜 만들 수 없나요?</h3>
          {ruleConflicts.map((c) => (
            <ShortageLines
              key={c.constraint_id}
              shortages={shortages.filter((x) => x.constraintId === c.constraint_id)}
              config={config}
              employees={employees}
              period={period}
              busy={busy}
              onExcept={(days) => onExcept(c.constraint_id, days)}
            />
          ))}
          {explanation ? (
            <p className="text-sm leading-relaxed whitespace-pre-line text-[#4B4F57]">
              {explanation.text}
              {explanation.fallback && (
                <span className="text-[#6B6F78]"> 자동 설명을 만들지 못해 함께 지킬 수 없는 규칙만 보여 줘요.</span>
              )}
            </p>
          ) : (
            outcome.kind === "infeasible" &&
            explaining && (
              <p className="flex items-center gap-2 text-sm text-[#6B6F78]">
                <Spinner />
                원인을 분석하는 중…
              </p>
            )
          )}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-semibold text-[#111214]">이렇게 바꾸면 만들 수 있어요</h3>
            <span className={ui.help}>이번 근무표에만 적용돼요. 매장 조건은 그대로예요</span>
          </div>
          <div className="flex flex-col divide-y divide-[#F5F5F4] border-y border-[#F5F5F4]">
            {proposals.map((p, i) => (
              <ProposalCard
                key={i}
                recommended={i === 0}
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
          <h3 className="text-sm font-semibold text-[#111214]">{ruleConflicts.length > 1 ? "함께 지킬 수 없는 규칙" : "지킬 수 없는 규칙"}</h3>
          <p className={ui.help}>하나를 끄면 바로 다시 만들어요. 원래 설정은 그대로 남아요.</p>
          <ul className="flex flex-col">
            {ruleConflicts.map((c) => {
              const found = constraints.find((x) => x.id === c.constraint_id);
              return (
                <li key={c.constraint_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F5F5F4] py-1.5 last:border-b-0">
                  <span className="flex flex-wrap items-baseline gap-2 text-sm text-[#111214]">
                    <span className="text-xs font-medium text-[#6B6F78]">{found ? presetName(found) : "규칙"}</span>
                    {c.source_text !== COVERAGE_SOURCE_TEXT && <>“{c.source_text}”</>}
                    {found && (
                      <span className="font-mono text-xs text-[#6B6F78]">{describeRule(found, config, employees, period).text}</span>
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
          <h3 className="text-sm font-semibold text-[#111214]">가능 시간이 함께 걸린 직원</h3>
          <p className="text-sm text-[#111214]">{availabilityNames.join(", ")}</p>
          <p className={ui.help}>가능 시간은 직원이 정한 것이라 끌 수 없어요. 더 일할 수 있는지 물어보면 해결될 수도 있어요.</p>
        </div>
      )}

      {unknownCause && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-[#111214]">
            {outcome.kind === "timeout"
              ? "'필수' 규칙을 하나씩 꺼서 확인해 주세요."
              : "원인을 찾지 못했어요. 규칙을 하나씩 꺼서 확인해 주세요."}
            <span className={ui.help}> 끄거나 켠 뒤 [다시 만들기]를 눌러 주세요.</span>
          </p>
          <ul className="flex flex-col">
            {hardList.map((c) => {
              const on = c.enabled !== false;
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F5F5F4] py-1.5 last:border-b-0">
                  <span className={`flex flex-wrap items-baseline gap-2 text-sm ${on ? "text-[#111214]" : "text-[#6B6F78]"}`}>
                    <span className="text-xs font-medium text-[#6B6F78]">{presetName(c)}</span>“{c.source_text}”
                    <span className="font-mono text-xs text-[#6B6F78]">{describeRule(c, config, employees, period).text}</span>
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

        </>
      )}
    </section>
  );
}

const WEEKDAY_SHORT = ["일", "월", "화", "수", "목", "금", "토"]; // 0=일

/** 인원 규칙이 가능 시간으로 모자란 날. 근무조·필요 인원·들어올 수 있는 사람이 같은 날은 한 줄로 묶고 [그날만 빼고 만들기]를 둔다. */
export function ShortageLines({
  shortages,
  config,
  employees,
  period,
  busy,
  onExcept,
}: {
  shortages: Shortage[];
  config: ShopConfig;
  /** 규칙이 고르는 사람을 부르는 데 쓴다("주방 리더 직원") */
  employees: Employee[];
  period: Period;
  busy?: boolean;
  /** 없으면 [빼고 만들기] 버튼 없이 줄만 보여 준다(① 가능 시간의 미리 경고) */
  onExcept?: (days: number[]) => void;
}) {
  if (!shortages.length) return null;
  const days = periodDays(period);
  const groups = new Map<string, Shortage[]>();
  for (const s of shortages) {
    // 규칙이 다르면(홀 오픈 2명, 주방 오픈 2명) 같은 근무조·인원이어도 따로 적는다
    const key = `${s.constraintId}|${s.code}|${s.need}|${s.names.join(",")}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return (
    <ul className="flex w-full flex-col gap-1 text-[13px] text-[#B42318]">
      {[...groups].map(([key, group]) => {
        const { code, need, names, people } = group[0];
        const when = group.map((s) => `${WEEKDAY_SHORT[days[s.day - 1].weekday]} ${monthDay(period, s.day)}`).join(", ");
        const shift = config.shifts.find((x) => x.code === code)?.name ?? code;
        const role = roleLabel(people, employees);
        const who = names.length ? `${names.join(", ")}만 들어올 수 있어요` : "들어올 수 있는 사람이 없어요";
        return (
          <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span>
              {when} {shift}
              {role && ` · ${role}`}: {who} · {need}명 필요
            </span>
            {onExcept && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onExcept(group.map((s) => s.day))}
                title="그날만 이 규칙 없이 다시 만들어요. 매장 조건은 그대로예요"
                className={ui.secondarySm}
              >
                {group.length === 1 ? `${when}만 빼고 만들기` : `이 ${group.length}일만 빼고 만들기`}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 검증된 제안 한 줄. 첫 제안(recommended)만 [수락]이 Primary다. */
function ProposalCard({
  recommended,
  proposal,
  changes,
  busy,
  onAccept,
  onDismiss,
}: {
  recommended: boolean;
  proposal: RelaxationProposal;
  /** 바꾸는 것("최대 연속 근무 5 → 6")과 그 규칙의 원문 */
  changes: { change: string; quote: string }[];
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const s = proposal.verified_summary!;
  return (
    <article className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h4 className="text-[13px] font-medium text-[#6B6F78]">{proposal.title}</h4>
        {changes.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {changes.map((t, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[15px] font-semibold text-[#111214]">{t.change}</span>
                <span className="text-xs text-[#6B6F78]">{t.quote}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm leading-relaxed text-[#111214]">{proposal.description}</p>
        )}
        <p className="text-xs text-[#6B6F78]">
          <span className="font-medium text-[#067647]">이대로 바꾸면 근무표가 나와요</span>
          {s.preferences_total > 0 && (
            <>
              {" "}
              · 희망 반영 <span className="font-mono">{s.preferences_met}/{s.preferences_total}</span>
            </>
          )}
          {s.soft_violation_count > 0 && (
            <>
              {" "}
              · 못 지킨 선호 규칙 <span className="font-mono">{s.soft_violation_count}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={onDismiss} className={ui.textSm}>
          무시
        </button>
        <button type="button" disabled={busy} onClick={onAccept} className={recommended ? ui.primary : ui.secondary}>
          수락
        </button>
      </div>
    </article>
  );
}

/** 요약 지표 한 줄: 결과 배지, 희망 반영, 못 지킨 선호 규칙, (끈 규칙, 바뀐 칸, 마감 배려). */
function SummaryLine({
  result,
  infeasible,
  confirmed,
  draft,
  legacy = false,
  care = null,
  disabled = [],
  excepted = [],
  stacked = false,
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
  /** [그날만 빼고 만들기]로 날을 뺀 규칙(해석 문장 · 뺀 날). 결과가 "모두 지킴"이어도 그날은 그 규칙 없이 만든 것을 함께 적는다 */
  excepted?: { text: string; when: string }[];
  stacked?: boolean;
}) {
  const { summary } = result;
  const cell = stacked
    ? "flex flex-col gap-0.5 border-b border-[#EDEDEA] py-2 last:border-b-0"
    : "flex flex-col gap-0.5 border-r border-[#EDEDEA] px-4 py-1 last:border-r-0";
  const label = "text-xs text-[#6B6F78]";
  const value = "flex items-center gap-1.5 text-[15px] font-semibold text-[#111214]";
  const dot = (color: string) => <span aria-hidden="true" className={`size-[7px] rounded-full ${color}`} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <dl aria-label="결과 요약" className={stacked ? "w-full" : "flex flex-wrap rounded-2xl border border-[#DCDCD8] bg-white py-1.5"}>
        <div className={cell}>
          <dt className={label}>결과</dt>
          <dd className={value}>
            {infeasible ? (
              <>
                {dot("bg-[#F04438]")}
                <span className="text-[#B42318]">근무표 없음</span>
              </>
            ) : (
              <>
                {dot("bg-[#12B76A]")}필수 규칙 모두 지킴
              </>
            )}
          </dd>
        </div>
        {!legacy && (
          <>
            <div className={cell} title="희망·기피 요청이 걸린 날 중 지킨 날">
              <dt className={label}>희망 반영</dt>
              <dd className={value}>
                {summary.preferences_total > 0 ? (
                  <span className="font-mono">
                    {summary.preferences_met}/{summary.preferences_total}
                  </span>
                ) : (
                  "요청 없음"
                )}
              </dd>
            </div>
            <div className={cell}>
              <dt className={label}>못 지킨 선호 규칙</dt>
              <dd className={`${value} ${summary.soft_violation_count > 0 ? "text-[#B93815]" : ""}`}>
                {summary.soft_violation_count > 0 && dot("bg-[#FF7A1A]")}
                <span className="font-mono">{summary.soft_violation_count}</span>개
              </dd>
            </div>
          </>
        )}
        {disabled.length > 0 && (
          <div className={cell} title={disabled.map((d) => `${d.name} · ${d.text}`).join("\n")}>
            <dt className={label}>이번 근무표에서 끈 규칙</dt>
            <dd className={value}>
              {dot("bg-[#FF7A1A]")}
              <span className="font-mono">{disabled.length}</span>개
            </dd>
          </div>
        )}
        {excepted.length > 0 && (
          <div className={cell}>
            <dt className={label}>그날만 뺀 규칙</dt>
            <dd className={value}>
              {dot("bg-[#FF7A1A]")}
              <span className="font-mono">{excepted.length}</span>개
            </dd>
          </div>
        )}
        {result.diff && (
          <div className={cell}>
            <dt className={label}>확정본에서 바뀐 칸</dt>
            <dd className={value}>
              <span className="font-mono">{result.diff.length}</span>칸
            </dd>
          </div>
        )}
        {care && (
          <div className={cell}>
            <dt className={label}>{care.label}</dt>
            <dd className={value}>{care.text}</dd>
          </div>
        )}
      </dl>
      {!result.optimal && <span className={`${ui.badge} bg-[#FFEBDB] text-[#B93815]`}>더 나은 배치가 있을 수 있어요</span>}
      {confirmed && <span className={`${ui.badge} bg-[#DDF7E9] text-[#067647]`}>확정</span>}
      {draft && <span className={`${ui.badge} border border-[#DCDCD8] bg-white text-[#4B4F57]`}>작성 중</span>}
      {excepted.length > 0 && (
        <ul className="flex w-full flex-col gap-0.5 text-[13px] text-[#B93815]">
          {excepted.map((e) => (
            <li key={`${e.when}|${e.text}`}>
              {e.when}에는 “{e.text}” 없이 만들었어요
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CellEditor({
  config,
  codes,
  label,
  fixed,
  onPick,
  onCancel,
  current,
  available,
}: {
  config: ShopConfig;
  /** 고를 수 있는 근무 코드(활성 코드) */
  codes: ShiftDef[];
  label: string;
  fixed: Code | undefined;
  onPick: (code: Code | null) => void;
  onCancel: () => void;
  current?: Code;
  available?: (shift: ShiftDef) => boolean;
}) {
  const outsideId = useId();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-[#4B4F57]">
        {available ? "바꾸기" : <><span className="font-mono">{label}</span> 고정</>}
      </span>
      {codes.map((shift) => {
        const { code, name } = shift;
        const outside = available && !available(shift);
        return (
          <button
            key={code}
            type="button"
            onClick={() => onPick(code)}
            aria-label={`${code}${josa(code, "으로", "로")} 고정${available ? ` · ${name}` : ""}`}
            aria-describedby={outside ? outsideId : undefined}
            title={outside ? `${name} · 가능 시간 밖` : name}
            aria-pressed={fixed === code}
            className={`${available ? "rounded-lg px-2 py-1.5" : CELL} ${codeClass(code, config)} ${outside ? "opacity-40 line-through" : ""} ${current === code ? "ring-1 ring-inset ring-[#111214]" : ""} hover:opacity-80 aria-pressed:outline-2 aria-pressed:outline-[#C4247C] aria-pressed:outline-offset-1`}
          >
            {available ? name : code}
          </button>
        );
      })}
      {fixed && (
        <button type="button" onClick={() => onPick(null)} className={ui.textSm}>
          고정 해제
        </button>
      )}
      {available ? (
        <p className={`${ui.help} w-full`}>근무를 누르면 이 칸을 고정하고 다시 만들어요. <span id={outsideId}>줄 그어진 근무는 가능 시간 밖이에요.</span></p>
      ) : (
        <button type="button" onClick={onCancel} className={ui.textSm}>취소</button>
      )}
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
  detailId,
  history,
  pastDays = 0,
  todayDay = null,
  hideViolations = false,
  cellStyle,
  totalCodes,
  legend = true,
  highlightId,
  markedDay = null,
  fluid = false,
  legendAside,
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
  onSelect: (cell: Cell, trigger: HTMLButtonElement) => void;
  detailId?: string;
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
  /** 이 날의 머리글을 빨간 테두리로 표시한다(못 지킨 규칙 목록에서 고른 날) */
  markedDay?: number | null;
  /** 날짜 칸을 가로 폭에 맞춰 넓힌다(30~72px). 근무표 작성·확정 근무표 */
  fluid?: boolean;
  /** 범례 줄 오른쪽에 둘 것(안내 한 줄, 칸 편집) */
  legendAside?: ReactNode;
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
  const tail = `repeat(${codes.length}, 34px)${showHistory ? " repeat(2, 44px)" : ""}`;
  const grid = {
    gridTemplateColumns: fluid ? `180px repeat(${period.length}, minmax(30px, 72px)) ${tail}` : `150px repeat(${period.length}, 30px) ${tail}`,
  };
  // 넓힌 표는 가로 폭을 채우되, 좁으면 30px 칸 그대로 가로 스크롤한다
  const minWidth = 180 + period.length * 32 + codes.length * 36 + (showHistory ? 92 : 0);
  const cellWidth = fluid ? "w-full! h-8!" : "";
  const rowClass = "grid gap-x-0.5";
  const weekendBg = (d: number) => (isWeekend(d) ? "bg-[#F5F5F4]" : "");
  const changed = new Set((result.diff ?? []).map((c) => `${c.employee_id}-${c.day}`));
  const violations = new Map<string, string[]>();
  for (const v of hideViolations ? [] : result.soft_violations) {
    if (!v.employee_id || !v.day) continue;
    const key = `${v.employee_id}-${v.day}`;
    violations.set(key, [...(violations.get(key) ?? []), v.detail]);
  }
  const total = "flex h-7 self-center items-center justify-center font-mono text-[13px] font-medium text-[#111214]";
  const swatch = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-xs font-mono";

  return (
    <div className="flex flex-col gap-3">
      {(legend || legendAside) && (
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-6 gap-y-2">
      {legend && (
        <ul aria-label="근무조" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {codes.map(({ code, name, start, end }) => (
            <li key={code} className="flex items-center gap-1.5 text-[13px] text-[#4B4F57]">
              <span aria-hidden="true" className={`${swatch} ${codeClass(code, config)}`}>
                {cellText(code)}
              </span>
              {code === OFF_CODE ? "빈칸 휴무" : name}
              {start && end && <span className="font-mono text-xs text-[#6B6F78]">{start}~{end}</span>}
            </li>
          ))}
        </ul>
      )}
          {legendAside}
        </div>
      )}
      <div className="overflow-x-auto">
        <div className={`flex flex-col gap-0.5 ${fluid ? "w-full" : "w-max"}`} style={fluid ? { minWidth } : undefined}>
          <div className={rowClass} style={grid}>
            <span className="flex items-end text-xs font-medium text-[#6B6F78]">이름</span>
            {pdays.map(({ day: d, weekday: w }) => (
              <DayHead key={d} label={dayHeader(period, d)} weekday={w} holiday={holidays.includes(d)} weekend={isWeekend(d)} today={d === todayDay} marked={d === markedDay} />
            ))}
            {/* 개수 열: 일하는 근무조는 범례의 글자, 휴무는 칸에 글자가 없어 이름으로 쓴다 */}
            {codes.map(({ code, name }) => (
              <span key={code} title={name} className={`flex items-end justify-center text-xs font-semibold text-[#6B6F78] ${code === OFF_CODE ? "" : "font-mono"}`}>
                {code === OFF_CODE ? name : code}
              </span>
            ))}
            {/* 누적 부담(최근 4주) */}
            {showHistory && [`최근 4주\n${closingShift(config)?.name ?? "마감"}`, "최근 4주\n주말"].map((label) => (
              <span key={label} className="flex items-end justify-center text-center text-[11px] leading-tight font-medium whitespace-pre-line text-[#6B6F78]">
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
                  className={`flex h-7 self-center items-center truncate text-sm text-[#111214] ${n.id === highlightId ? "rounded-xs bg-[#F5F5F4] px-1.5 font-semibold" : ""}`}
                >
                  {n.name}
                  {n.tags?.length ? <span className="ml-1.5 truncate text-xs font-medium text-[#6B6F78]">{n.tags.join(" · ")}</span> : null}
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
                        className={`${CELL} ${cellWidth} ${codeClass(code, config)}`}
                      >
                        {cellText(code)}
                        {warn && <span aria-hidden="true" className="absolute bottom-px left-px size-[5px] rounded-full bg-[#B93815]" />}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={disabled}
                      aria-disabled={past || undefined}
                      aria-pressed={isSel}
                      onClick={(e) => !past && onSelect({ employeeId: n.id, day: d }, e.currentTarget)}
                      aria-controls={detailId}
                      aria-label={`${n.name} ${m}월 ${dom}일 ${code}`}
                      title={past ? "지난 날짜는 바꿀 수 없어요" : warn ? warn.join(", ") : undefined}
                      style={cellStyle?.(n.id, d)}
                      className={`${CELL} ${cellWidth} ${codeClass(code, config)} ${
                        past ? "cursor-not-allowed opacity-55" : "hover:opacity-80"
                      } disabled:cursor-wait ${
                        changed.has(key) ? "shadow-[inset_0_0_0_2px_#FF7A1A]" : ""
                      } ${isSel ? "outline-2 outline-offset-1 outline-[#C4247C]" : ""}`}
                    >
                      {cellText(code)}
                      {(past || fixed.has(key)) && <LockIcon />}
                      {warn && <span aria-hidden="true" className="absolute bottom-px left-px size-[5px] rounded-full bg-[#B93815]" />}
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
            <div key={code} className={`${rowClass} ${i === 0 ? "mt-1.5 border-t border-[#F5F5F4] pt-1.5" : ""}`} style={grid}>
              <span className="flex h-7 items-center text-xs font-medium text-[#6B6F78]">{code} 합계</span>
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
  onClose,
}: {
  config: ShopConfig;
  rows: Employee[];
  result: ScheduleResult;
  history: Map<string, Load>;
  /** 변환 전 결과: 희망 반영률 열을 숨긴다 */
  legacy?: boolean;
  onClose: () => void;
}) {
  const codes = shownCodes(config, result.assignments);
  const thBase = "px-3 py-2 text-xs font-medium whitespace-nowrap text-[#6B6F78]";
  const th = `${thBase} text-right`;
  const td = "px-3 py-1.5 text-right font-mono text-[13px] font-medium text-[#111214]";
  const showHistory = [...history.values()].some((h) => h.closings > 0 || h.weekends > 0);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className={ui.sectionTitle}>개인별 통계</h2>
        <div className="flex items-baseline gap-3">
          <p className={ui.help}>“왜 나만 주말이 많아요?”에 보여 줄 근거예요.</p>
          <button type="button" aria-expanded onClick={onClose} className={ui.textSm}>
            접기
          </button>
        </div>
      </div>
      <div className={`${ui.card} overflow-x-auto`}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#EDEDEA]">
              <th className={`${thBase} text-left`}>이름</th>
              {codes.map(({ code, name }) => (
                <th key={code} title={name} className={`${th} ${code === OFF_CODE ? "" : "font-mono"}`}>
                  {code === OFF_CODE ? name : code}
                </th>
              ))}
              <th className={th}>근무 시간</th>
              <th className={th}>주말·공휴일 근무</th>
              <th className={th}>최대 연속 근무</th>
              {!legacy && <th className={th}>희망 반영률</th>}
              <th className={th}>평균과 차이</th>
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
                <tr key={n.id} className="border-b border-[#F5F5F4] last:border-b-0">
                  <td className="px-3 py-1.5 text-sm text-[#111214]">{n.name}</td>
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
                  <td className={`${td} ${Math.round(s.deviation) > 0 ? "text-[#B93815]!" : ""}`}>{formatDeviation(s.deviation)}</td>
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
