"use client";

import { useEffect, useRef, useState } from "react";

import { formatRange } from "@/lib/period";
import { parseCarryOver, type CellError } from "@/lib/roster-import";
import { currentPeriod, useAppStore, type WorkPeriod } from "@/lib/store";

import HolidayCalendar from "./HolidayCalendar";
import RulesStep from "./RulesStep";
import ScheduleStep from "./ScheduleStep";
import Stepper, { type PeriodStep } from "./Stepper";
import { ui } from "./ui";

/** 기간 작업: 제목(날짜 범위 + 상태 배지) + 스테퍼 ① 준비 → ② 요청 → ③ 근무표. */
export default function PeriodWork() {
  const period = useAppStore(currentPeriod);
  const step = useAppStore((s) => (s.view.screen === "period" ? s.view.step : 1));
  const go = useAppStore((s) => s.go);

  // 단계를 옮기면 새 단계 제목으로 포커스를 옮긴다(처음 열 때는 옮기지 않는다)
  const rootRef = useRef<HTMLDivElement>(null);
  const prevStep = useRef(step);
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    rootRef.current?.querySelector<HTMLElement>("[data-step-title]")?.focus();
  }, [step]);

  if (!period) return null;
  const toStep = (s: PeriodStep) => go({ screen: "period", periodId: period.id, step: s });

  return (
    <div ref={rootRef} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div>
          <button type="button" onClick={() => go({ screen: "home" })} className={ui.textSm}>
            ← 홈
          </button>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-[22px] font-semibold text-[#1B1B18]">{formatRange(period)}</h1>
          {period.status === "confirmed" ? (
            <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>확정</span>
          ) : (
            <span className={`${ui.badge} border border-[#C9C9C1] bg-white text-[#3D3D38]`}>초안</span>
          )}
        </div>
        <Stepper current={step} reached={period.result ? 3 : step} onSelect={toStep} />
      </div>

      {step === 1 ? (
        <PrepareStep period={period} onNext={() => toStep(2)} />
      ) : step === 2 ? (
        <RulesStep key={period.id} scope="period" />
      ) : (
        <ScheduleStep key={period.id} />
      )}
    </div>
  );
}

function PrepareStep({ period, onNext }: { period: WorkPeriod; onNext: () => void }) {
  const ward = useAppStore((s) => s.ward);
  const go = useAppStore((s) => s.go);
  if (!ward) return null;
  const active = ward.nurses.filter((n) => n.active).length;

  return (
    <div className="flex flex-col gap-5">
      <h2 tabIndex={-1} data-step-title className={`${ui.cardTitle} outline-none`}>
        준비
      </h2>

      <section className={`${ui.card} flex flex-col gap-3`}>
        <div className="flex flex-col gap-1">
          <h3 className={ui.cardTitle}>기간</h3>
          <p className="text-sm text-[#3D3D38]">
            <span className="font-mono font-medium text-[#1B1B18]">{formatRange(period)}</span> ·{" "}
            <span className="font-mono">{period.length}</span>일
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-[13px] font-semibold text-[#1B1B18]">공휴일</h3>
          <p className={ui.help}>날짜를 누르면 공휴일로 체크돼요. 주말과 같은 인원 기준을 써요.</p>
        </div>
        <HolidayCalendar period={period} />
      </section>

      <section className={`${ui.card} flex items-center justify-between gap-3`}>
        <p className="text-sm text-[#3D3D38]">
          명단 활성 <span className="font-mono">{active}</span>명
        </p>
        <button type="button" onClick={() => go({ screen: "settings", tab: "roster" })} className={ui.text}>
          병동 설정
        </button>
      </section>

      <CarryOverSection period={period} />

      <div className="flex justify-end">
        <button type="button" onClick={onNext} className={ui.primary}>
          다음
        </button>
      </div>
    </div>
  );
}

function cellErrorText(e: CellError): string {
  const at = e.row === null ? "" : e.col === null ? `${e.row + 1}행: ` : `${e.row + 1}행 ${e.col + 1}열: `;
  return at + e.message;
}

function CarryOverSection({ period }: { period: WorkPeriod }) {
  const ward = useAppStore((s) => s.ward);
  const nurses = ward?.nurses.filter((n) => n.active) ?? [];
  const { carryOver } = period;
  const setCarryOver = useAppStore((s) => s.setCarryOver);

  const [text, setText] = useState("");
  const [result, setResult] = useState<ReturnType<typeof parseCarryOver> | null>(null);

  const onApply = () => {
    const parsed = parseCarryOver(text, nurses);
    setResult(parsed);
    if (parsed.errors.length === 0) setCarryOver(period.id, parsed.rows);
  };

  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex flex-col gap-1">
        <h3 className={ui.cardTitle}>이월 근무 (선택)</h3>
        <p className={ui.help}>
          지난 기간 마지막 며칠의 근무예요. 연속 근무와 나이트 규칙을 기간 경계에서도 지키도록 써요. 지금 반영된 간호사:{" "}
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
              setCarryOver(period.id, []);
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
