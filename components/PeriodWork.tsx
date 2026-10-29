"use client";

import { useEffect, useRef, useState } from "react";

import { carryOverFrom, isOperating, previousConfirmedPeriod } from "@/lib/continuity";
import { formatRange, isWeekendDay, monthDay } from "@/lib/period";
import { parseCarryOver, type CellError } from "@/lib/roster-import";
import { carryOverChanged, currentPeriod, rosterChangesFor, useAppStore, type WorkPeriod } from "@/lib/store";
import { scheduleName } from "@/lib/wording";

import HolidayCalendar from "./HolidayCalendar";
import RulesStep, { today } from "./RulesStep";
import ScheduleStep, { CELL, codeClass } from "./ScheduleStep";
import Stepper, { type PeriodStep } from "./Stepper";
import { ui } from "./ui";

/** 기간 작업: 제목(근무표 이름 + 날짜 범위 + 상태 배지) + 스테퍼 ① 준비 → ② 요청 → ③ 근무표. */
export default function PeriodWork() {
  const period = useAppStore(currentPeriod);
  const step = useAppStore((s) => (s.view.screen === "period" ? s.view.step : 1));
  const go = useAppStore((s) => s.go);
  const unit = useAppStore((s) => s.ward?.unit ?? "month");

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
            ← 근무표 목록
          </button>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-semibold text-[#1B1B18]">{scheduleName(period, unit)}</h1>
          <span className="font-mono text-sm text-[#66665E]">{formatRange(period)}</span>
          {period.status !== "confirmed" ? (
            <span className={`${ui.badge} border border-[#C9C9C1] bg-white text-[#3D3D38]`}>작성 중</span>
          ) : isOperating(period, today()) ? (
            <span className={`${ui.badge} bg-[#E3F0F3] text-[#155E75]`}>운영 중</span>
          ) : (
            <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>확정</span>
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
  const periods = useAppStore((s) => s.periods);
  const go = useAppStore((s) => s.go);
  if (!ward) return null;
  const active = ward.nurses.filter((n) => n.active).length;
  const hasPrevious = periods.some((p) => p.status === "confirmed" && p.start_date < period.start_date);
  const { added, deactivated } = rosterChangesFor(ward, periods, period.id);
  const names = (list: { name: string }[]) => list.map((n) => n.name).join(", ");

  return (
    <div className="flex flex-col gap-5">
      <h2 tabIndex={-1} data-step-title className={`${ui.cardTitle} outline-none`}>
        준비
      </h2>

      {carryOverChanged(period, periods) && (
        <div role="status" className={ui.banner}>
          지난 근무표가 바뀌어 이어지는 근무가 달라졌어요. 다시 만들면 반영돼요
          <button type="button" onClick={() => go({ screen: "period", periodId: period.id, step: 3 })} className={ui.textSm}>
            근무표로
          </button>
        </div>
      )}

      <section className={`${ui.card} flex flex-col gap-3`}>
        <div className="flex flex-col gap-1">
          <h3 className={ui.cardTitle}>날짜</h3>
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
        <div className="flex flex-col gap-1">
          <h3 className={ui.cardTitle}>명단 확인</h3>
          <p className="text-sm text-[#3D3D38]">
            간호사 <span className="font-mono">{active}</span>명
            {hasPrevious &&
              (added.length === 0 && deactivated.length === 0 ? (
                " · 지난 근무표와 명단이 같아요"
              ) : (
                <>
                  {" "}
                  · 지난 근무표 이후 <span className="font-mono">{added.length}</span>명 추가 ·{" "}
                  <span className="font-mono">{deactivated.length}</span>명 제외
                </>
              ))}
          </p>
          {added.length > 0 && <p className={ui.help}>추가: {names(added)}</p>}
          {deactivated.length > 0 && <p className={ui.help}>제외: {names(deactivated)}</p>}
        </div>
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

/** 지난 근무 마지막 며칠(지난 확정본). 근무 셀 모양의 읽기 전용 표(편집하려면 지난 근무표를 고친다). */
function CarryOverTable({ period, prev }: { period: WorkPeriod; prev: WorkPeriod }) {
  const ward = useAppStore((s) => s.ward);
  const nurses = ward?.nurses.filter((n) => n.active) ?? [];
  const rows = carryOverFrom(prev, nurses.map((n) => n.id));
  const width = Math.max(0, ...rows.map((r) => r.shifts.length));
  const days = Array.from({ length: width }, (_, i) => prev.length - width + 1 + i);
  const grid = { gridTemplateColumns: `150px repeat(${width}, 30px)` };
  const name = (id: string) => nurses.find((n) => n.id === id)?.name ?? id;

  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex flex-col gap-1">
        <h3 className={ui.cardTitle}>지난 근무 마지막 며칠</h3>
        <p className={ui.help}>
          지난 근무표에서 가져왔어요. 나이트 다음 휴무 같은 규칙이 근무표 사이에서도 지켜지게 써요
          {rows.length < nurses.length && ` · 지난 근무표에 없던 ${nurses.length - rows.length}명은 지난 근무 없이 시작해요`}
        </p>
      </div>
      <div className="overflow-x-auto" aria-label={`${formatRange(period)} 지난 근무 마지막 며칠`}>
        <div className="flex w-max flex-col gap-0.5">
          <div className="grid gap-x-0.5" style={grid}>
            <span className="flex items-end text-xs font-medium text-[#66665E]">이름</span>
            {days.map((d) => (
              <span key={d} className="flex justify-center font-mono text-[11px] font-medium text-[#66665E]">
                {monthDay(prev, d)}
              </span>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.nurse_id} className="grid gap-x-0.5" style={grid}>
              <span className="flex h-7 items-center truncate text-sm text-[#1B1B18]">{name(r.nurse_id)}</span>
              {r.shifts.map((code, i) => {
                const d = prev.length - r.shifts.length + 1 + i;
                return (
                  <div
                    key={d}
                    aria-label={`${name(r.nurse_id)} ${monthDay(prev, d)} ${code}`}
                    className={`${CELL} ${codeClass(code, isWeekendDay(prev, d, prev.holidays))}`}
                  >
                    {code}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CarryOverSection({ period }: { period: WorkPeriod }) {
  const periods = useAppStore((s) => s.periods);
  const prev = previousConfirmedPeriod(periods, period);
  return prev ? <CarryOverTable period={period} prev={prev} /> : <CarryOverPaste period={period} />;
}

function CarryOverPaste({ period }: { period: WorkPeriod }) {
  const ward = useAppStore((s) => s.ward);
  const nurses = ward?.nurses.filter((n) => n.active) ?? [];
  const { carryOver } = period;
  const setCarryOver = useAppStore((s) => s.setCarryOver);

  const [open, setOpen] = useState(carryOver.length > 0);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ReturnType<typeof parseCarryOver> | null>(null);

  const onApply = () => {
    const parsed = parseCarryOver(text, nurses);
    setResult(parsed);
    if (parsed.errors.length === 0) setCarryOver(period.id, parsed.rows);
  };

  if (!open) {
    return (
      <div>
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={ui.text}>
          지난 근무 입력하기 (선택)
        </button>
      </div>
    );
  }

  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex flex-col gap-1">
        <h3 className={ui.cardTitle}>지난 근무 마지막 며칠 (선택)</h3>
        <p className={ui.help}>
          나이트 다음 휴무 같은 규칙이 근무표 사이에서도 지켜지게 써요. 지금 반영된 간호사:{" "}
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
      <p className={ui.help}>
        예: <span className="font-mono">이영희 D E N O O</span> · 엑셀에서 이름과 근무 칸을 함께 복사해 붙여넣어요. 칸은 탭이나 쉼표로 나뉘어요
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={text.trim() === ""} onClick={onApply} className={ui.secondary}>
          표로 만들기
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
            <li className="text-xs font-medium text-[#1E6B3F]">{result.rows.length}명의 지난 근무를 반영했어요.</li>
          )}
          {result.errors.length > 0 && <li className={ui.help}>오류를 고친 뒤 다시 표로 만들어 주세요.</li>}
        </ul>
      )}
    </section>
  );
}
