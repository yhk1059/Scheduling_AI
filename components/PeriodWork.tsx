"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { carryOverFrom, previousConfirmedPeriod } from "@/lib/continuity";
import { effectiveCoverage } from "@/lib/coverage-conflict";
import { dateOfDay, dayHeader, formatRange, isWeekendDay, MAX_MONTH_START_DAY, monthDay, periodDays, periodEnd, validStart } from "@/lib/period";
import { availabilityFromLinks } from "@/lib/availability";
import { demoLinkRows } from "@/lib/demo";
import { parseCarryOver, type CellError } from "@/lib/roster-import";
import { availabilityShortages } from "@/lib/shortage";
import { syncAvailabilityLinks, type AvailabilityLink } from "@/lib/supabase";
import {
  carryOverChanged,
  type Code,
  coverageCodes,
  currentPeriod,
  type DayKind,
  liveShopRules,
  orphanConstraintIds,
  type PeriodStep,
  prepareNeedsReview,
  rosterChangesFor,
  tagCoverage,
  toScheduleRequest,
  useAppStore,
  type WorkPeriod,
} from "@/lib/store";
import { coverageText, presetName, scheduleName } from "@/lib/wording";

import AvailabilityOverview from "./AvailabilityOverview";
import HolidayCalendar from "./HolidayCalendar";
import RulesStep, { today } from "./RulesStep";
import ScheduleStep, { CELL, cellText, codeClass, DayHead, ShortageLines } from "./ScheduleStep";
import Stepper, { StepBar } from "./Stepper";
import ShiftTable from "./ShiftTable";
import { CoverageSection } from "./ShopSettings";
import { ui } from "./ui";

/** 근무표 작성: 제목(근무표 이름 + 날짜 범위 + 작성 중 배지) + 스테퍼 ① 가능 시간 → ② 매장 조건 → ③ 근무표. 확정은 ③의 끝 버튼이다. */
export default function PeriodWork() {
  const period = useAppStore(currentPeriod);
  const step = useAppStore((s) => (s.view.screen === "period" ? s.view.step : 1));
  const go = useAppStore((s) => s.go);
  const unit = useAppStore((s) => s.shop?.unit ?? "month");
  const shop = useAppStore((s) => s.shop);

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
  const notes = [
    `직원 ${shop?.employees.filter((n) => n.active).length ?? 0}명`,
    `켜진 규칙 ${shop ? liveShopRules(shop, period).length : 0}개`,
    period.result ? "만들었어요" : "아직 없어요",
  ];

  return (
    <div ref={rootRef} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div>
          <button type="button" onClick={() => go({ screen: "home" })} className={ui.textSm}>
            ← 근무표 목록
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className={ui.pageTitle}>{scheduleName(period, unit)}</h1>
          <span className="font-mono text-sm text-[#6B6F78]">{formatRange(period)}</span>
          <span className={`${ui.badge} ${ui.badgeTone.draft}`}>작성 중</span>
        </div>
        <Stepper label="근무표 작성 단계" labels={["가능 시간", "매장 조건", "근무표"]} notes={notes} current={step} reached={period.result ? 3 : step} onSelect={toStep} />
      </div>

      {step === 1 ? (
        <>
          <h2 tabIndex={-1} data-step-title className={`${ui.cardTitle} outline-none`}>
            가능 시간
          </h2>
          <LinksSection key={period.id} period={period} />
          <StepBar current={1} total={3} caption="가능 시간">
            <button type="button" onClick={() => toStep(2)} className={ui.primaryLg}>
              다음: 매장 조건
              <span aria-hidden="true">→</span>
            </button>
          </StepBar>
        </>
      ) : step === 2 ? (
        <ConditionsStep key={period.id} period={period} onStep={toStep} />
      ) : (
        <ScheduleStep key={period.id} />
      )}
    </div>
  );
}

/** ① 미리 경고: 지금 받은 가능 시간만으로 반드시 인원 규칙을 채울 수 없는 날. 솔버를 부르지 않는다. 미제출 직원은 언제든 나올 수 있다고 본다. */
function AvailabilityWarning({ period, rows }: { period: WorkPeriod; rows: AvailabilityLink[] }) {
  const shop = useAppStore((s) => s.shop);
  const periods = useAppStore((s) => s.periods);
  if (!shop) return null;
  const availability = availabilityFromLinks(rows);
  const req = toScheduleRequest(shop, { ...period, availability }, periods, today());
  const pending = req.employees.filter((n) => !availability[n.id]).map((n) => n.id);
  const shortages = availabilityShortages(req.constraints ?? [], req.employees, shop.config, period, req.holidays ?? [], pending);
  if (!shortages.length) return null;
  const unsubmitted = pending.length > 0;
  return (
    <section aria-label="가능 시간 미리 확인" className="flex flex-col gap-2 rounded-2xl border border-[#FECDCA] bg-white px-[18px] py-4">
      <h3 className={ui.cardTitle}>지금 받은 가능 시간으로는 사람이 모자란 날이 있어요</h3>
      <p className={ui.help}>
        이대로면 근무표를 만들 수 없어요. 그날 나올 수 있는 직원에게 다시 물어보거나, ② 매장 조건에서 필요 인원을 바꿔 주세요.
        {unsubmitted && " 아직 내지 않은 직원은 언제든 나올 수 있다고 보고 셌어요."}
      </p>
      <ShortageLines shortages={shortages} config={shop.config} employees={req.employees} period={period} />
    </section>
  );
}

/** 체험의 가능 시간 행에 붙이는 제출 시각. 화면에는 보이지 않는다. */
const DEMO_SUBMITTED_AT = "2026-11-01T00:00:00.000Z";

/** ① 공용 직원 링크 하나, 제출 현황, 직원별 가능 시간. 근무표 시작일이나 명단이 바뀌면 행을 맞춘다. */
function LinksSection({ period }: { period: WorkPeriod }) {
  const shop = useAppStore((s) => s.shop);
  const demo = useAppStore((s) => s.demo);
  const shopName = shop?.name ?? "";
  const employees = (shop?.employees ?? []).filter((n) => n.active);
  const roster = JSON.stringify(employees.map(({ id, name }) => ({ id, name })));
  const { start_date: start, length } = period;
  const [links, setLinks] = useState<{ key: string; shareToken: string; rows: AvailabilityLink[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const key = `${start}|${length}|${shopName}|${roster}`;

  useEffect(() => {
    if (demo) return;
    let live = true;
    syncAvailabilityLinks({ start_date: start, length }, JSON.parse(roster), shopName)
      .then((synced) => {
        if (live) setLinks({ key, ...synced });
      })
      .catch(() => {
        if (live) setFailed(key);
      });
    return () => {
      live = false;
    };
  }, [demo, key, start, length, roster, shopName, attempt]);

  const layout = (rows: AvailabilityLink[] | null, submission: ReactNode) =>
    shop && (
      <>
        <AvailabilityOverview
          period={period}
          employees={employees}
          rows={rows}
          config={shop.config}
          preparation={<PrepareSummary period={period} />}
          submission={submission}
        />
        {rows && <AvailabilityWarning period={period} rows={rows} />}
      </>
    );

  if (demo) {
    // 체험: 링크를 만들지 않고 저장된 가능 시간으로 제출 현황과 캘린더를 그린다
    const rows = demoLinkRows(period.availability, employees, DEMO_SUBMITTED_AT);
    const absent = employees.filter((n) => !period.availability[n.id]);
    const done = employees.length - absent.length;
    return layout(
      rows,
      <section className={`${ui.card} flex flex-col gap-3`}>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className={ui.cardTitle}>직원 링크</h3>
          <p className={ui.help}>체험에서는 직원 링크를 보낼 수 없어요. 직원이 가능 시간을 모두 제출한 상태로 시작해요</p>
        </div>
        <p className="text-[13px] text-[#111214]">
          <span className="font-mono">{employees.length}</span>명 중 <span className="font-mono">{done}</span>명 제출
        </p>
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded bg-[#EDEDEA]">
          <div className="h-full bg-[#C4247C]" style={{ width: `${employees.length === 0 ? 0 : (done / employees.length) * 100}%` }} />
        </div>
        {absent.length > 0 && <p className={ui.help}>미제출: {absent.map((n) => n.name).join(", ")}</p>}
      </section>,
    );
  }

  const current = links?.key === key ? links : null;
  const url = current ? `${location.origin}/a/${current.shareToken}` : "";
  const missing = employees.filter((n) => !current?.rows.find((r) => r.employee_id === n.id)?.submitted_at);
  const submitted = employees.length - missing.length;
  const reload = () => {
    setFailed(null);
    setAttempt((n) => n + 1);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  };

  return layout(
    current?.rows ?? null,
    <section className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className={ui.cardTitle}>직원 링크</h3>
          <p className={ui.help}>단체 대화방에 이 링크 하나만 올려 주세요. 직원이 자기 이름을 골라 가능 시간을 입력해요</p>
        </div>
        {current && (
          <button type="button" onClick={() => void copy()} className={`${ui.secondarySm} shrink-0`}>
            {copied === url ? "복사했어요" : "링크 복사"}
          </button>
        )}
      </div>
      {current && (
        <>
          <p className="truncate font-mono text-[13px] text-[#4B4F57]">{url}</p>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-[#111214]">
              <span className="font-mono">{employees.length}</span>명 중 <span className="font-mono">{submitted}</span>명 제출
            </p>
            <button type="button" onClick={reload} className={ui.textSm}>
              새로고침
            </button>
          </div>
          <div aria-hidden="true" className="h-1.5 overflow-hidden rounded bg-[#EDEDEA]">
            <div className="h-full bg-[#C4247C]" style={{ width: `${employees.length === 0 ? 0 : (submitted / employees.length) * 100}%` }} />
          </div>
          {missing.length > 0 && <p className={ui.help}>미제출: {missing.map((n) => n.name).join(", ")}</p>}
        </>
      )}
      {failed === key ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-[#B42318]">
          링크를 불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요
          <button type="button" onClick={reload} className={ui.textSm}>
            다시 시도
          </button>
        </div>
      ) : (
        !current && (
          <p role="status" className={ui.help}>
            링크를 만드는 중…
          </p>
        )
      )}
      {copyFailed && (
        <p role="alert" className={ui.error}>
          복사하지 못했어요. 위의 링크를 직접 복사해 주세요
        </p>
      )}
    </section>,
  );
}

/** ② 매장 조건: 근무조·필요 인원 요약표 + 입력 바 하나 + 접힌 숫자 입력 + 규칙 카드. [다음]은 항상 누를 수 있다. */
function ConditionsStep({ period, onStep }: { period: WorkPeriod; onStep: (s: PeriodStep) => void }) {
  const shop = useAppStore((s) => s.shop);
  const [blocked, setBlocked] = useState(false);
  // 이번 근무표 예외는 평소에 접어 두고, 요청이 있으면 펼친다
  const [exceptionsOpen, setExceptionsOpen] = useState(period.requests.length + period.pendingRequests.length > 0);
  if (!shop) return null;
  const orphanCount = orphanConstraintIds(shop, null).length;
  const pending = shop.pendingRules.length + shop.pendingConfig.length;
  // 직급별 배치(홀 오픈 2명 등)도 인원을 맞추는 규칙이다
  const hasStaffing = liveShopRules(shop, period).some((r) => ["필요 인원", "파트·직급별 인원"].includes(presetName(r)));
  const exceptionCount = period.requests.length + period.pendingRequests.length;

  return (
    <>
      <RulesStep
        key="shop"
        scope="shop"
        step
        pendingNote={false}
        summary={<CoverageSummary period={period} />}
        afterInput={<CoverageSection collapsible />}
        afterList={
          <div className="flex flex-col gap-3">
            <div>
              <button type="button" aria-expanded={exceptionsOpen} onClick={() => setExceptionsOpen((o) => !o)} className={ui.textSm}>
                {exceptionsOpen
                  ? "예외 접기"
                  : exceptionCount > 0
                    ? `이번 근무표 예외 ${exceptionCount}개 보기`
                    : "+ 이번 근무표에만 적용할 예외 추가"}
              </button>
            </div>
            {exceptionsOpen && <RulesStep key="period" scope="period" />}
          </div>
        }
      />
      <StepBar current={2} total={3} caption="매장 조건">
        <div className="flex flex-wrap items-center justify-end gap-3">
          {blocked && orphanCount > 0 && (
            <p role="alert" className={ui.error}>
              명단에 없는 직원을 가리키는 규칙 {orphanCount}개를 삭제하거나 고친 뒤 넘어갈 수 있어요.
            </p>
          )}
          {!hasStaffing && <p className={ui.help}>필요 인원 없이 만들면 인원을 맞추지 않아요</p>}
          {pending > 0 && <p className={ui.help}>적용하지 않은 규칙 {pending}개는 빠져요</p>}
          <button type="button" onClick={() => onStep(1)} className={ui.secondaryLg}>
            이전
          </button>
          <button type="button" onClick={() => (orphanCount > 0 ? setBlocked(true) : onStep(3))} className={ui.primaryLg}>
            다음: 근무표
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </StepBar>
    </>
  );
}

/** ② 맨 위 근무조·필요 인원 요약표. [바꾸기]로 펼치면 근무 코드 표다. */
function CoverageSummary({ period }: { period: WorkPeriod }) {
  const shop = useAppStore((s) => s.shop);
  const [open, setOpen] = useState(false);
  if (!shop) return null;
  const rules = liveShopRules(shop, period);
  const th = "py-1.5 pr-2 sm:pr-4 text-left text-xs font-medium text-[#6B6F78]";
  const td = "py-1.5 pr-2 sm:pr-4 text-[13px] text-[#111214]";
  // 전체 필요 인원 뒤에 직급별 필요 인원("홀 2명 · 주방 2명")을 잇는다
  const need = (code: Code, kind: DayKind) =>
    [coverageText(effectiveCoverage(rules, code, kind, period, period.holidays)), ...tagCoverage(rules, code, kind).map((t) => `${t.tag} ${coverageText(t)}`)]
      .filter(Boolean)
      .join(" · ");

  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {open ? (
          <h3 className={ui.cardTitle}>근무조 바꾸기</h3>
        ) : (
        <table className="w-full border-collapse sm:w-auto">
          <thead>
            <tr className="border-b border-[#EDEDEA]">
              <th className={th}>근무조</th>
              <th className={th}>시각</th>
              <th className={th}>평일</th>
              <th className={th}>주말·공휴일</th>
            </tr>
          </thead>
          <tbody>
            {coverageCodes(shop.config).map((s) => (
              <tr key={s.code} className="border-b border-[#F5F5F4] last:border-b-0">
                <td className="py-1.5 pr-2 sm:pr-4 text-[13px] font-medium text-[#111214]">{s.name}</td>
                <td className={`${td} font-mono`}>
                  {s.start}~{s.end}
                </td>
                <td className={td}>{need(s.code, "weekday")}</td>
                <td className={td}>{need(s.code, "weekend")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={ui.textSm}>
          {open ? "접기" : "바꾸기"}
        </button>
      </div>
      {!open && <p className={ui.help}>반드시 지킬 필요 인원을 한 표로 모았어요. 특정 날짜에만 적용되는 인원은 아래 카드에서 봐요</p>}
      {open && <ShiftTable />}
    </section>
  );
}

/** ① 가능 시간 위의 준비 요약 한 줄 + [바꾸기]. 명단이나 이어지는 근무가 바뀌었을 때만 처음부터 펼친다. */
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
  const carry = prev ? "지난 근무표에서" : period.carryOver.length > 0 ? `${period.carryOver.length}명 직접 입력` : "없음";

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="준비 요약" className="flex flex-wrap items-center gap-1 self-start rounded-2xl border border-[#DCDCD8] bg-white py-1.5 pr-1.5 pl-1">
        <dl className="flex flex-wrap">
          {[
            ["날짜", formatRange(period)],
            ["공휴일", period.holidays.length > 0 ? `${period.holidays.length}일` : "없음"],
            ["직원", `${active}명`],
            ["이어받는 근무", carry],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 border-r border-[#EDEDEA] px-4 py-1">
              <dt className="text-xs text-[#6B6F78]">{k}</dt>
              <dd className="text-[15px] font-semibold text-[#111214]">{v}</dd>
            </div>
          ))}
        </dl>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${ui.secondary} ml-2 rounded-xl!`}>
          {open ? "접기" : "바꾸기"}
        </button>
      </section>

      {carryOverChanged(period, periods) && (
        <div role="status" className={ui.banner}>
          지난 근무표가 바뀌어 이어지는 근무가 달라졌어요. 다시 만들면 반영돼요
          <button type="button" onClick={() => go({ screen: "period", periodId: period.id, step: 3 })} className={ui.textSm}>
            근무표로
          </button>
        </div>
      )}

      {open && (
        <>
          <section className={`${ui.card} flex flex-col gap-3`}>
            <DatesSection period={period} />
            <div className="flex flex-col gap-1">
              <h3 className="text-[13px] font-semibold text-[#111214]">공휴일</h3>
              <p className={ui.help}>한국 공휴일은 자동으로 체크돼요. 날짜를 누르면 바꿀 수 있어요. 주말과 같은 인원 기준을 써요.</p>
            </div>
            <HolidayCalendar period={period} />
          </section>

          <section className={`${ui.card} flex items-center justify-between gap-3`}>
            <div className="flex flex-col gap-1">
              <h3 className={ui.cardTitle}>명단 확인</h3>
              <p className="text-sm text-[#4B4F57]">
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
        <div className="flex flex-wrap items-end gap-4">
          {input}
          <div className="flex flex-col gap-1">
            <span className={ui.label}>끝 날짜</span>
            <span className="flex h-10 items-center font-mono text-sm text-[#111214]">
              {periodEnd(period).split("-").map(Number).join(".")} · {period.length}일
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
          <p className="text-sm text-[#4B4F57]">
            <span className="font-mono font-medium text-[#111214]">{formatRange(period)}</span> ·{" "}
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
      {broken && <p className="text-sm text-[#B93815]">지난 근무표와 이어지지 않아서 지난 근무를 직접 입력해요</p>}
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
  const prevDays = periodDays(prev);

  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex flex-col gap-1">
        <h3 className={ui.cardTitle}>지난 근무 마지막 며칠</h3>
        <p className={ui.help}>
          지난 근무표에서 가져왔어요. ‘마감 다음 날 오픈 안 돼요’ 같은 규칙이 근무표 사이에서도 지켜지게 써요
          {rows.length < employees.length && ` · 지난 근무표에 없던 ${employees.length - rows.length}명은 지난 근무 없이 시작해요`}
        </p>
      </div>
      <div className="overflow-x-auto" aria-label={`${formatRange(period)} 지난 근무 마지막 며칠`}>
        <div className="flex w-max flex-col gap-0.5">
          <div className="grid gap-x-0.5" style={grid}>
            <span className="flex items-end text-xs font-medium text-[#6B6F78]">이름</span>
            {days.map((d, i) => (
              <DayHead
                key={d}
                label={i === 0 ? monthDay(prev, d) : dayHeader(prev, d)}
                weekday={prevDays[d - 1].weekday}
                holiday={prev.holidays.includes(d)}
                weekend={isWeekendDay(prev, d, prev.holidays)}
              />
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.employee_id} className="grid gap-x-0.5" style={grid}>
              <span className="flex h-7 items-center truncate text-sm text-[#111214]">{name(r.employee_id)}</span>
              {r.shifts.map((code, i) => {
                const d = prev.length - r.shifts.length + 1 + i;
                return (
                  <div
                    key={d}
                    aria-label={`${name(r.employee_id)} ${monthDay(prev, d)} ${code}`}
                    className={`${CELL} ${codeClass(code, shop?.config)}`}
                  >
                    {cellText(code)}
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
          ‘마감 다음 날 오픈 안 돼요’ 같은 규칙이 근무표 사이에서도 지켜지게 써요. 지금 반영된 직원:{" "}
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
          placeholder={"이영희\tA\tA\tM\tM\tC\tC\tO"}
          className={`${ui.input} h-auto py-2 font-mono`}
        />
      </label>
      <p className={ui.help}>
        예: <span className="font-mono">이영희 A M C O O</span> · 엑셀에서 이름과 근무 칸을 함께 복사해 붙여넣어요. 칸은 탭이나 쉼표로 나뉘어요
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
            <li key={`w${i}`} className="text-xs font-medium text-[#B93815]">
              {w}
            </li>
          ))}
          {result.errors.length === 0 && (
            <li className="text-xs font-medium text-[#067647]">{result.rows.length}명의 지난 근무를 반영했어요.</li>
          )}
          {result.errors.length > 0 && <li className={ui.help}>오류를 고친 뒤 다시 표로 만들어 주세요.</li>}
        </ul>
      )}
    </section>
  );
}
