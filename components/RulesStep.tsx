"use client";

import { useState } from "react";

import { ApiError, errorMessage, translate } from "@/lib/api";
import { parseCarryOver, type CellError } from "@/lib/roster-import";
import { findReplaced, useAppStore } from "@/lib/store";

import ConstraintCard from "./ConstraintCard";
import { ui } from "./ui";

const MAX_TEXT_CHARS = 1000; // backend/domain/constants.py MAX_TEXT_CHARS

const COPY = {
  ward: {
    title: "병동 규칙",
    description: "매달 똑같이 지키는 규칙을 말로 적어 주세요. 해석한 결과를 확인하고 [적용]해야 반영돼요.",
    placeholder: "예: 나이트 다음 날은 무조건 쉬게",
    empty: "아직 규칙이 없어요.",
  },
  month: {
    title: "이달 요청",
    description: "이번 달 휴가, 고정 근무, 희망·기피 근무를 말로 적어 주세요.",
    placeholder: "예: 이영희 15~17일 휴가",
    empty: "아직 요청이 없어요.",
  },
} as const;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Notice = { kind: "clarify" | "unsupported"; text: string } | null;

export default function RulesStep({ scope }: { scope: "ward" | "month" }) {
  const copy = COPY[scope];
  const nurses = useAppStore((s) => s.nurses);
  const period = useAppStore((s) => s.period);
  const holidays = useAppStore((s) => s.holidays);
  const constraints = useAppStore((s) => s.constraints);
  const pendingCards = useAppStore((s) => s.pendingCards);
  const addPendingCards = useAppStore((s) => s.addPendingCards);
  const setStep = useAppStore((s) => s.setStep);
  const orphanCount = useAppStore((s) => s.orphanConstraintIds().length);

  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [toast, setToast] = useState<{ message: string; text: string } | null>(null);
  const [blocked, setBlocked] = useState(false);

  const pending = pendingCards.filter((c) => c.scope === scope);
  // 필요 인원 폼이 만든 제약(cov-*)은 ① 화면에서 다룬다
  const applied = constraints.filter((c) => c.scope === scope && !c.id.startsWith("cov-"));
  const tooLong = text.length > MAX_TEXT_CHARS;

  const run = async (input: string) => {
    setLoading(true);
    setNotice(null);
    setToast(null);
    try {
      const res = await translate({ text: input, scope, context: { nurses, period, holidays, today: today() } });
      if (res.status === "ok") {
        addPendingCards(res.constraints);
        setText("");
      } else if (res.status === "clarify") {
        setNotice({ kind: "clarify", text: res.question });
      } else {
        setNotice({ kind: "unsupported", text: `아직 지원하지 않는 규칙이에요: ${res.reason}` });
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("INTERNAL", String(e));
      setToast({ message: errorMessage(err), text: input });
    } finally {
      setLoading(false);
    }
  };

  const onNext = () => {
    if (scope === "ward") {
      setStep(3);
    } else if (orphanCount > 0) {
      setBlocked(true);
    } else {
      setStep(4);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">{copy.title}</h1>
        <p className="text-sm leading-relaxed text-[#3D3D38]">{copy.description}</p>
      </div>

      <section className={`${ui.card} flex flex-col gap-2.5`}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!loading && !tooLong && text.trim() !== "") void run(text.trim());
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={copy.placeholder}
            aria-label={`${copy.title} 입력`}
            aria-invalid={tooLong || undefined}
            className={`${ui.input} flex-1 ${tooLong ? "border-[#B42318]" : ""}`}
          />
          <button type="submit" disabled={loading || tooLong || text.trim() === ""} className={ui.primary}>
            {loading && <Spinner />}
            {loading ? "해석 중…" : "해석"}
          </button>
        </form>
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm">
            {notice?.kind === "clarify" && (
              <p className="text-[#1B1B18]">
                {notice.text} <span className="text-xs font-medium text-[#66665E]">내용을 보완해서 다시 입력해 주세요.</span>
              </p>
            )}
            {notice?.kind === "unsupported" && <p className="text-[#7A4506]">{notice.text}</p>}
          </div>
          <span className={`shrink-0 font-mono text-xs ${tooLong ? "text-[#B42318]" : "text-[#9A9A91]"}`}>
            {text.length}/{MAX_TEXT_CHARS}
          </span>
        </div>
      </section>

      {pending.length + applied.length === 0 ? (
        <p className="text-sm text-[#66665E]">{copy.empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {pending.map((c) => (
            <ConstraintCard key={c.id} card={c} pending replaces={findReplaced(constraints, c)} />
          ))}
          {applied.map((c) => (
            <ConstraintCard key={c.id} card={c} pending={false} />
          ))}
        </div>
      )}

      {scope === "month" && <CarryOverSection />}

      <div className="flex items-center justify-between gap-4">
        <button type="button" onClick={() => setStep(scope === "ward" ? 1 : 2)} className={ui.secondary}>
          이전
        </button>
        <div className="flex items-center gap-3">
          {scope === "month" && blocked && orphanCount > 0 && (
            <p role="alert" className={ui.error}>
              명단에 없는 간호사를 가리키는 규칙·요청 {orphanCount}개를 삭제하거나 고친 뒤 넘어갈 수 있어요.
            </p>
          )}
          {pending.length > 0 && (
            <p className={ui.help}>적용하지 않은 카드 {pending.length}개는 근무표에 반영되지 않아요.</p>
          )}
          <button type="button" onClick={onNext} className={ui.primary}>
            다음
          </button>
        </div>
      </div>

      {toast && (
        <div
          role="alert"
          className="fixed right-8 bottom-6 flex items-center gap-3 rounded-lg border border-[#E8B4AE] bg-white py-2 pr-2 pl-4 text-sm text-[#9F1F14]"
        >
          {toast.message}
          <button type="button" onClick={() => void run(toast.text)} className={ui.textSm}>
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

export function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M7 1.5A5.5 5.5 0 1 1 1.5 7" strokeLinecap="round" />
    </svg>
  );
}

function cellErrorText(e: CellError): string {
  const at = e.row === null ? "" : e.col === null ? `${e.row + 1}행: ` : `${e.row + 1}행 ${e.col + 1}열: `;
  return at + e.message;
}

function CarryOverSection() {
  const nurses = useAppStore((s) => s.nurses);
  const carryOver = useAppStore((s) => s.carryOver);
  const setCarryOver = useAppStore((s) => s.setCarryOver);

  const [text, setText] = useState("");
  const [result, setResult] = useState<ReturnType<typeof parseCarryOver> | null>(null);

  const onApply = () => {
    const parsed = parseCarryOver(text, nurses);
    setResult(parsed);
    if (parsed.errors.length === 0) setCarryOver(parsed.rows);
  };

  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex flex-col gap-1">
        <h2 className={ui.cardTitle}>전월 마지막 주 근무 (선택)</h2>
        <p className={ui.help}>
          연속 근무와 나이트 규칙을 달 경계에서도 지키도록 씁니다. 지금 반영된 간호사:{" "}
          <span className="font-mono">{carryOver.length}</span>명
        </p>
      </div>
      <label className="flex flex-col gap-1">
        <span className={ui.label}>이름, 그다음 오래된 날부터 근무 코드(D/E/N/O)</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={"이영희\tD\tD\tE\tE\tN\tN\tO"}
          className={`${ui.input} h-auto py-2 font-mono`}
        />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={text.trim() === ""} onClick={onApply} className={ui.secondary}>
          반영
        </button>
        {carryOver.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setCarryOver([]);
              setResult(null);
            }}
            className={ui.text}
          >
            비우기
          </button>
        )}
      </div>
      {result && (
        <ul className="flex flex-col gap-1">
          {result.errors.map((e, i) => (
            <li key={`e${i}`} className={ui.error}>
              {cellErrorText(e)}
            </li>
          ))}
          {result.warnings.map((w, i) => (
            <li key={`w${i}`} className="text-xs font-medium text-[#A15C07]">
              {w}
            </li>
          ))}
          {result.errors.length === 0 && (
            <li className="text-xs font-medium text-[#1E6B3F]">{result.rows.length}명의 이월 근무를 반영했어요.</li>
          )}
          {result.errors.length > 0 && <li className={ui.help}>오류를 고친 뒤 다시 반영해 주세요.</li>}
        </ul>
      )}
    </section>
  );
}
