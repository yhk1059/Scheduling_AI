"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { applyDrag, cellKey, cellsFromSlots, SLOT_COUNT, slotLabel, slotsFromCells } from "@/lib/availability";
import { formatRange, periodDays, type PeriodDay } from "@/lib/period";
import { getAvailability, getAvailabilityRoster, submitAvailability, type AvailabilityRoster, type EmployeeAvailability, type RosterShift } from "@/lib/supabase";

import { ui } from "./ui";
import Wordmark from "./Wordmark";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_PER_PAGE = 7;
const SLOTS = Array.from({ length: SLOT_COUNT }, (_, i) => i);
const PAGE = "mx-auto flex w-full max-w-[1360px] px-10";
const HEAD_HEIGHT = 44;
/** 머리 행 + 칸 16px × 36 + 테두리. 화면이 이보다 낮으면 칸이 14px까지 줄어든다. */
const CALENDAR_MAX_HEIGHT = HEAD_HEIGHT + 16 * SLOT_COUNT + 2;

type Load = { kind: "loading" } | { kind: "error" } | { kind: "not_found" } | { kind: "ok"; link: EmployeeAvailability };
type RosterLoad = { kind: "loading" } | { kind: "error" } | { kind: "not_found" } | { kind: "ok"; roster: AvailabilityRoster };

/** 직원 가능 시간 입력(/a/{공용 토큰}). 이름을 고른 뒤 캘린더로 간다. 로그인을 요구하지 않고 store를 쓰지 않는다. */
export default function AvailabilityForm({ token }: { token: string }) {
  const [load, setLoad] = useState<RosterLoad>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getAvailabilityRoster(token)
      .then((roster) => {
        if (live) setLoad(roster ? { kind: "ok", roster } : { kind: "not_found" });
      })
      .catch(() => {
        if (live) setLoad({ kind: "error" });
      });
    return () => {
      live = false;
    };
  }, [token, attempt]);

  const retry = () => setAttempt((n) => n + 1);
  if (picked)
    return (
      <EmployeeForm
        key={picked}
        token={picked}
        shifts={load.kind === "ok" ? load.roster.shifts : []}
        onBack={() => {
          setPicked(null);
          retry();
        }}
      />
    );
  if (load.kind === "ok") return <NamePicker roster={load.roster} onPick={setPicked} />;
  return <LoadMessage kind={load.kind} onRetry={retry} />;
}

/** 맨 위 줄: 작은 워드마크 + 화면 이름. */
function TopLine() {
  return (
    <div className="flex h-5 items-center gap-1.5">
      <Wordmark size="small" />
      <span className="text-[13px] text-[#66665E]">· 가능 시간 입력</span>
    </div>
  );
}

function LoadMessage({ kind, onRetry }: { kind: "loading" | "error" | "not_found"; onRetry: () => void }) {
  return (
    <main className={`${PAGE} flex-col gap-4 py-6`}>
      <TopLine />
      {kind === "loading" && (
        <p role="status" className="text-sm text-[#3D3D38]">
          불러오는 중…
        </p>
      )}
      {kind === "not_found" && <h1 className={ui.pageTitle}>링크를 확인해 주세요</h1>}
      {kind === "error" && (
        <div role="alert" className={ui.banner}>
          불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요
          <button type="button" onClick={onRetry} className={ui.textSm}>
            다시 시도
          </button>
        </div>
      )}
    </main>
  );
}

/** 이름 고르기. 이미 제출한 이름은 다른 사람 입력을 덮어쓰지 않게 한 번 더 묻는다. */
function NamePicker({ roster, onPick }: { roster: AvailabilityRoster; onPick: (token: string) => void }) {
  const [confirming, setConfirming] = useState<AvailabilityRoster["employees"][number] | null>(null);
  const range = { start_date: roster.period_start, length: roster.period_length };

  return (
    <main className={`${PAGE} flex-col gap-5 py-6`}>
      <TopLine />
      <header className="flex flex-col gap-1">
        <h1 className={ui.pageTitle}>{roster.shop_name} · 가능 시간 입력</h1>
        <span className="font-mono text-sm text-[#66665E]">{formatRange(range)}</span>
      </header>
      <p className="text-sm text-[#7A4506] md:hidden">PC에서 입력해 주세요. 휴대폰에서는 드래그할 수 없어요</p>
      <section className="flex flex-col gap-3">
        <h2 className={ui.sectionTitle}>내 이름을 골라 주세요</h2>
        <div className="flex flex-wrap gap-2.5">
          {roster.employees.map((e) => (
            <button
              key={e.link_token}
              type="button"
              onClick={() => (e.submitted && !roster.locked ? setConfirming(e) : onPick(e.link_token))}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-[#C9C9C1] bg-white px-[18px] text-[15px] font-medium text-[#1B1B18] transition-colors duration-[120ms] hover:bg-[#EFEFEB] active:bg-[#E2E2DC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155E75]"
            >
              {e.employee_name}{" "}
              {e.submitted && <span className={`${ui.badge} ${ui.badgeTone.confirmed}`}>제출함</span>}
            </button>
          ))}
        </div>
        {confirming && (
          <div role="alert" className={ui.banner}>
            <span className="min-w-0 flex-1">{confirming.employee_name}님은 이미 제출했어요. 본인이 맞으면 이어서 고칠 수 있어요</span>
            <button type="button" onClick={() => onPick(confirming.link_token)} className={`${ui.textSm} shrink-0 whitespace-nowrap`}>
              이어서 고치기
            </button>
            <button type="button" onClick={() => setConfirming(null)} className={`${ui.textSm} shrink-0 whitespace-nowrap`}>
              취소
            </button>
          </div>
        )}
      </section>
      <Link href="/privacy" className={`${ui.text} self-start`}>
        개인정보처리방침
      </Link>
    </main>
  );
}

/** 고른 직원의 칸을 읽어 캘린더를 보여 준다. */
function EmployeeForm({ token, shifts, onBack }: { token: string; shifts: RosterShift[]; onBack: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    getAvailability(token)
      .then((link) => {
        if (live) setLoad(link ? { kind: "ok", link } : { kind: "not_found" });
      })
      .catch(() => {
        if (live) setLoad({ kind: "error" });
      });
    return () => {
      live = false;
    };
  }, [token, attempt]);

  if (load.kind === "ok") return <Calendar token={token} link={load.link} shifts={shifts} onGone={() => setLoad({ kind: "not_found" })} onBack={onBack} />;
  return <LoadMessage kind={load.kind} onRetry={() => setAttempt((n) => n + 1)} />;
}

function Calendar({
  token,
  link,
  shifts,
  onGone,
  onBack,
}: {
  token: string;
  link: EmployeeAvailability;
  shifts: RosterShift[];
  onGone: () => void;
  onBack: () => void;
}) {
  const range = { start_date: link.period_start, length: link.period_length };
  const days = periodDays(range);
  const pages = Math.ceil(days.length / DAYS_PER_PAGE);
  const [page, setPage] = useState(0);
  const shown = days.slice(page * DAYS_PER_PAGE, (page + 1) * DAYS_PER_PAGE);

  const [cells, setCells] = useState(() => cellsFromSlots(link.slots));
  const [locked, setLocked] = useState(link.locked);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // 드래그 중: 시작할 때의 칸과 시작 칸. 지나간 범위는 언제나 base에서 다시 계산한다
  const drag = useRef<{ base: Set<string>; date: string; start: number } | null>(null);
  const [dragSpan, setDragSpan] = useState<{ date: string; start: number; end: number } | null>(null);

  useEffect(() => {
    const end = () => {
      drag.current = null;
      setDragSpan(null);
    };
    window.addEventListener("mouseup", end);
    return () => window.removeEventListener("mouseup", end);
  }, []);

  const startDrag = (date: string, slot: number) => {
    drag.current = { base: cells, date, start: slot };
    setDragSpan({ date, start: slot, end: slot });
    setCells(applyDrag(cells, date, slot, slot));
    setStatus("idle");
  };
  const moveDrag = (date: string, slot: number) => {
    const d = drag.current;
    if (d?.date !== date) return;
    setDragSpan({ date, start: d.start, end: slot });
    setCells(applyDrag(d.base, date, d.start, slot));
  };
  const toggle = (date: string, slot: number) => {
    setCells(applyDrag(cells, date, slot, slot));
    setStatus("idle");
  };

  const submit = async () => {
    setStatus("saving");
    try {
      const res = await submitAvailability(token, slotsFromCells(cells));
      if (res === "not_found") return onGone();
      if (res === "locked") {
        setLocked(true);
        setStatus("idle");
      } else {
        setStatus("saved");
      }
    } catch {
      setStatus("error");
    }
  };

  const paintedDays = new Set([...cells].map((key) => key.split("@")[0])).size;

  return (
    <div className="flex h-screen min-h-[720px] flex-col">
      <main className={`${PAGE} min-h-0 flex-1 flex-col pt-2 pb-1.5`}>
        <TopLine />
        <header className="flex items-center gap-2">
          <h1 className={`${ui.pageTitle} mr-auto truncate`}>
            {link.shop_name} · {link.employee_name}님의 가능 시간
          </h1>
          {pages > 1 && (
            <>
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={`${ui.textSm} disabled:text-[#9A9A91]`}>
                이전 주
              </button>
              <span className="font-mono text-xs text-[#66665E]">
                {page + 1}/{pages}
              </span>
              <button type="button" disabled={page === pages - 1} onClick={() => setPage((p) => p + 1)} className={`${ui.textSm} disabled:text-[#9A9A91]`}>
                다음 주
              </button>
            </>
          )}
          <button type="button" onClick={onBack} className={`${ui.textSm} shrink-0`}>
            이름 다시 고르기
          </button>
        </header>
        <p className="mb-2 text-sm leading-5 text-[#3D3D38]">
          <span className="font-mono">{formatRange(range)}</span> 근무표예요. 일할 수 있는 시간을 드래그해서 칠해 주세요. 칠한 칸에서 시작하면 지워져요.
        </p>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px] grid-rows-[minmax(0,1fr)] gap-5">
          <div
            className="grid select-none self-start overflow-hidden rounded-lg border border-[#E2E2DC] bg-white"
            style={{
              height: `min(100%, ${CALENDAR_MAX_HEIGHT}px)`,
              gridTemplateColumns: `56px repeat(${shown.length}, minmax(0, 1fr))`,
              gridTemplateRows: `${HEAD_HEIGHT}px repeat(${SLOT_COUNT}, minmax(14px, 1fr))`,
            }}
          >
            <span />
            {shown.map((d) => (
              <DayHeader key={d.date} day={d} />
            ))}
            {SLOTS.filter((slot) => slot % 2 === 0).map((slot) => (
              <span
                key={slot}
                className="border-t border-t-[#E2E2DC] pt-0.5 pr-2 text-right font-mono text-[11px] leading-none text-[#66665E]"
                style={{ gridColumn: 1, gridRow: `${slot + 2} / span 2` }}
              >
                {slotLabel(slot)[0]}
              </span>
            ))}
            {shown.map((d, col) =>
              SLOTS.map((slot) => {
                const [from, to] = slotLabel(slot);
                const on = cells.has(cellKey(d.date, slot));
                return (
                  <button
                    key={slot}
                    type="button"
                    aria-pressed={on}
                    aria-disabled={locked || undefined}
                    aria-label={`${d.month}월 ${d.dom}일 ${from}~${to}`}
                    style={{ gridColumn: col + 2, gridRow: slot + 2 }}
                    onMouseDown={(e) => {
                      if (locked || e.button !== 0) return;
                      e.preventDefault();
                      startDrag(d.date, slot);
                    }}
                    onMouseEnter={() => {
                      if (!locked) moveDrag(d.date, slot);
                    }}
                    onClick={(e) => {
                      // 마우스는 mousedown에서 처리했다. detail 0은 키보드(Space·Enter)다
                      if (!locked && e.detail === 0) toggle(d.date, slot);
                    }}
                    className={`min-h-0 border-l border-[#E2E2DC] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#155E75] ${
                      slot % 2 === 0 ? "border-t border-t-[#E2E2DC]" : "border-t border-t-[#EFEFEB]"
                    } ${on ? "bg-[#155E75]" : isWeekend(d) ? "bg-[#F6F4EE]" : "bg-white"} ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
                  />
                );
              }),
            )}
            {dragSpan && shown.some((d) => d.date === dragSpan.date) && (
              <span
                aria-hidden="true"
                className={`pointer-events-none z-10 ${ui.shadow}`}
                style={{
                  gridColumn: shown.findIndex((d) => d.date === dragSpan.date) + 2,
                  gridRow: `${Math.min(dragSpan.start, dragSpan.end) + 2} / ${Math.max(dragSpan.start, dragSpan.end) + 3}`,
                }}
              />
            )}
          </div>

          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <PaintedSummary days={shown} cells={cells} />
            {shifts.length > 0 && <ShiftsCard shifts={shifts} />}
            <div className="flex flex-col gap-1 px-1 text-xs font-medium text-[#66665E]">
              <p>제출한 뒤에도 이 링크로 다시 고칠 수 있어요.</p>
              <p>근무표가 확정되면 잠겨요.</p>
            </div>
          </aside>
        </div>
      </main>

      <footer className="sticky bottom-0 h-[72px] shrink-0 border-t border-[#E2E2DC] bg-white">
        <div className="mx-auto flex h-full w-full max-w-[1360px] items-center justify-end gap-3 px-10">
          <Link href="/privacy" className={`${ui.text} mr-auto`}>
            개인정보처리방침
          </Link>
          {locked ? (
            <p className="text-sm text-[#3D3D38]">이미 확정된 근무표예요</p>
          ) : (
            <>
              {status === "saved" && (
                <p role="status" className="text-sm text-[#1E6B3F]">
                  제출했어요. 이 링크로 다시 고칠 수 있어요
                </p>
              )}
              {status === "error" && (
                <p role="alert" className={ui.error}>
                  제출하지 못했어요. 네트워크를 확인하고 다시 눌러 주세요
                </p>
              )}
              <p className="text-sm text-[#3D3D38]">
                <span className="font-mono">{paintedDays}</span>일 · <span className="font-mono">{cells.size / 2}</span>시간 칠했어요
              </p>
              <button type="button" onClick={() => void submit()} disabled={status === "saving"} className={ui.primaryXl}>
                {status === "saving" ? "저장 중…" : "제출"}
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

/** 지금 보이는 주에 칠한 시간. 이어진 칸은 구간 하나로 보여 준다. */
function PaintedSummary({ days, cells }: { days: PeriodDay[]; cells: Set<string> }) {
  const slots = slotsFromCells(cells);
  const hours = days.reduce((sum, d) => sum + (slots[d.date] ?? []).reduce((n, [from, to]) => n + hoursBetween(from, to), 0), 0);
  return (
    <section className={`${ui.card} flex flex-col gap-2`}>
      <h2 className={ui.cardTitle}>이번 주 칠한 시간</h2>
      <ul className="flex flex-col gap-1 text-[13px] text-[#3D3D38]">
        {days.map((d) => {
          const ranges = slots[d.date];
          return (
            <li key={d.date} className="flex gap-1.5">
              <span className="shrink-0">
                {WEEKDAYS[d.weekday]}{" "}
                <span className="font-mono">
                  {d.month}/{d.dom}
                </span>{" "}
                ·
              </span>
              {ranges ? (
                <span className="font-mono">{ranges.map(([from, to]) => `${from}~${to}`).join(", ")}</span>
              ) : (
                <span className="text-[#66665E]">없음</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-[#EFEFEB] pt-2 text-[13px] font-medium text-[#1B1B18]">
        합계 <span className="font-mono">{hours}</span>시간
      </p>
    </section>
  );
}

/** 매장 근무조(UI_GUIDE 직원 가능 시간 입력): 코드·이름·시각. 어느 근무에 들어가려면 그 시간을 다 칠해야 한다는 안내. */
function ShiftsCard({ shifts }: { shifts: RosterShift[] }) {
  return (
    <section className={`${ui.card} flex flex-col gap-2`}>
      <h2 className={ui.cardTitle}>매장 근무조</h2>
      <ul className="flex flex-col gap-1 text-[13px] text-[#3D3D38]">
        {shifts.map((s) => (
          <li key={s.code} className="flex items-center gap-2">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded border border-[#C9C9C1] bg-white font-mono text-xs font-semibold text-[#1B1B18]">
              {s.code}
            </span>
            <span className="min-w-0 truncate">{s.name}</span>
            {s.start && s.end && (
              <span className="ml-auto shrink-0 font-mono text-[#66665E]">
                {s.start}~{s.end}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-[#EFEFEB] pt-2 text-xs text-[#66665E]">근무조 시간을 다 덮어야 그 근무에 들어갈 수 있어요.</p>
    </section>
  );
}

function hoursBetween(from: string, to: string): number {
  const minutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };
  return (minutes(to) - minutes(from)) / 60;
}

function isWeekend(day: PeriodDay): boolean {
  return day.weekday === 0 || day.weekday === 6;
}

function DayHeader({ day }: { day: PeriodDay }) {
  const color = day.weekday === 0 ? "text-[#B42318]" : day.weekday === 6 ? "text-[#155E75]" : "text-[#3D3D38]";
  return (
    <span className={`flex items-center justify-center gap-1 border-l border-[#E2E2DC] text-xs font-medium ${isWeekend(day) ? "bg-[#F6F4EE]" : ""} ${color}`}>
      {WEEKDAYS[day.weekday]}{" "}
      <span className="font-mono">
        {day.month}/{day.dom}
      </span>
    </span>
  );
}
