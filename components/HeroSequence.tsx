"use client";

// 랜딩 첫 화면의 시퀀스(말 한 줄 → 규칙 카드 → 근무표)와 랜딩 조각. 앱의 그리드 컴포넌트를 샘플 데이터로 정적 렌더한다(조작 불가).
import { type ReactNode, useState } from "react";

import { isWeekendDay } from "@/lib/period";
import demo from "@/lib/samples/demo-schedule.json";
import shop from "@/lib/samples/shop-12.json";
import type { Code } from "@/lib/store";
import type { Employee, ScheduleResult } from "@/lib/types.gen";
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
    <article className={`flex flex-col gap-2.5 rounded-lg border border-[#E2E2DC] bg-white px-4 py-3.5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#1B1B18]">{title}</h3>
        <span className={`${ui.badge} ${hardness === "hard" ? "bg-[#1B1B18] text-white" : "border border-[#C9C9C1] bg-white text-[#3D3D38]"}`}>
          {hardnessLabel(hardness)}
        </span>
      </div>
      <p className="flex items-start gap-1.5 text-sm text-[#1B1B18]">
        <QuoteGlyph size={16} />
        {quote}
      </p>
      <div className="ml-2 flex flex-col gap-1 border-l-2 border-[#CFE4EA] pl-3.5">
        <span className="font-mono text-[11px] text-[#155E75]">이렇게 읽었어요</span>
        <span className="text-sm text-[#1B1B18]">{reading}</span>
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
  const dayColor = (d: (typeof WEEK_DAYS)[number]) => (d.dow === "일" ? "text-[#B42318]" : d.dow === "토" ? "text-[#155E75]" : "text-[#66665E]");
  return (
    <div className="flex w-max flex-col gap-0.5">
      <div className="flex items-center gap-0.5">
        <span className="w-16" />
        {days.map((d) => (
          <span key={d.date} className={`inline-flex w-[30px] flex-col items-center rounded-xs font-mono text-[11px] leading-tight ${d.weekend ? "bg-[#F1EEE6]" : ""} ${dayColor(d)}`}>
            {d.date}
            <span>{d.dow}</span>
          </span>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-0.5">
          <span className="w-16 truncate text-sm text-[#1B1B18]">{r.name}</span>
          {r.cells.map((c, i) => (
            <span key={i} className={`${CELL} ${codeClass(c.code, !!days[i].weekend)} ${c.changed ? "shadow-[inset_0_0_0_2px_#D97706]" : ""}`}>
              {c.code === "O" ? "" : c.code}
            </span>
          ))}
        </div>
      ))}
      {totals && (
        <div className="mt-1.5 flex items-center gap-0.5 border-t border-[#EFEFEB] pt-2">
          <span className="w-16 text-xs font-medium text-[#66665E]">{totals.label}</span>
          {totals.values.map((v, i) => (
            <span key={i} className={`flex h-7 w-[30px] items-center justify-center rounded-xs font-mono text-[13px] font-medium text-[#1B1B18] ${days[i].weekend ? "bg-[#F1EEE6]" : ""}`}>
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
      <div className="flex items-center gap-4 border-t border-[#EFEFEB] pt-3">
        <span className="flex flex-col gap-0.5">
          <span className={ui.help}>희망 반영</span>
          <span className={`${ui.bigNumber} text-[#1B1B18]`}>9/9</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className={ui.help}>못 지킨 가능하면 규칙</span>
          <span className={`${ui.bigNumber} text-[#1B1B18]`}>0</span>
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
      <p className="text-sm text-[#1B1B18]">최지훈 · 11/4~11/6 · 병가</p>
      <MiniGrid days={CHANGE_DAYS} rows={CHANGE_ROWS} />
      <p className="text-[13px] text-[#7A4506]">2명, 5칸 변경 · 주황 테두리 칸이 바뀐 곳이에요.</p>
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
          <span className="relative min-w-0 flex-1 overflow-hidden text-sm whitespace-nowrap text-[#1B1B18] sm:text-[15px]">
            <span className="relative inline-block">
              <span className="invisible">{TYPED}</span>
              <span className="hero-typing">{TYPED}</span>
            </span>
          </span>
          <span aria-hidden="true" className={ui.primaryBar}>
            규칙 만들기
          </span>
        </div>

        <ReplyCard className="hero-rise" title="금지 순서" quote={TYPED} reading="모든 사람 · 매일 · 마감 다음 날 오픈 금지" />

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
        <p className={ui.help}>실제 화면이에요. A 오픈 · M 미들 · C 마감. 샘플 매장 12명 중 5명, 첫 주만 보여요.</p>
        <button type="button" onClick={() => setRun((r) => r + 1)} className={`${ui.textSm} shrink-0`}>
          다시 보기
        </button>
      </div>
    </div>
  );
}
