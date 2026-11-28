"use client";

// 랜딩 첫 화면의 시퀀스(말 한 줄 → 규칙 카드 → 근무표)와 랜딩 조각. 앱의 그리드 컴포넌트를 샘플 데이터로 정적 렌더한다(조작 불가).
import { Fragment, type KeyboardEvent, type ReactNode, useRef, useState } from "react";

import { isWeekendDay } from "@/lib/period";
import demo from "@/lib/samples/demo-schedule.json";
import shop from "@/lib/samples/shop-12.json";
import type { Code } from "@/lib/store";
import type { DiffCell, Employee, ScheduleResult } from "@/lib/types.gen";
import { hardnessLabel } from "@/lib/wording";

import { CELL, codeClass, ScheduleGrid } from "./ScheduleStep";
import { ui } from "./ui";
import { Mark, QuoteGlyph } from "./Wordmark";

const TYPED = "마감 다음 날 오픈은 안 되게";
// 샘플 매장(lib/samples) 데이터: 근무표 첫 주(2026년 11월 2~8일, 월~일)의 5명.
const EMPLOYEES: Employee[] = shop.employees.filter((n) => ["e01", "e05", "e06", "e07", "e08"].includes(n.id));
const ROWS: Record<string, Code[]> = Object.fromEntries(
  EMPLOYEES.map((n) => [n.id, (demo.result.assignments as Record<string, Code[]>)[n.id].slice(0, 7)]),
);
const RESULT: ScheduleResult = {
  assignments: ROWS,
  summary: { preferences_total: 0, preferences_met: 0, soft_violation_count: 0 },
  stats: {},
  soft_violations: [],
  diff: null,
  optimal: true,
};
const PERIOD = { start_date: "2026-11-02", length: 7 };
const isWeekend = (d: number) => isWeekendDay(PERIOD, d, []);
const NO_FIXED = new Map<string, Code>();

// 칸이 행마다 왼쪽부터 채워진다: 2.6s부터 행 0.42s, 칸 0.06s 간격
const cellDelay = (employeeId: string, day: number) => ({
  animationDelay: `${2.6 + EMPLOYEES.findIndex((n) => n.id === employeeId) * 0.42 + (day - 1) * 0.06}s`,
});

/** 답장 모양의 정적 규칙 카드(랜딩, UI_GUIDE "규칙·요청 카드"의 작은 자리 크기). */
export function ReplyCard({
  title,
  quote,
  reading,
  hardness = "hard",
  pending = false,
  className = "",
}: {
  title: string;
  quote: string;
  reading: ReactNode;
  hardness?: "hard" | "soft";
  /** [적용]을 누르기 전 모양(버튼 줄). 기본은 적용된 뒤의 배지. */
  pending?: boolean;
  className?: string;
}) {
  return (
    <article className={`flex flex-col gap-2.5 rounded-lg border border-[#EDEDEA] bg-white px-4 py-3.5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#111214]">{title}</h3>
        <span className={`${ui.badge} ${hardness === "hard" ? "bg-[#111214] text-white" : "border border-[#DCDCD8] bg-white text-[#4B4F57]"}`}>
          {hardnessLabel(hardness)}
        </span>
      </div>
      <p className="flex items-start gap-1.5 text-sm text-[#111214]">
        <QuoteGlyph size={16} />
        {quote}
      </p>
      <div className="ml-2 flex flex-col gap-1 border-l-2 border-[#EDEDEA] pl-3.5">
        <span className="font-mono text-[11px] text-[#C4247C]">이렇게 읽었어요</span>
        <span className="text-sm text-[#111214]">{reading}</span>
      </div>
      {pending ? (
        <div className="flex justify-end gap-1">
          <span className={ui.textSm}>다시 말하기</span>
          <span className={ui.primarySm}>적용</span>
        </div>
      ) : (
        <div>
          <span className={`${ui.badge} ${ui.badgeTone.applied}`}>적용됨</span>
        </div>
      )}
    </article>
  );
}

// 히어로 근무표의 한 주(11/2 월 ~ 11/8 일). 조각 그리드의 열 머리.
const WEEK_DAYS = [
  { date: "11/2", dow: "월" },
  { date: "3", dow: "화" },
  { date: "4", dow: "수" },
  { date: "5", dow: "목" },
  { date: "6", dow: "금" },
  { date: "7", dow: "토", weekend: true },
  { date: "8", dow: "일", weekend: true },
];
type MiniCell = { code: Code; changed?: boolean };

/** 랜딩 조각용 작은 근무표(이름 + 날짜 칸). 앱 그리드는 518px라 세 칼럼 안에 들어가지 않는다. */
function MiniGrid({ days, rows, totals }: { days: typeof WEEK_DAYS; rows: { name: string; cells: MiniCell[] }[]; totals?: { label: string; values: number[] } }) {
  const dayColor = (d: (typeof WEEK_DAYS)[number]) => (d.dow === "일" ? "text-[#B42318]" : d.dow === "토" ? "text-[#C4247C]" : "text-[#6B6F78]");
  return (
    <div className="flex w-max flex-col gap-0.5">
      <div className="flex items-center gap-0.5">
        <span className="w-16" />
        {days.map((d) => (
          <span key={d.date} className={`inline-flex w-[30px] flex-col items-center rounded-xs font-mono text-[11px] leading-tight ${d.weekend ? "bg-[#F5F5F4]" : ""} ${dayColor(d)}`}>
            {d.date}
            <span>{d.dow}</span>
          </span>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-0.5">
          <span className="w-16 truncate text-sm text-[#111214]">{r.name}</span>
          {r.cells.map((c, i) => (
            <span key={i} className={`${CELL} ${codeClass(c.code)} ${c.changed ? "shadow-[inset_0_0_0_2px_#FF7A1A]" : ""}`}>
              {c.code === "O" ? "" : c.code}
            </span>
          ))}
        </div>
      ))}
      {totals && (
        <div className="mt-1.5 flex items-center gap-0.5 border-t border-[#F5F5F4] pt-2">
          <span className="w-16 text-xs font-medium text-[#6B6F78]">{totals.label}</span>
          {totals.values.map((v, i) => (
            <span key={i} className={`flex h-7 w-[30px] items-center justify-center rounded-xs font-mono text-[13px] font-medium text-[#111214] ${days[i].weekend ? "bg-[#F5F5F4]" : ""}`}>
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const SCENE_ROWS = EMPLOYEES.map((n) => ({ name: n.name, cells: ROWS[n.id].map((code) => ({ code })) }));
const C_TOTALS = WEEK_DAYS.map((_, i) => EMPLOYEES.filter((n) => ROWS[n.id][i] === "C").length);

/** 만든 방식 장면: 히어로와 같은 샘플 근무표를 작게 멈춘 채로, 요약 줄과 [확정]과 함께. */
export function ScheduleFragment() {
  return (
    <div className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 className={`${ui.cardTitle} whitespace-nowrap`}>11/2~11/8 근무표</h3>
        <span className={`${ui.badge} ${ui.badgeTone.applied} whitespace-nowrap`}>반드시 규칙을 모두 지켰어요</span>
      </div>
      <div className="overflow-x-auto">
        <MiniGrid days={WEEK_DAYS} rows={SCENE_ROWS} totals={{ label: "C 합계", values: C_TOTALS }} />
      </div>
      <div className="flex items-center gap-4 border-t border-[#F5F5F4] pt-3">
        <span className="flex flex-col gap-0.5">
          <span className={ui.help}>희망 반영</span>
          <span className={`${ui.bigNumber} text-[#111214]`}>9/9</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className={ui.help}>못 지킨 가능하면 규칙</span>
          <span className={`${ui.bigNumber} text-[#111214]`}>0</span>
        </span>
        <span className={`${ui.primarySm} ml-auto`}>확정</span>
      </div>
    </div>
  );
}

// 지난 날짜는 잠기고, 병가가 든 칸과 대신 들어간 칸만 바뀐다. 히어로 근무표와 같은 주(11/2~).
const CHANGE_DAYS = WEEK_DAYS.slice(0, 5);
const CHANGE_ROWS: { name: string; cells: MiniCell[] }[] = [
  { name: "최지훈", cells: [{ code: "M" }, { code: "A" }, { code: "O", changed: true }, { code: "O", changed: true }, { code: "O", changed: true }] },
  { name: "임하늘", cells: [{ code: "O" }, { code: "C" }, { code: "M", changed: true }, { code: "O" }, { code: "A", changed: true }] },
];

/** 운영 중 변경 조각: 바뀐 칸만 주황 테두리. codeClass가 클라이언트 모듈이라 여기 둔다. */
export function ChangeFragment() {
  return (
    <div className={`${ui.card} flex flex-col gap-3`}>
      <p className="text-sm text-[#111214]">최지훈 · 11/4~11/6 · 병가</p>
      <MiniGrid days={CHANGE_DAYS} rows={CHANGE_ROWS} />
      <p className="text-[13px] text-[#B93815]">2명, 5칸 변경 · 주황 테두리 칸이 바뀐 곳이에요.</p>
    </div>
  );
}

// 탭 ① 가능 시간 받기: 최지훈이 링크에서 칠한 한 주(09~23시). 요일마다 [시작, 끝) 시 칸 번호. 히어로 근무표(M C M M 휴 휴 M)와 맞는다
const HOURS = Array.from({ length: 14 }, (_, i) => 9 + i);
const PAINT = [[3, 9], [3, 14], [0, 9], [3, 11], [0, 0], [0, 0], [3, 9]];
const SUBMITTED = ["이영희", "최지훈", "강서연", "임하늘"];

function AvailabilityScene() {
  const dayColor = (dow: string) => (dow === "일" ? "text-[#B42318]" : dow === "토" ? "text-[#C4247C]" : "text-[#4B4F57]");
  return (
    <div className="hero-seq grid min-h-[460px] gap-3.5 bg-white p-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:p-[22px]">
      <div className={`${ui.card} flex min-w-0 flex-col gap-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={ui.cardTitle}>최지훈님 · 11/2~11/8 가능 시간</h3>
          <span className={ui.help}>칠한 칸이 일할 수 있는 시간이에요</span>
        </div>
        <div className="grid overflow-hidden rounded-lg border border-[#EDEDEA]" style={{ gridTemplateColumns: "44px repeat(7, minmax(0, 1fr))" }}>
          <span className="h-8" />
          {WEEK_DAYS.map((d) => (
            <span key={d.date} className={`flex h-8 items-center justify-center gap-1 border-l border-[#EDEDEA] text-xs font-medium ${d.weekend ? "bg-[#F5F5F4]" : ""} ${dayColor(d.dow)}`}>
              {d.dow}
            </span>
          ))}
          {HOURS.map((h, slot) => (
            <Fragment key={h}>
              <span className="h-5 border-t border-[#EDEDEA] pt-0.5 pr-2 text-right font-mono text-[11px] leading-none text-[#6B6F78]">{slot % 2 === 0 ? `${h}:00` : ""}</span>
              {WEEK_DAYS.map((d, i) => (
                <span key={d.date} className={`h-5 border-t border-l border-[#EDEDEA] ${slot >= PAINT[i][0] && slot < PAINT[i][1] ? "bg-[#C4247C]" : d.weekend ? "bg-[#F5F5F4]" : "bg-white"}`} />
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      <div className={`${ui.card} flex flex-col gap-3 self-start`}>
        <h3 className={ui.cardTitle}>직원 링크</h3>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-lg bg-[#F5F5F4] px-3 py-1.5 font-mono text-xs text-[#4B4F57]">/a/7Kp2xQ</span>
          <span className={ui.secondarySm}>링크 복사</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-[#111214]">
            <span className="font-mono">{SUBMITTED.length}</span>/<span className="font-mono">{EMPLOYEES.length}</span>명 제출
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-[#F5F5F4]">
            <span className="block h-full rounded-full bg-[#111214]" style={{ width: `${(SUBMITTED.length / EMPLOYEES.length) * 100}%` }} />
          </span>
        </div>
        <ul className="flex flex-col gap-1.5 border-t border-[#F5F5F4] pt-3">
          {EMPLOYEES.map((n) => {
            const done = SUBMITTED.includes(n.name);
            return (
              <li key={n.id} className="flex items-center justify-between text-sm text-[#111214]">
                {n.name}
                <span className={`${ui.badge} ${done ? ui.badgeTone.applied : ui.badgeTone.draft}`}>{done ? "제출" : "미제출"}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// 탭 ③ 확정 후 바꾸기: 11/4 운영 중에 최지훈이 4~6일 병가. 지난 날짜(2·3일)는 잠기고, 비는 미들 두 칸만 쉬던 사람으로 채운다
const SICK = "최지훈 4~6일 병가";
const CHANGES: DiffCell[] = [
  { employee_id: "e05", day: 3, before: "M", after: "O" },
  { employee_id: "e05", day: 4, before: "M", after: "O" },
  { employee_id: "e07", day: 3, before: "O", after: "M" },
  { employee_id: "e08", day: 4, before: "O", after: "M" },
];
const CHANGED: ScheduleResult = {
  ...RESULT,
  assignments: Object.fromEntries(
    Object.entries(ROWS).map(([id, row]) => [id, row.map((code, i) => (CHANGES.find((c) => c.employee_id === id && c.day === i + 1)?.after as Code) ?? code)]),
  ),
  diff: CHANGES,
};

function ChangeScene() {
  return (
    <div className="hero-seq flex min-h-[460px] flex-col gap-3.5 bg-white p-4 lg:p-[22px]">
      <div inert className="flex flex-col gap-3.5">
        <div className={ui.bar}>
          <span className="flex max-sm:hidden">
            <Mark size={18} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-[#111214] sm:text-[15px]">{SICK}</span>
          <span aria-hidden="true" className={ui.primaryBar}>
            요청 만들기
          </span>
        </div>
        <ReplyCard title="병가" quote={SICK} reading="최지훈은 11/4~11/6에 근무하지 않아요" />
        <div className={`${ui.card} flex min-w-0 flex-col gap-3`}>
          <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <h3 className={`${ui.cardTitle} whitespace-nowrap`}>11/2~11/8 근무표</h3>
            <span className={`${ui.badge} ${ui.badgeTone.operating}`}>운영 중</span>
          </div>
          <div className="overflow-x-auto">
            <ScheduleGrid
              legend={false}
              rows={EMPLOYEES}
              result={CHANGED}
              period={PERIOD}
              holidays={[]}
              isWeekend={isWeekend}
              fixed={NO_FIXED}
              selected={null}
              disabled={false}
              pastDays={2}
              todayDay={3}
              onSelect={() => {}}
              totalCodes={["C"]}
            />
          </div>
          <p className="text-[13px] text-[#B93815]">
            <span className="font-mono">{new Set(CHANGES.map((c) => c.employee_id)).size}</span>명, <span className="font-mono">{CHANGES.length}</span>칸 변경 · 지난 날짜는 그대로 두고 필요한 칸만 바꿨어요.
          </p>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: "availability", label: "가능 시간 받기", scene: <AvailabilityScene /> },
  { id: "sequence", label: "말로 근무표 만들기", scene: <HeroSequence /> },
  { id: "change", label: "확정 후 바꾸기", scene: <ChangeScene /> },
] as const;
const TAB_ICONS: Record<(typeof TABS)[number]["id"], ReactNode> = {
  availability: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  sequence: <path d="M4 5h16v11H9l-5 4z" />,
  change: <path d="M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4" />,
};

/** 랜딩 히어로의 제품 창: 위쪽 탭으로 장면을 바꾼다. 처음에는 말 → 근무표 시퀀스를 연다. */
export function HeroShowcase() {
  const [active, setActive] = useState(1);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (i: number) => {
    setActive(i);
    tabRefs.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select((next + TABS.length) % TABS.length);
  };
  return (
    <div className="hero-window">
      <div role="tablist" aria-label="제품 화면" onKeyDown={onKeyDown} className="hero-tabs">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`hero-tab-${t.id}`}
            aria-selected={i === active}
            aria-controls={`hero-panel-${t.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className="hero-tab"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {TAB_ICONS[t.id]}
            </svg>
            {t.label}
          </button>
        ))}
      </div>
      <div key={TABS[active].id} role="tabpanel" id={`hero-panel-${TABS[active].id}`} aria-labelledby={`hero-tab-${TABS[active].id}`} className="hero-panel">
        {TABS[active].scene}
      </div>
    </div>
  );
}

export default function HeroSequence() {
  // 키를 올리면 시퀀스를 다시 마운트해 애니메이션이 처음부터 돈다. [다시 보기]는 밖에 있어 포커스를 잃지 않는다
  const [run, setRun] = useState(0);
  return (
    <div className={`${ui.panel} hero-seq flex min-h-[420px] flex-col gap-3.5 p-4! lg:p-[22px]!`}>
      <div key={run} inert className="flex flex-col gap-3.5">
        <div className={ui.bar}>
          <span className="flex max-sm:hidden">
            <Mark size={18} />
          </span>
          <span className="relative min-w-0 flex-1 overflow-hidden text-sm whitespace-nowrap text-[#111214] sm:text-[15px]">
            <span className="relative inline-block">
              <span className="invisible">{TYPED}</span>
              <span className="hero-typing">{TYPED}</span>
            </span>
          </span>
          <span aria-hidden="true" className={ui.primaryBar}>
            규칙 만들기
          </span>
        </div>

        <ReplyCard className="hero-rise" title="연달아 금지" quote={TYPED} reading="마감 다음 날에는 오픈을 넣지 않아요" />

        <div className={`${ui.card} hero-table flex flex-col gap-3`}>
          <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <h3 className={`${ui.cardTitle} whitespace-nowrap`}>11/2~11/8 근무표</h3>
            <span className={`hero-badge ${ui.badge} ${ui.badgeTone.applied} whitespace-nowrap`}>반드시 규칙을 모두 지켰어요</span>
          </div>
          <div className="hero-cells overflow-x-auto">
            <ScheduleGrid
              legend={false}
              rows={EMPLOYEES}
              result={RESULT}
              period={PERIOD}
              holidays={[]}
              isWeekend={isWeekend}
              fixed={NO_FIXED}
              selected={null}
              disabled={false}
              readOnly
              onSelect={() => {}}
              cellStyle={cellDelay}
              totalCodes={["C"]}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className={ui.help}>실제 화면이에요. A 오픈 · M 미들 · C 마감 · 빈칸 휴무. 샘플 매장 12명 중 5명, 첫 주만 보여요.</p>
        <button type="button" onClick={() => setRun((r) => r + 1)} className={`${ui.textSm} shrink-0`}>
          다시 보기
        </button>
      </div>
    </div>
  );
}
