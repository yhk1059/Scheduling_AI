"use client";

import { useEffect, useRef, useState } from "react";

import { carryOverFrom, previousConfirmedPeriod } from "@/lib/continuity";
import { dateOfDay, formatRange, isWeekendDay, MAX_MONTH_START_DAY, monthDay, periodEnd, validStart } from "@/lib/period";
import { parseCarryOver, type CellError } from "@/lib/roster-import";
import {
  carryOverChanged,
  currentPeriod,
  prepareNeedsReview,
  rosterChangesFor,
  useAppStore,
  type WorkPeriod,
} from "@/lib/store";
import { scheduleName } from "@/lib/wording";

import HolidayCalendar from "./HolidayCalendar";
import RulesStep from "./RulesStep";
import ScheduleStep, { CELL, codeClass } from "./ScheduleStep";
import Stepper from "./Stepper";
import { ui } from "./ui";

/** 근무표 작성: 제목(근무표 이름 + 날짜 범위 + 작성 중 배지) + 스테퍼 ① 요청 → ② 근무표. 확정은 ②의 끝 버튼이다. */
export default function PeriodWork() {
  const period = useAppStore(currentPeriod);
  const step = useAppStore((s) => (s.view.screen === "period" ? s.view.step : 1));
  const go = useAppStore((s) => s.go);
  const unit = useAppStore((s) => s.shop?.unit ?? "month");

  // 단계를 옮기면 새 단계 제목으로 포커스를 옮긴다(처음 열 때는 옮기지 않는다)
  const rootRef = useRef<HTMLDivElement>(null);
  const prevStep = useRef(step);
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    rootRef.current?.querySelector<HTMLElement>("[data-step-title]")?.focus();
  }, [step]);

  if (!period) return null;
  const toStep = (s: 1 | 2) => go({ screen: "period", periodId: period.id, step: s });

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
          <span className={`${ui.badge} border border-[#C9C9C1] bg-white text-[#3D3D38]`}>작성 중</span>
        </div>
        <Stepper label="근무표 작성 단계" labels={["요청", "근무표"]} current={step} reached={period.result ? 2 : step} onSelect={toStep} />
      </div>

      {step === 1 ? (
        <>
          <PrepareSummary key={`prep-${period.id}`} period={period} />
          <RulesStep key={period.id} scope="period" />
        </>
      ) : (
        <ScheduleStep key={period.id} />
      )}
    </div>
  );
}

/** ① 요청 위의 준비 요약 한 줄 + [바꾸기]. 명단이나 이어지는 근무가 바뀌었을 때만 처음부터 펼친다. */
function PrepareSummary({ period }: { period: WorkPeriod }) {
  const shop = useAppStore((s) => s.shop);
  const periods = useAppStore((s) => s.periods);
  const go = useAppStore((s) => s.go);
  const [open, setOpen] = useState(() => (shop ? prepareNeedsReview(shop, periods, period.id) : false));
  if (!shop) return null;
  const active = shop.employees.filter((n) => n.active).length;
  const prev = previousConfirmedPeriod(periods, period);
  const hasPrevious = periods.some((p) => p.status === "confirmed" && p.start_date < period.start_date);
  const { added, deactivated } = rosterChangesFor(shop, periods, period.id);
  const names = (list: { name: string }[]) => list.map((n) => n.name).join(", ");
  const carry = prev
    ? "지난 근무표에서 이어져요"
    : period.carryOver.length > 0
      ? `지난 근무 ${period.carryOver.length}명 입력`
      : "지난 근무 없음";

  return (
    <div className="flex flex-col gap-3">
      <section className={`${ui.card} flex items-center justify-between gap-3 py-2.5`}>
        <p className="text-sm text-[#3D3D38]">
          <span className="font-mono font-medium text-[#1B1B18]">{formatRange(period)}</span> ·{" "}
          {period.holidays.length > 0 ? (
            <>
              공휴일 <span className="font-mono">{period.holidays.length}</span>일
            </>
          ) : (
            "공휴일 없음"
          )}{" "}
          · 직원 <span className="font-mono">{active}</span>명 · {carry}
        </p>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={ui.textSm}>
          {open ? "접기" : "바꾸기"}
        </button>
      </section>

      {carryOverChanged(period, periods) && (
        <div role="status" className={ui.banner}>
          지난 근무표가 바뀌어 이어지는 근무가 달라졌어요. 다시 만들면 반영돼요
          <button type="button" onClick={() => go({ screen: "period", periodId: period.id, step: 2 })} className={ui.textSm}>
            근무표로
          </button>
        </div>
      )}

      {open && (
        <>
          <section className={`${ui.card} flex flex-col gap-3`}>
            <DatesSection period={period} />
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
                직원 <span className="font-mono">{active}</span>명
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
              매장 설정
            </button>
          </section>

          <CarryOverSection period={period} />
        </>
      )}
    </div>
  );
}

/**
 * 날짜: 첫 근무표는 시작일 date 입력 + 끝 날짜(읽기 전용). 다음 근무표는 읽기 전용 + [시작일 미루기](직전 끝 다음 날 이후만).
 * 미루면 지난 근무표와 이어지지 않아 지난 근무를 직접 입력한다(아래 지난 근무 칸이 붙여넣기로 바뀐다).
 */
function DatesSection({ period }: { period: WorkPeriod }) {
  const shop = useAppStore((s) => s.shop);
  const periods = useAppStore((s) => s.periods);
  const postponeStart = useAppStore((s) => s.postponeStart);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!shop) return null;
  const before = periods.filter((p) => p.id !== period.id && p.start_date < period.start_date).at(-1);
  const earliest = before ? dateOfDay(before, before.length + 1) : undefined;
  const earliestLabel = before ? monthDay(before, before.length + 1) : "";
  const broken = before !== undefined && previousConfirmedPeriod(periods, period) === null;
  const monthly = shop.unit === "month";

  const onChange = (date: string) => {
    if (!date) return;
    if (!validStart(shop.unit, date)) {
      setError(`한 달 근무표는 1~${MAX_MONTH_START_DAY}일에만 시작할 수 있어요. 다른 날을 골라 주세요.`);
      return;
    }
    if (earliest && date < earliest) {
      setError(`지난 근무표 다음 날(${earliestLabel}) 이후로 골라 주세요.`);
      return;
    }
    setError(null);
    postponeStart(period.id, date);
  };

  const input = (
    <label className="flex flex-col gap-1">
      <span className={ui.label}>시작일</span>
      <input
        type="date"
        value={period.start_date}
        min={earliest}
        aria-invalid={error !== null || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`${ui.input} w-44 font-mono ${error ? "border-[#B42318]" : ""}`}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      <h3 className={ui.cardTitle}>날짜</h3>
      {before === undefined || editing ? (
        <div className="flex items-end gap-4">
          {input}
          <div className="flex flex-col gap-1">
            <span className={ui.label}>끝 날짜</span>
            <span className="flex h-10 items-center font-mono text-sm text-[#1B1B18]">
              {periodEnd(period).replaceAll("-", ".")} · {period.length}일
            </span>
          </div>
          {editing && (
            <button type="button" onClick={() => setEditing(false)} className={ui.text}>
              닫기
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="text-sm text-[#3D3D38]">
            <span className="font-mono font-medium text-[#1B1B18]">{formatRange(period)}</span> ·{" "}
            <span className="font-mono">{period.length}</span>일
          </p>
          {period.status === "draft" && (
            <button type="button" onClick={() => setEditing(true)} className={ui.textSm}>
              시작일 미루기
            </button>
          )}
        </div>
      )}
      {error ? (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      ) : (
        before === undefined && (
          <p className={ui.help}>{monthly ? `1~${MAX_MONTH_START_DAY}일 중 아무 날에서 시작할 수 있어요.` : "아무 날에서 시작할 수 있어요."}</p>
        )
      )}
      {broken && <p className="text-sm text-[#7A4506]">지난 근무표와 이어지지 않아서 지난 근무를 직접 입력해요</p>}
    </div>
  );
}

function cellErrorText(e: CellError): string {
  const at = e.row === null ? "" : e.col === null ? `${e.row + 1}행: ` : `${e.row + 1}행 ${e.col + 1}열: `;
  return at + e.message;
}

/** 지난 근무 마지막 며칠(지난 확정본). 근무 셀 모양의 읽기 전용 표(편집하려면 지난 근무표를 고친다). */
function CarryOverTable({ period, prev }: { period: WorkPeriod; prev: WorkPeriod }) {
  const shop = useAppStore((s) => s.shop);
  const employees = shop?.employees.filter((n) => n.active) ?? [];
  const rows = carryOverFrom(prev, employees.map((n) => n.id));
  const width = Math.max(0, ...rows.map((r) => r.shifts.length));
  const days = Array.from({ length: width }, (_, i) => prev.length - width + 1 + i);
  const grid = { gridTemplateColumns: `150px repeat(${width}, 30px)` };
  const name = (id: string) => employees.find((n) => n.id === id)?.name ?? id;

  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex flex-col gap-1">
        <h3 className={ui.cardTitle}>지난 근무 마지막 며칠</h3>
        <p className={ui.help}>
          지난 근무표에서 가져왔어요. 마감 다음 날 오픈 금지 같은 규칙이 근무표 사이에서도 지켜지게 써요
          {rows.length < employees.length && ` · 지난 근무표에 없던 ${employees.length - rows.length}명은 지난 근무 없이 시작해요`}
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
            <div key={r.employee_id} className="grid gap-x-0.5" style={grid}>
              <span className="flex h-7 items-center truncate text-sm text-[#1B1B18]">{name(r.employee_id)}</span>
              {r.shifts.map((code, i) => {
                const d = prev.length - r.shifts.length + 1 + i;
                return (
                  <div
                    key={d}
                    aria-label={`${name(r.employee_id)} ${monthDay(prev, d)} ${code}`}
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
  const shop = useAppStore((s) => s.shop);
  const employees = shop?.employees.filter((n) => n.active) ?? [];
  const { carryOver } = period;
  const setCarryOver = useAppStore((s) => s.setCarryOver);

  const [open, setOpen] = useState(carryOver.length > 0);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ReturnType<typeof parseCarryOver> | null>(null);

  const onApply = () => {
    const parsed = parseCarryOver(text, employees, shop!.config);
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
          마감 다음 날 오픈 금지 같은 규칙이 근무표 사이에서도 지켜지게 써요. 지금 반영된 직원:{" "}
          <span className="font-mono">{carryOver.length}</span>명
        </p>
      </div>
      <label className="flex flex-col gap-1">
        <span className={ui.label}>
          이름, 그다음 오래된 날부터 근무 코드(
          {shop!.config.shifts
            .filter((x) => x.active !== false)
            .map((x) => x.code)
            .join("/")}
          )
        </span>
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
