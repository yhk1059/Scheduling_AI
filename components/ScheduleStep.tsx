"use client";

import { useState, type ReactNode } from "react";

import { ApiError, errorMessage, explain, solve } from "@/lib/api";
import { toScheduleCsv } from "@/lib/csv";
import { historyLoadFor, isOperating } from "@/lib/continuity";
import { DEFAULT_CONFIG, NIGHT_ONLY_TAG } from "@/lib/migrate";
import { dayHeader, dayOfDate, isWeekendDay, monthDay, periodDays, periodEnd } from "@/lib/period";
import {
  carryOverChanged,
  type Code,
  currentPeriod,
  toScheduleRequest,
  useAppStore,
  type WorkPeriod,
} from "@/lib/store";
import type {
  Conflict,
  ConstraintSpec,
  ExplainResponse,
  Nurse,
  Period,
  RelaxationProposal,
  ScheduleRequest,
  ScheduleResult,
  ShiftDef,
  WardConfig,
} from "@/lib/types.gen";
import { statsFromAssignments } from "@/lib/stats";
import { describeRule, formatDeviation, hardnessLabel, presetName } from "@/lib/wording";

import { markConfirmedEntry } from "./confirmedEntry";
import { Spinner, today } from "./RulesStep";
import { ui } from "./ui";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export const CELL =
  "relative w-[30px] h-7 rounded-xs inline-flex items-center justify-center font-mono transition-colors duration-[120ms]";
const CODE_CLASS: Record<Code, string> = {
  D: "bg-[#FFF1C2] text-[#5C4300] font-semibold border border-transparent",
  E: "bg-[#F9CFAE] text-[#6E2A04] font-semibold border border-transparent",
  N: "bg-[#263248] text-white font-semibold border border-transparent",
  O: "text-[#6B6B63] font-normal border border-[#E2E2DC]",
};

/** 기본 4개 외 코드(M, DE 등)는 중립 색 */
const OTHER_CODE_CLASS = "bg-[#E2E2DC] text-[#1B1B18] font-semibold border border-transparent";

/** 근무 코드 색과 글자 크기(3자 코드는 작게). */
export function codeClass(code: Code, weekend: boolean): string {
  const color = code === "O" ? `${CODE_CLASS.O} ${weekend ? "bg-[#F1EEE6]" : "bg-white"}` : (CODE_CLASS[code] ?? OTHER_CODE_CLASS);
  return `${color} ${code.length >= 3 ? "text-[11px]" : "text-[13px]"}`;
}

/** 열로 보여 줄 근무 코드: 활성 코드 + 결과에 남은 꺼진 코드(config 순서). */
function shownCodes(config: WardConfig, assignments?: ScheduleResult["assignments"]): ShiftDef[] {
  const used = new Set(Object.values(assignments ?? {}).flat());
  return config.shifts.filter((s) => s.active !== false || used.has(s.code));
}

/** 변환 전에 확정한 근무표처럼 통계가 옛 형식(counts 없음)인 결과. */
function isLegacyResult(result: ScheduleResult): boolean {
  return !Object.values(result.stats).every((s) => s.counts);
}

/** 변환 전에 확정한 근무표처럼 통계가 옛 형식(counts 없음)이면 배정으로 다시 센다(★12). */
function withStats(result: ScheduleResult, config: WardConfig, period: Period, holidays: number[]): ScheduleResult {
  if (!isLegacyResult(result)) return result;
  return { ...result, stats: statsFromAssignments(result.assignments, config, period, holidays) };
}

type Req = Omit<ScheduleRequest, "input_version">;
/** 해가 없거나 시간이 초과된 마지막 풀이. version은 그 요청의 inputVersion. */
type Outcome =
  | { kind: "infeasible"; version: number; conflicts: Conflict[]; explanation: ExplainResponse | null }
  | { kind: "timeout"; version: number }
  | null;
type Cell = { nurseId: string; day: number };
export type Toast = { message: string; retry: () => void } | null;
type Load = { nights: number; weekends: number };

/**
 * 누적 부담 근거 한 줄. 최근 4주 나이트가 평균보다 많았던 간호사 중 이번 근무표 N이 평균 이하인 사람.
 * 나이트 전담은 나이트 공정성에서 빠지므로 제외한다. 해당자가 없거나 history가 비면 null.
 */
function historyEvidence(rows: Nurse[], result: ScheduleResult, history: Map<string, Load>): string | null {
  const pool = rows.filter((n) => !n.tags?.includes(NIGHT_ONLY_TAG));
  if (history.size === 0 || pool.length === 0) return null;
  const past = (n: Nurse) => history.get(n.id)?.nights ?? 0;
  const now = (n: Nurse) => result.stats[n.id]?.counts?.N ?? result.assignments[n.id].filter((c) => c === "N").length;
  const avg = (f: (n: Nurse) => number) => pool.reduce((sum, n) => sum + f(n), 0) / pool.length;
  const pastAvg = avg(past);
  const nowAvg = avg(now);
  const eased = pool.filter((n) => past(n) > pastAvg && now(n) <= nowAvg);
  if (eased.length === 0) return null;
  if (eased.length === 1) return `${eased[0].name} 최근 4주 나이트 ${past(eased[0])}회 → 이번 근무표 ${now(eased[0])}회`;
  return `최근 4주 나이트가 많았던 ${eased.length}명은 이번 근무표에서 나이트를 줄였어요`;
}

export function toMessage(e: unknown): string {
  return errorMessage(e instanceof ApiError ? e : new ApiError("INTERNAL", String(e)));
}

/**
 * 근무표 만들기(/solve)와 해 없음 설명(/explain). 근무표 작성 ②와 확정 근무표가 함께 쓴다.
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
    const req = toScheduleRequest(s.ward!, p, s.periods, today());
    const base = p.versions.at(-1)?.assignments;
    if (!base) return req;
    return { ...req, previous: Object.fromEntries(req.nurses.filter((n) => base[n.id]).map((n) => [n.id, base[n.id]])) };
  };

  const run = async () => {
    setLoading(true);
    setToast(null);
    const req = buildRequest();
    try {
      const res = await solve(req);
      // 풀이 중 입력이 바뀌면 버린다(남은 결과에는 stale 배지가 뜬다)
      if (res.input_version !== useAppStore.getState().inputVersion) return;
      if (res.status === "ok") {
        setResult(periodId, res.result, req.carry_over ?? []);
        setOutcome(null);
      } else if (res.status === "timeout") {
        setOutcome({ kind: "timeout", version: res.input_version });
      } else {
        setOutcome({ kind: "infeasible", version: res.input_version, conflicts: res.conflicts, explanation: null });
        setLoading(false);
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

export function downloadCsv(period: WorkPeriod, nurses: Nurse[], result: ScheduleResult) {
  const config = useAppStore.getState().ward?.config ?? DEFAULT_CONFIG;
  const csv = toScheduleCsv({ nurses, period, holidays: period.holidays, assignments: result.assignments, config });
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
 * 근무표 본문: stale 배너, 해 없음 패널, (children), 요약 지표, 근거 한 줄, 근무표(칸 고정), 통계.
 * readOnly면 칸을 누를 수 없다(끝난 근무표).
 */
export function ScheduleBody({
  period,
  solve: sv,
  busy,
  readOnly = false,
  children,
}: {
  period: WorkPeriod;
  solve: Solve;
  busy: boolean;
  readOnly?: boolean;
  children?: ReactNode;
}) {
  const ward = useAppStore((s) => s.ward);
  const periods = useAppStore((s) => s.periods);
  const inputVersion = useAppStore((s) => s.inputVersion);
  const setFixed = useAppStore((s) => s.setFixed);
  const clearFixed = useAppStore((s) => s.clearFixed);
  const setDisabled = useAppStore((s) => s.setDisabled);
  const applyChanges = useAppStore((s) => s.applyChanges);
  const [selected, setSelected] = useState<Cell | null>(null);

  if (!ward) return null;
  const periodId = period.id;
  const now = today();
  const { nurses, holidays = [], constraints = [], history: raw = null } = toScheduleRequest(ward, period, periods, now);
  const { resultVersion } = period;
  // 변환 전 결과는 희망 반영률·못 지킨 규칙을 셀 수 없어 숨긴다(★12)
  const legacy = period.result !== null && isLegacyResult(period.result);
  const result = period.result && withStats(period.result, ward.config, period, holidays);
  const { outcome } = sv;
  const confirmed = period.versions.at(-1)?.assignments ?? null;
  const history = new Map(historyLoadFor(raw, ward.config).map((h) => [h.nurse_id, { nights: h.nights, weekends: h.weekends }]));
  // 운영 중인 기간에서 오늘 이전 날짜는 잠긴다(toScheduleRequest의 pastDayLocks와 같은 범위)
  const todayDay = dayOfDate(period, now);
  const pastDays = isOperating(period, now) && todayDay !== null ? todayDay - 1 : 0;

  const isWeekend = (d: number) => isWeekendDay(period, d, holidays);
  const fixed = new Map<string, Code>();
  for (const c of constraints) {
    if (c.type === "fixed_assignment" && c.enabled !== false) fixed.set(`${c.params.nurse_id}-${c.params.day}`, c.params.shift);
  }

  const onSelect = (cell: Cell) => {
    if (!readOnly && cell.day > pastDays) setSelected(cell);
  };

  const onPick = (cell: Cell, code: Code | null) => {
    setSelected(null);
    if (code === null) clearFixed(periodId, cell.nurseId, cell.day);
    else setFixed(periodId, cell.nurseId, cell.day, code);
    sv.run();
  };

  const isConfirmed = result !== null && confirmed !== null && JSON.stringify(confirmed) === JSON.stringify(result.assignments);
  const isDraft = result !== null && confirmed !== null && !isConfirmed;
  const rows = result ? nurses.filter((n) => result.assignments[n.id]) : [];
  const shownVersion = outcome ? outcome.version : resultVersion;
  const stale = !busy && shownVersion !== null && shownVersion !== inputVersion;
  const evidence = result ? historyEvidence(rows, result, history) : null;

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

      {outcome && (
        <OutcomePanel
          outcome={outcome}
          explaining={sv.explaining}
          busy={busy}
          constraints={constraints}
          nurses={nurses}
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
      )}

      {children}

      {result && (
        <>
          <SummaryCard result={result} infeasible={outcome !== null} confirmed={isConfirmed} draft={isDraft} legacy={legacy} />
          {legacy && <p className="-mt-2 text-sm text-[#66665E]">변환 전에 확정한 근무표예요. 희망 반영과 못 지킨 규칙은 보여 주지 않아요.</p>}
          {evidence && <p className="-mt-2 text-sm text-[#3D3D38]">{evidence}</p>}
          <section className={`${ui.card} flex flex-col gap-3`}>
            <div className="flex h-8 items-center justify-between gap-3">
              <h2 className={ui.cardTitle}>근무표</h2>
              {selected && (
                <CellEditor
                  codes={ward.config.shifts.filter((s) => s.active !== false)}
                  label={`${nurses.find((n) => n.id === selected.nurseId)?.name ?? selected.nurseId} ${monthDay(period, selected.day)}`}
                  fixed={fixed.get(`${selected.nurseId}-${selected.day}`)}
                  onPick={(code) => onPick(selected, code)}
                  onCancel={() => setSelected(null)}
                />
              )}
            </div>
            <ScheduleGrid
              config={ward.config}
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
          <StatsTable config={ward.config} rows={rows} result={result} history={history} legacy={legacy} />
        </>
      )}
    </>
  );
}

/** 근무표 작성 ② 근무표. 만들기 전 [근무표 만들기], 만든 뒤 [확정]. 확정하면 확정 근무표 화면으로 간다. */
export default function ScheduleStep() {
  const ward = useAppStore((s) => s.ward);
  const period = useAppStore(currentPeriod);
  const periods = useAppStore((s) => s.periods);
  const confirm = useAppStore((s) => s.confirm);
  const go = useAppStore((s) => s.go);
  const guest = useAppStore((s) => s.auth === null);
  const sv = useSolve(period?.id ?? "");

  if (!ward || !period) return null;
  const periodId = period.id;
  const { result } = period;
  const { busy, loading } = sv;
  const nurses = toScheduleRequest(ward, period, periods, today()).nurses;

  const onConfirm = () => {
    // 게스트는 확정 근무표 화면 맨 위에 저장 안내를 본다
    if (guest) markConfirmedEntry(periodId, "guest-confirmed");
    confirm(periodId);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 tabIndex={-1} data-step-title className={`${ui.cardTitle} outline-none`}>
            근무표
          </h2>
          <p className="text-sm leading-relaxed text-[#3D3D38]">
            {result
              ? "칸을 눌러 근무를 고정하면 나머지를 최소한으로 바꿔 다시 만들어요."
              : "적용한 규칙과 요청으로 근무표를 만들어요."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!result ? (
            <button type="button" onClick={sv.run} disabled={busy || nurses.length === 0} className={ui.primary}>
              {loading && <Spinner />}
              {loading ? "만드는 중…" : "근무표 만들기"}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => downloadCsv(period, nurses, result)} disabled={busy} className={ui.text}>
                CSV 받기
              </button>
              <button type="button" onClick={sv.run} disabled={busy || nurses.length === 0} className={ui.secondary}>
                {loading && <Spinner />}
                {loading ? "만드는 중…" : "다시 만들기"}
              </button>
              <button type="button" onClick={onConfirm} disabled={busy} className={ui.primary}>
                확정
              </button>
            </>
          )}
        </div>
      </div>

      {carryOverChanged(period, periods) && (
        <div role="status" className={ui.banner}>
          지난 근무표가 바뀌어 이어지는 근무가 달라졌어요. 다시 만들면 반영돼요
          <button type="button" onClick={sv.run} disabled={busy} className={ui.textSm}>
            다시 만들기
          </button>
        </div>
      )}

      {sv.toast && <ToastAlert toast={sv.toast} busy={busy} onClose={() => sv.setToast(null)} />}

      <ScheduleBody period={period} solve={sv} busy={busy} />

      <div>
        <button type="button" onClick={() => go({ screen: "period", periodId, step: 1 })} className={ui.secondary}>
          이전
        </button>
      </div>
    </div>
  );
}

export function OutcomePanel({
  outcome,
  explaining,
  busy,
  constraints,
  nurses,
  period,
  hasResult,
  onAccept,
  onDisable,
  onToggle,
}: {
  outcome: NonNullable<Outcome>;
  explaining: boolean;
  busy: boolean;
  constraints: ConstraintSpec[];
  nurses: Nurse[];
  period: Period;
  hasResult: boolean;
  onAccept: (p: RelaxationProposal) => void;
  onDisable: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const [dismissed, setDismissed] = useState<RelaxationProposal[]>([]);
  const config = useAppStore((s) => s.ward?.config) ?? DEFAULT_CONFIG;
  const explanation = outcome.kind === "infeasible" ? outcome.explanation : null;
  // 다시 풀어 검증된 제안만 보여준다(ADR-004)
  const proposals = (explanation?.proposals ?? []).filter((p) => p.verified_summary && !dismissed.includes(p));
  const conflicts = outcome.kind === "infeasible" ? outcome.conflicts : [];
  const unknownCause = outcome.kind === "timeout" || conflicts.length === 0;
  const hardList = constraints.filter((c) => (c.hardness ?? "hard") === "hard");

  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-[#E8B4AE] bg-white px-[18px] py-4">
      <div className="flex items-center gap-2">
        <span className={`${ui.badge} bg-[#FBE9E7] text-[#9F1F14]`}>{outcome.kind === "timeout" ? "시간 초과" : "근무표 없음"}</span>
        <h2 className={ui.cardTitle}>
          {outcome.kind === "timeout" ? "시간 안에 근무표를 만들지 못했어요" : "규칙을 모두 지키는 근무표가 없어요"}
        </h2>
        {hasResult && <span className={ui.help}>아래는 마지막으로 만든 근무표예요.</span>}
      </div>

      {outcome.kind === "infeasible" &&
        (explaining && !explanation ? (
          <p className="flex items-center gap-2 text-sm text-[#66665E]">
            <Spinner />
            원인을 분석하는 중…
          </p>
        ) : (
          explanation && (
            <p className="text-sm leading-relaxed whitespace-pre-line text-[#3D3D38]">
              {explanation.text}
              {explanation.fallback && (
                <span className="text-[#66665E]"> 자동 설명을 만들지 못해 함께 지킬 수 없는 규칙만 보여 줘요.</span>
              )}
            </p>
          )
        ))}

      {proposals.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {proposals.map((p, i) => (
            <ProposalCard
              key={i}
              proposal={p}
              changes={p.changes.flatMap((ch) => {
                const c = constraints.find((x) => x.id === ch.constraint_id);
                if (!c) return [];
                if (ch.action === "disable") return [`${presetName(c)} 끄기 · “${c.source_text}”`];
                if (ch.action === "set_hardness" && ch.hardness)
                  return [`${presetName(c)} ${hardnessLabel(c.hardness ?? "hard")} → ${hardnessLabel(ch.hardness)}`];
                const v = c.type === "rule" ? c.values?.[ch.name ?? ""] : undefined;
                return v ? [`${v.label} ${v.value} → ${ch.value}`] : [];
              })}
              busy={busy}
              onAccept={() => onAccept(p)}
              onDismiss={() => setDismissed((d) => [...d, p])}
            />
          ))}
        </div>
      )}

      {!unknownCause ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-[#1B1B18]">함께 지킬 수 없는 규칙</h3>
          <ul className="flex flex-col">
            {conflicts.map((c) => {
              const found = constraints.find((x) => x.id === c.constraint_id);
              return (
                <li key={c.constraint_id} className="flex items-center justify-between gap-3 border-b border-[#EFEFEB] py-1.5 last:border-b-0">
                  <span className="flex items-baseline gap-2 text-sm text-[#1B1B18]">
                    <span className="text-xs font-medium text-[#66665E]">{found ? presetName(found) : "규칙"}</span>
                    “{c.source_text}”
                    {found && (
                      <span className="font-mono text-xs text-[#66665E]">{describeRule(found, config, nurses, period).text}</span>
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
      ) : (
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
                    <span className="font-mono text-xs text-[#66665E]">{describeRule(c, config, nurses, period).text}</span>
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
  /** 바뀌는 규칙을 블록 문장으로 */
  changes: string[];
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
      <p className="text-sm leading-relaxed text-[#3D3D38]">{proposal.description}</p>
      {changes.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-sm bg-[#F6F6F3] px-2.5 py-2 text-xs text-[#3D3D38]">
          {changes.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-[#66665E]">
        이렇게 바꾸면 근무표를 만들 수 있어요 · 희망 반영{" "}
        <span className="font-mono">
          {s.preferences_met}/{s.preferences_total}
        </span>
        {s.soft_violation_count > 0 && (
          <>
            {" "}
            · 못 지킨 규칙 <span className="font-mono">{s.soft_violation_count}</span>
          </>
        )}
      </p>
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
}: {
  result: ScheduleResult;
  infeasible: boolean;
  confirmed: boolean;
  draft: boolean;
  /** 변환 전 결과: 희망 반영·못 지킨 규칙 칸을 숨긴다 */
  legacy?: boolean;
}) {
  const { summary } = result;
  const item = "flex flex-col gap-1 border-r border-[#E2E2DC] px-5 py-3.5";
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
            <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>규칙을 모두 지켰어요</span>
          )}
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
            <span className={label}>못 지킨 규칙</span>
            <span className={`${value} text-[#A15C07]`}>{summary.soft_violation_count}</span>
          </div>
        </>
      )}
      {result.diff && (
        <div className={item}>
          <span className={label}>확정본에서 바뀐 칸</span>
          <span className={`${value} text-[#1B1B18]`}>{result.diff.length}칸</span>
        </div>
      )}
    </section>
  );
}

function CellEditor({
  codes,
  label,
  fixed,
  onPick,
  onCancel,
}: {
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
          aria-label={`${code}로 고정`}
          title={name}
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
}: {
  /** 병동 근무 형태. 합계 열과 하단 합계 행이 이 코드를 따른다 */
  config?: WardConfig;
  rows: Nurse[];
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
  /** 간호사별 최근 4주 나이트·주말. 없으면 0 */
  history?: Map<string, Load>;
  /** 운영 중 기간의 잠긴 지난 날짜 수(1..pastDays) */
  pastDays?: number;
  /** 오늘의 기간 인덱스(열 머리 밑줄) */
  todayDay?: number | null;
  /** 변환 전 결과: 못 지킨 규칙 표시를 숨긴다 */
  hideViolations?: boolean;
}) {
  const pdays = periodDays(period);
  const codes = shownCodes(config, result.assignments);
  // 하단 합계는 근무조(복합 코드는 세는 근무조마다 더한다)
  const teams = codes.filter((s) => s.code !== "O" && !s.parts?.length);
  const covers = (code: Code, team: Code) =>
    code === team || (config.shifts.find((s) => s.code === code)?.parts ?? []).includes(team);
  // 최근 4주 기록이 하나도 없으면(첫 근무표) 누적 부담 열을 그리지 않는다
  const showHistory = [...(history?.values() ?? [])].some((h) => h.nights > 0 || h.weekends > 0);
  const dayList = pdays.map((p) => p.day);
  // grid-cols-[150px_44px_repeat(N,30px)_repeat(K,34px)_repeat(2,44px)], N = 기간 길이, K = 근무 코드 수
  const grid = {
    gridTemplateColumns: `150px 44px repeat(${period.length}, 30px) repeat(${codes.length}, 34px)${showHistory ? " repeat(2, 44px)" : ""}`,
  };
  const rowClass = "grid gap-x-0.5";
  const weekendBg = (d: number) => (isWeekend(d) ? "bg-[#F1EEE6]" : "");
  const changed = new Set((result.diff ?? []).map((c) => `${c.nurse_id}-${c.day}`));
  const violations = new Map<string, string[]>();
  for (const v of hideViolations ? [] : result.soft_violations) {
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
          {pdays.map(({ day: d, weekday: w }) => {
            const color = w === 0 || holidays.includes(d) ? "text-[#B42318]" : w === 6 ? "text-[#155E75]" : "text-[#66665E]";
            return (
              <span
                key={d}
                className={`flex flex-col items-center rounded-xs py-0.5 font-mono ${weekendBg(d)} ${color} ${
                  d === todayDay ? "border-b-2 border-[#155E75]" : ""
                }`}
              >
                <span className={`${dayHeader(period, d).includes("/") ? "text-[11px]" : "text-[13px]"} font-medium`}>
                  {dayHeader(period, d)}
                </span>
                <span className="text-[11px]">{WEEKDAYS[w]}</span>
              </span>
            );
          })}
          {codes.map(({ code, name }) => (
            <span key={code} title={name} className="flex items-end justify-center font-mono text-xs font-semibold text-[#66665E]">
              {code}
            </span>
          ))}
          {/* 누적 부담(최근 4주) */}
          {showHistory && ["최근 4주 나이트", "최근 4주 주말"].map((label) => (
            <span key={label} className="flex items-end justify-center text-center text-[11px] leading-tight font-medium text-[#66665E]">
              {label}
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
                {n.tags?.length ? <span className="ml-1.5 truncate text-xs font-medium text-[#66665E]">{n.tags.join(" · ")}</span> : null}
              </span>
              <span className="flex h-7 items-center font-mono text-[13px] text-[#3D3D38]">{n.years}</span>
              {row.map((code, i) => {
                const d = i + 1;
                const { month: m, dom } = pdays[i];
                const key = `${n.id}-${d}`;
                const isSel = selected?.nurseId === n.id && selected.day === d;
                const warn = violations.get(key);
                const past = d <= pastDays;
                if (readOnly) {
                  return (
                    <div
                      key={d}
                      aria-label={`${n.name} ${m}월 ${dom}일 ${code}`}
                      title={warn ? warn.join(", ") : undefined}
                      className={`${CELL} ${codeClass(code, isWeekend(d))}`}
                    >
                      {code}
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
                    onClick={() => !past && onSelect({ nurseId: n.id, day: d })}
                    aria-label={`${n.name} ${m}월 ${dom}일 ${code}`}
                    title={past ? "지난 날짜는 바꿀 수 없어요" : warn ? warn.join(", ") : undefined}
                    className={`${CELL} ${codeClass(code, isWeekend(d))} ${
                      past ? "cursor-not-allowed" : "hover:opacity-80"
                    } disabled:cursor-wait ${
                      changed.has(key) ? "shadow-[inset_0_0_0_2px_#D97706]" : ""
                    } ${isSel ? "outline-2 outline-offset-1 outline-[#155E75]" : ""}`}
                  >
                    {code}
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
                  <span className={total}>{history?.get(n.id)?.nights ?? 0}</span>
                  <span className={total}>{history?.get(n.id)?.weekends ?? 0}</span>
                </>
              )}
            </div>
          );
        })}

        {teams.map(({ code }, i) => (
          <div key={code} className={`${rowClass} ${i === 0 ? "mt-1.5 border-t border-[#EFEFEB] pt-1.5" : ""}`} style={grid}>
            <span className="flex h-7 items-center text-xs font-medium text-[#66665E]">{code} 합계</span>
            <span />
            {dayList.map((d) => (
              <span key={d} className={`${total} rounded-xs ${weekendBg(d)}`}>
                {rows.filter((n) => covers(result.assignments[n.id][d - 1], code)).length}
              </span>
            ))}
          </div>
        ))}
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
  config: WardConfig;
  rows: Nurse[];
  result: ScheduleResult;
  history: Map<string, Load>;
  /** 변환 전 결과: 희망 반영률 열을 숨긴다 */
  legacy?: boolean;
}) {
  const codes = shownCodes(config, result.assignments);
  const thBase = "px-3 py-2 text-xs font-medium whitespace-nowrap text-[#66665E]";
  const th = `${thBase} text-right`;
  const td = "px-3 py-1.5 text-right font-mono text-[13px] font-medium text-[#1B1B18]";
  const showHistory = [...history.values()].some((h) => h.nights > 0 || h.weekends > 0);
  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <h2 className={ui.cardTitle}>개인별 통계</h2>
      <div className="overflow-x-auto">
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
                  <th className={th}>최근 4주 나이트</th>
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
                  <td className={td}>{formatDeviation(s.deviation)}</td>
                  {showHistory && (
                    <>
                      <td className={td}>{history.get(n.id)?.nights ?? 0}</td>
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
