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
  className = "",
}: {
  title: string;
  quote: string;
  reading: ReactNode;
  hardness?: "hard" | "soft";
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
      <div>
        <span className={`${ui.badge} ${ui.badgeTone.applied}`}>적용됨</span>
      </div>
    </article>
  );
}

// 지난 날짜는 잠기고, 병가가 든 칸과 대신 들어간 칸만 바뀐다.
const CHANGE_ROWS: { name: string; cells: { code: Code; changed?: boolean }[] }[] = [
  { name: "최지훈", cells: [{ code: "M" }, { code: "A" }, { code: "O", changed: true }, { code: "O", changed: true }, { code: "O", changed: true }] },
  { name: "임하늘", cells: [{ code: "O" }, { code: "C" }, { code: "M", changed: true }, { code: "O" }, { code: "A", changed: true }] },
];

/** 운영 중 변경 조각: 바뀐 칸만 주황 테두리. codeClass가 클라이언트 모듈이라 여기 둔다. */
export function ChangeFragment() {
  return (
    <div className={`${ui.card} flex flex-col gap-3`}>
      <p className="text-sm text-[#1B1B18]">최지훈 · 10/28~10/30 · 휴무</p>
      <div className="flex flex-col gap-0.5">
        {CHANGE_ROWS.map((r) => (
          <div key={r.name} className="flex items-center gap-0.5">
            <span className="w-16 text-sm text-[#1B1B18]">{r.name}</span>
            {r.cells.map((c, i) => (
              <span key={i} className={`${CELL} ${codeClass(c.code, false)} ${c.changed ? "shadow-[inset_0_0_0_2px_#D97706]" : ""}`}>
                {c.code}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="text-[13px] text-[#7A4506]">2명, 5칸 변경 · 주황 테두리 칸이 바뀐 곳이에요.</p>
    </div>
  );
}

export default function HeroSequence() {
  // 키를 올리면 시퀀스를 다시 마운트해 애니메이션이 처음부터 돈다. [다시 보기]는 밖에 있어 포커스를 잃지 않는다
  const [run, setRun] = useState(0);
  return (
    <div className={`${ui.panel} hero-seq flex min-h-[420px] flex-col gap-3.5 p-[22px]!`}>
      <div key={run} inert className="flex flex-col gap-3.5">
        <div className={ui.bar}>
          <Mark size={18} />
          <span className="relative min-w-0 flex-1 text-[15px] whitespace-nowrap text-[#1B1B18]">
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

        <div className={`${ui.card} flex flex-col gap-3`}>
          <div className="flex h-[22px] items-center justify-between gap-3">
            <h3 className={ui.cardTitle}>11/2~11/8 근무표</h3>
            <span className={`hero-badge ${ui.badge} ${ui.badgeTone.applied}`}>반드시 규칙을 모두 지켰어요</span>
          </div>
          <div className="hero-cells">
            <ScheduleGrid
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
        <p className={ui.help}>실제 화면이에요. 샘플 매장 12명 중 5명, 첫 주만 보여요.</p>
        <button type="button" onClick={() => setRun((r) => r + 1)} className={ui.textSm}>
          다시 보기
        </button>
      </div>
    </div>
  );
}
