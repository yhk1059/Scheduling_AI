"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { applyDrag, cellKey, cellsFromSlots, SLOT_COUNT, slotLabel, slotsFromCells } from "@/lib/availability";
import { formatRange, periodDays, type PeriodDay } from "@/lib/period";
import { getAvailability, submitAvailability, type EmployeeAvailability } from "@/lib/supabase";

import { ui } from "./ui";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_PER_PAGE = 7;
const SLOTS = Array.from({ length: SLOT_COUNT }, (_, i) => i);

type Load = { kind: "loading" } | { kind: "error" } | { kind: "not_found" } | { kind: "ok"; link: EmployeeAvailability };

/** 직원 가능 시간 입력(/a/{토큰}). 로그인을 요구하지 않고 store를 쓰지 않는다. */
export default function AvailabilityForm({ token }: { token: string }) {
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

  if (load.kind === "ok") return <Calendar token={token} link={load.link} onGone={() => setLoad({ kind: "not_found" })} />;
  return (
    <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-3 px-8 py-6">
      {load.kind === "loading" && (
        <p role="status" className="text-sm text-[#3D3D38]">
          불러오는 중…
        </p>
      )}
      {load.kind === "not_found" && <p className="text-sm text-[#1B1B18]">링크를 확인해 주세요</p>}
      {load.kind === "error" && (
        <div role="alert" className={ui.banner}>
          불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={ui.textSm}>
            다시 시도
          </button>
        </div>
      )}
    </main>
  );
}

function Calendar({ token, link, onGone }: { token: string; link: EmployeeAvailability; onGone: () => void }) {
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
