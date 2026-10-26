"use client";

import { useState } from "react";

import { ApiError, errorMessage, explain, solve, translate } from "@/lib/api";
import { toScheduleCsv } from "@/lib/csv";
import { type Assignments, type Code, useAppStore } from "@/lib/store";
import type {
  Conflict,
  ConstraintSpec,
  ExplainResponse,
  Nurse,
  RelaxationProposal,
  ScheduleRequest,
  ScheduleResult,
} from "@/lib/types.gen";

import ConstraintCard, { describeParams, TEMPLATE_NAMES } from "./ConstraintCard";
import { Spinner, today } from "./RulesStep";
import { ui } from "./ui";

const CODES: Code[] = ["D", "E", "N", "O"];
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_TEXT_CHARS = 1000; // backend/domain/constants.py MAX_TEXT_CHARS

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

type Req = Omit<ScheduleRequest, "input_version">;
/** 해가 없거나 시간이 초과된 마지막 풀이. version은 그 요청의 inputVersion. */
type Outcome =
  | { kind: "infeasible"; version: number; conflicts: Conflict[]; explanation: ExplainResponse | null }
  | { kind: "timeout"; version: number }
  | null;
type Cell = { nurseId: string; day: number };
type Toast = { message: string; retry: () => void } | null;

function toMessage(e: unknown): string {
  return errorMessage(e instanceof ApiError ? e : new ApiError("INTERNAL", String(e)));
}

export default function ScheduleStep() {
  const nurses = useAppStore((s) => s.nurses);
  const period = useAppStore((s) => s.period);
  const holidays = useAppStore((s) => s.holidays);
  const constraints = useAppStore((s) => s.constraints);
  const pendingCards = useAppStore((s) => s.pendingCards);
  const result = useAppStore((s) => s.result);
  const resultVersion = useAppStore((s) => s.resultVersion);
  const inputVersion = useAppStore((s) => s.inputVersion);
  const confirmed = useAppStore((s) => s.confirmed);
  const setResult = useAppStore((s) => s.setResult);
  const setFixed = useAppStore((s) => s.setFixed);
  const clearFixed = useAppStore((s) => s.clearFixed);
  const setEnabled = useAppStore((s) => s.setEnabled);
  const applyChanges = useAppStore((s) => s.applyChanges);
  const addPendingCards = useAppStore((s) => s.addPendingCards);
  const confirm = useAppStore((s) => s.confirm);
  const setStep = useAppStore((s) => s.setStep);

  const [loading, setLoading] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
  // 월중 변경 입력 바에서 만든 대기 카드
  const [changeIds, setChangeIds] = useState<string[]>([]);
  const busy = loading || explaining || translating;

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

  const run = async (previous: Assignments | null) => {
    setLoading(true);
    setToast(null);
    const s = useAppStore.getState();
    const req: Req = {
      nurses: s.nurses as ScheduleRequest["nurses"],
      period: s.period,
      holidays: s.holidays,
      constraints: s.constraints,
      carry_over: s.carryOver,
      ...(previous && { previous }),
    };
    try {
      const res = await solve(req);
      // 풀이 중 입력이 바뀌면 버린다(남은 결과에는 stale 배지가 뜬다)
      if (res.input_version !== useAppStore.getState().inputVersion) return;
      if (res.status === "ok") {
        setResult(res.result);
        setOutcome(null);
      } else if (res.status === "timeout") {
        setOutcome({ kind: "timeout", version: res.input_version });
      } else {
        setOutcome({ kind: "infeasible", version: res.input_version, conflicts: res.conflicts, explanation: null });
        setLoading(false);
        await runExplain(req, res.conflicts, res.input_version);
      }
    } catch (e) {
      setToast({ message: toMessage(e), retry: () => void run(previous) });
    } finally {
      setLoading(false);
    }
  };

  // 확정본이 있으면 모든 재풀이를 확정본에서 최소 변경으로 한다
  const regenerate = () => void run(useAppStore.getState().confirmed);

  const translateChange = async (input: string): Promise<string | null> => {
    setTranslating(true);
    setToast(null);
    try {
      const res = await translate({ text: input, scope: "month", context: { nurses, period, holidays, today: today() } });
      if (res.status === "ok") {
        addPendingCards(res.constraints);
        setChangeIds((ids) => [...ids, ...res.constraints.map((c) => c.id)]);
        return null;
      }
      return res.status === "clarify" ? res.question : `아직 지원하지 않는 요청이에요: ${res.reason}`;
    } catch (e) {
      setToast({ message: toMessage(e), retry: () => void translateChange(input) });
      return null;
    } finally {
      setTranslating(false);
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
    void run(confirmed ?? result?.assignments ?? null);
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
  const isDraft = result !== null && confirmed !== null && !isConfirmed;
  const rows = result ? nurses.filter((n) => result.assignments[n.id]) : [];
  const shownVersion = outcome ? outcome.version : resultVersion;
  const stale = !busy && shownVersion !== null && shownVersion !== inputVersion;
  const changeCards = pendingCards.filter((c) => changeIds.includes(c.id));
  const diff = isDraft ? (result.diff ?? []) : [];

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
              <button type="button" onClick={confirm} disabled={busy || isConfirmed} className={ui.secondary}>
                {isConfirmed ? "확정됨" : "확정"}
              </button>
              <button type="button" onClick={download} disabled={busy} className={ui.secondary}>
                CSV 다운로드
              </button>
            </>
          )}
          <button type="button" onClick={regenerate} disabled={busy || nurses.length === 0} className={ui.primary}>
            {loading && <Spinner />}
            {loading ? "푸는 중…" : "생성"}
          </button>
        </div>
      </div>

      {confirmed && <ChangeBar busy={busy} translating={translating} onSubmit={translateChange} />}
      {changeCards.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {changeCards.map((c) => (
            <ConstraintCard key={c.id} card={c} pending busy={busy} onApplied={regenerate} />
          ))}
        </div>
      )}

      {stale && (
        <div
          role="status"
          className="flex items-center justify-between rounded-lg border border-[#F1D3A8] bg-[#FDF0DC] py-1.5 pr-2 pl-4 text-sm text-[#7A4506]"
        >
          <span className={`${ui.badge} bg-white text-[#7A4506]`}>입력이 바뀌었어요. 다시 생성하세요</span>
          <button type="button" onClick={regenerate} disabled={busy} className={ui.secondarySm}>
            다시 생성
          </button>
        </div>
      )}

      {outcome && (
        <OutcomePanel
          outcome={outcome}
          explaining={explaining}
          busy={busy}
          constraints={constraints}
          nurses={nurses}
          period={period}
          hasResult={result !== null}
          onAccept={(p) => {
            applyChanges(p.changes);
            regenerate();
          }}
          onDisable={(id) => {
            setEnabled(id, false);
            regenerate();
          }}
          onToggle={(id, enabled) => setEnabled(id, enabled)}
        />
      )}

      {diff.length > 0 && (
        <p role="status" className="rounded-lg border border-[#F1D3A8] bg-[#FDF0DC] px-4 py-2.5 text-sm text-[#7A4506]">
          확정본 대비 <span className="font-mono font-semibold">{new Set(diff.map((c) => c.nurse_id)).size}</span>명,{" "}
          <span className="font-mono font-semibold">{diff.length}</span>칸 변경 · 주황 테두리 칸이 바뀐 곳이에요. [확정]하면
          확정본을 교체해요.
        </p>
      )}

      {result ? (
        <>
          <SummaryCard result={result} infeasible={outcome !== null} confirmed={isConfirmed} draft={isDraft} />
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
              disabled={busy}
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

      {toast && (
        <div
          role="alert"
          className="fixed right-8 bottom-6 flex items-center gap-3 rounded-lg border border-[#E8B4AE] bg-white py-2 pr-2 pl-4 text-sm text-[#9F1F14]"
        >
          {toast.message}
          <button type="button" onClick={toast.retry} disabled={busy} className={ui.textSm}>
            다시 시도
          </button>
          <button type="button" onClick={() => setToast(null)} aria-label="닫기" className={ui.textSm}>
            <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="m3 3 6 6M9 3 3 9" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function ChangeBar({
  busy,
  translating,
  onSubmit,
}: {
  busy: boolean;
  translating: boolean;
  onSubmit: (text: string) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const tooLong = text.length > MAX_TEXT_CHARS;

  const submit = async () => {
    setNotice(null);
    const input = text.trim();
    const question = await onSubmit(input);
    if (question) setNotice(question);
    else setText((t) => (t.trim() === input ? "" : t));
  };

  return (
    <section className={`${ui.card} flex flex-col gap-2.5`}>
      <div className="flex flex-col gap-1">
        <h2 className={ui.cardTitle}>월중 변경</h2>
        <p className={ui.help}>확정본 이후 생긴 병가·휴가를 적으면, 확정본에서 최소한으로 바꾼 초안을 만들어요.</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !tooLong && text.trim() !== "") void submit();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="예: 최지훈 이번 주 병가"
          aria-label="월중 변경 입력"
          aria-invalid={tooLong || undefined}
          className={`${ui.input} flex-1 ${tooLong ? "border-[#B42318]" : ""}`}
        />
        <button type="submit" disabled={busy || tooLong || text.trim() === ""} className={ui.primary}>
          {translating && <Spinner />}
          {translating ? "해석 중…" : "해석"}
        </button>
      </form>
      {notice && (
        <p className="text-sm text-[#1B1B18]">
          {notice} <span className="text-xs font-medium text-[#66665E]">내용을 보완해서 다시 입력해 주세요.</span>
        </p>
      )}
    </section>
  );
}

function OutcomePanel({
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
  period: { year: number; month: number };
  hasResult: boolean;
  onAccept: (p: RelaxationProposal) => void;
  onDisable: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const [dismissed, setDismissed] = useState<RelaxationProposal[]>([]);
  const explanation = outcome.kind === "infeasible" ? outcome.explanation : null;
  // 재풀이로 검증된 제안만 보여준다(ADR-004)
  const proposals = (explanation?.proposals ?? []).filter((p) => p.verified_summary && !dismissed.includes(p));
  const conflicts = outcome.kind === "infeasible" ? outcome.conflicts : [];
  const unknownCause = outcome.kind === "timeout" || conflicts.length === 0;
  const hardList = constraints.filter((c) => (c.hardness ?? "hard") === "hard");

  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-[#E8B4AE] bg-white px-[18px] py-4">
      <div className="flex items-center gap-2">
        <span className={`${ui.badge} bg-[#FBE9E7] text-[#9F1F14]`}>{outcome.kind === "timeout" ? "시간 초과" : "해 없음"}</span>
        <h2 className={ui.cardTitle}>
          {outcome.kind === "timeout" ? "시간 안에 풀지 못했어요" : "지금 규칙으로는 근무표를 만들 수 없어요"}
        </h2>
        {hasResult && <span className={ui.help}>아래는 마지막으로 풀린 근무표예요.</span>}
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
                <span className="text-[#66665E]"> 자동 설명을 만들지 못해 충돌 규칙만 표시합니다.</span>
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
              busy={busy}
              onAccept={() => onAccept(p)}
              onDismiss={() => setDismissed((d) => [...d, p])}
            />
          ))}
        </div>
      )}

      {!unknownCause ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-[#1B1B18]">충돌하는 규칙</h3>
          <ul className="flex flex-col">
            {conflicts.map((c) => {
              const found = constraints.find((x) => x.id === c.constraint_id);
              return (
                <li key={c.constraint_id} className="flex items-center justify-between gap-3 border-b border-[#EFEFEB] py-1.5 last:border-b-0">
                  <span className="flex items-baseline gap-2 text-sm text-[#1B1B18]">
                    <span className="text-xs font-medium text-[#66665E]">
                      {TEMPLATE_NAMES[c.type as ConstraintSpec["type"]] ?? c.type}
                    </span>
                    “{c.source_text}”
                    {found && (
                      <span className="font-mono text-xs text-[#66665E]">{describeParams(found, nurses, period)}</span>
                    )}
                  </span>
                  {found && (
                    <button type="button" disabled={busy} onClick={() => onDisable(c.constraint_id)} className={ui.secondarySm}>
                      이번 달만 끄기
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
              ? "hard 규칙을 하나씩 꺼서 확인해 주세요."
              : "원인을 특정하지 못했어요. 규칙을 하나씩 꺼서 확인해 주세요."}
            <span className={ui.help}> 끄거나 켠 뒤 [다시 생성]을 눌러 주세요.</span>
          </p>
          <ul className="flex flex-col">
            {hardList.map((c) => {
              const on = c.enabled !== false;
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 border-b border-[#EFEFEB] py-1.5 last:border-b-0">
                  <span className={`flex items-baseline gap-2 text-sm ${on ? "text-[#1B1B18]" : "text-[#9A9A91]"}`}>
                    <span className="text-xs font-medium text-[#66665E]">{TEMPLATE_NAMES[c.type]}</span>“{c.source_text}”
                    <span className="font-mono text-xs text-[#66665E]">{describeParams(c, nurses, period)}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={!on}
                    onClick={() => onToggle(c.id, !on)}
                    className={ui.secondarySm}
                  >
                    {on ? "이번 달만 끄기" : "다시 켜기"}
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
  busy,
  onAccept,
  onDismiss,
}: {
  proposal: RelaxationProposal;
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
      <p className="font-mono text-xs text-[#66665E]">
        재풀이 결과 · 해 있음 · 희망 반영 {s.preferences_met}/{s.preferences_total}
        {s.soft_violation_count > 0 && ` · soft 위반 ${s.soft_violation_count}`}
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

function SummaryCard({
  result,
  infeasible,
  confirmed,
  draft,
}: {
  result: ScheduleResult;
  infeasible: boolean;
  confirmed: boolean;
  draft: boolean;
}) {
  const { summary } = result;
  const item = "flex flex-col gap-1 border-r border-[#E2E2DC] px-5 py-3.5";
  const label = "text-xs font-medium text-[#66665E]";
  const value = "font-mono text-xl font-semibold";
  return (
    <section className="flex items-stretch rounded-lg border border-[#E2E2DC] bg-white">
      <div className={item}>
        <span className={label}>해 상태</span>
        <span className="flex h-7 items-center gap-2">
          {infeasible ? (
            <span className={`${ui.badge} bg-[#FBE9E7] text-[#9F1F14]`}>해 없음</span>
          ) : (
            <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>해 있음</span>
          )}
          {!result.optimal && <span className={`${ui.badge} bg-[#FDF0DC] text-[#7A4506]`}>최적이 아닐 수 있음</span>}
          {confirmed && <span className={`${ui.badge} bg-[#1B1B18] text-white`}>확정됨</span>}
          {draft && <span className={`${ui.badge} border border-[#C9C9C1] bg-white text-[#3D3D38]`}>초안</span>}
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

export function ScheduleGrid({
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
