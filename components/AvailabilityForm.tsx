"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { applyDrag, cellKey, cellsFromSlots, SLOT_COUNT, slotLabel, slotsFromCells } from "@/lib/availability";
import { formatRange, periodDays, type PeriodDay } from "@/lib/period";
import { getAvailability, getAvailabilityRoster, submitAvailability, type AvailabilityRoster, type EmployeeAvailability } from "@/lib/supabase";

import { ui } from "./ui";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_PER_PAGE = 7;
const SLOTS = Array.from({ length: SLOT_COUNT }, (_, i) => i);

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
        onBack={() => {
          setPicked(null);
          retry();
        }}
      />
    );
  if (load.kind === "ok") return <NamePicker roster={load.roster} onPick={setPicked} />;
  return <LoadMessage kind={load.kind} onRetry={retry} />;
}

function LoadMessage({ kind, onRetry }: { kind: "loading" | "error" | "not_found"; onRetry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-3 px-8 py-6">
      {kind === "loading" && (
        <p role="status" className="text-sm text-[#3D3D38]">
          불러오는 중…
        </p>
      )}
      {kind === "not_found" && <p className="text-sm text-[#1B1B18]">링크를 확인해 주세요</p>}
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
    <main className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-8 py-6">
      <header className="flex flex-col gap-1">
        <span className="text-sm text-[#3D3D38]">{roster.shop_name}</span>
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">가능 시간 입력</h1>
        <span className="font-mono text-sm text-[#66665E]">{formatRange(range)}</span>
      </header>
      <p className="text-sm text-[#7A4506] md:hidden">PC에서 입력해 주세요. 휴대폰에서는 드래그할 수 없어요</p>
      <section className={`${ui.card} flex flex-col gap-3`}>
        <h2 className={ui.cardTitle}>내 이름을 골라 주세요</h2>
        <div className="grid grid-cols-2 gap-2">
          {roster.employees.map((e) => (
            <button
              key={e.link_token}
              type="button"
              onClick={() => (e.submitted && !roster.locked ? setConfirming(e) : onPick(e.link_token))}
              className={`${ui.secondary} justify-between`}
            >
              <span className="truncate">{e.employee_name}</span>{" "}
              {e.submitted &&<span className="ml-2 text-xs font-normal text-[#66665E]">제출함</span>}
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
function EmployeeForm({ token, onBack }: { token: string; onBack: () => void }) {
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

  if (load.kind === "ok") return <Calendar token={token} link={load.link} onGone={() => setLoad({ kind: "not_found" })} onBack={onBack} />;
  return <LoadMessage kind={load.kind} onRetry={() => setAttempt((n) => n + 1)} />;
}

function Calendar({ token, link, onGone, onBack }: { token: string; link: EmployeeAvailability; onGone: () => void; onBack: () => void }) {
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

  useEffect(() => {
    const end = () => {
      drag.current = null;
    };
    window.addEventListener("mouseup", end);
    return () => window.removeEventListener("mouseup", end);
  }, []);

  const startDrag = (date: string, slot: number) => {
    drag.current = { base: cells, date, start: slot };
    setCells(applyDrag(cells, date, slot, slot));
    setStatus("idle");
  };
  const moveDrag = (date: string, slot: number) => {
    const d = drag.current;
    if (d?.date === date) setCells(applyDrag(d.base, date, d.start, slot));
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

  return (
    <main className="mx-auto flex h-screen w-full max-w-[1360px] flex-col gap-3 px-8 py-4">
      <header className="flex items-baseline gap-3">
        <span className="text-sm text-[#3D3D38]">{link.shop_name}</span>
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">{link.employee_name}님의 가능 시간</h1>
        <span className="font-mono text-sm text-[#66665E]">{formatRange(range)}</span>
        <button type="button" onClick={onBack} className={`${ui.textSm} ml-auto`}>
          이름 다시 고르기
        </button>
      </header>

      {pages > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={`${ui.textSm} disabled:text-[#9A9A91]`}>
            이전 주
          </button>
          <span className="font-mono text-xs text-[#66665E]">
            {page + 1}/{pages}
          </span>
          <button type="button" disabled={page === pages - 1} onClick={() => setPage((p) => p + 1)} className={`${ui.textSm} disabled:text-[#9A9A91]`}>
            다음 주
          </button>
        </div>
      )}

      <div
        className="grid min-h-0 flex-1 select-none rounded-lg border border-[#E2E2DC] bg-white p-2"
        style={{
          gridTemplateColumns: `52px repeat(${shown.length}, minmax(0, 1fr))`,
          gridTemplateRows: `auto repeat(${SLOT_COUNT}, minmax(14px, 1fr))`,
        }}
      >
        <span />
        {shown.map((d) => (
          <DayHeader key={d.date} day={d} />
        ))}
        {SLOTS.filter((slot) => slot % 2 === 0).map((slot) => (
          <span
            key={slot}
            className="pr-2 text-right font-mono text-[11px] leading-none text-[#66665E]"
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
                } ${on ? "bg-[#155E75]" : "bg-white"} ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
              />
            );
          }),
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
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
            <button type="button" onClick={() => void submit()} disabled={status === "saving"} className={ui.primary}>
              {status === "saving" ? "저장 중…" : "제출"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function DayHeader({ day }: { day: PeriodDay }) {
  const color = day.weekday === 0 ? "text-[#B42318]" : day.weekday === 6 ? "text-[#155E75]" : "text-[#3D3D38]";
  return (
    <span className={`pb-1 text-center text-xs font-medium ${color}`}>
      {WEEKDAYS[day.weekday]} <span className="font-mono">{day.dom}</span>
    </span>
  );
}
