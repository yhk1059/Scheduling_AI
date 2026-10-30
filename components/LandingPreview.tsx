"use client";

// 랜딩 첫 화면의 실제 제품 화면 조각. 앱의 그리드 컴포넌트와 카드 문구(lib/wording)를 샘플 데이터로 정적 렌더한다(조작 불가).
import { isWeekendDay } from "@/lib/period";
import type { Code } from "@/lib/store";
import { DEFAULT_CONFIG } from "@/lib/rules";
import demo from "@/lib/samples/demo-schedule.json";
import shop from "@/lib/samples/shop-12.json";
import type { ConstraintSpec, Employee, Period, ScheduleResult } from "@/lib/types.gen";
import { describeRule, hardnessLabel, presetName } from "@/lib/wording";

import RuleText from "./RuleText";
import { ScheduleGrid } from "./ScheduleStep";
import { ui } from "./ui";

// 샘플 데모(/demo)와 같은 데이터: 매장 규칙 두 장과 근무표 첫 주(2026년 11월 2~8일, 월~일)의 앞 5명.
const CARDS = (shop.constraints as unknown as ConstraintSpec[]).filter((c) => ["rule-no-close-open", "rule-max-run"].includes(c.id));
const EMPLOYEES: Employee[] = shop.employees.slice(0, 5);
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
const FIXED = new Map<string, Code>([["e04-2", ROWS.e04[1]]]);

// ConstraintCard는 store의 매장을 읽어 랜딩·데모(빈 store)에서는 그려지지 않으므로, 같은 모양의 적용된 카드를 직접 그린다.
export function PreviewCard({ card, employees, period }: { card: ConstraintSpec; employees: Employee[]; period: Period }) {
  return (
    <article className="flex flex-col gap-2.5 rounded-lg border border-[#E2E2DC] bg-white px-[18px] py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-[#1B1B18]">{presetName(card)}</h3>
        <div role="group" aria-label="반드시/가능하면" className="inline-flex overflow-hidden rounded-md border border-[#C9C9C1]">
          {(["hard", "soft"] as const).map((h) => (
            <span
              key={h}
              className={`inline-flex h-7 items-center px-3 text-xs font-medium ${card.hardness === h ? "bg-[#1B1B18] text-white" : "bg-white text-[#66665E]"}`}
            >
              {hardnessLabel(h)}
            </span>
          ))}
        </div>
      </div>
      <p className="text-sm text-[#1B1B18]">“{card.source_text}”</p>
      <p className="rounded-sm bg-[#F6F6F3] px-2.5 py-2 text-xs text-[#3D3D38]"><RuleText sentence={describeRule(card, DEFAULT_CONFIG, employees, period)} />
      </p>
      <div>
        <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>적용됨</span>
      </div>
    </article>
  );
}

export default function LandingPreview() {
  return (
    <div inert className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        {CARDS.map((c) => (
          <PreviewCard key={c.id} card={c} employees={EMPLOYEES} period={PERIOD} />
        ))}
      </div>
      <div className="rounded-lg border border-[#E2E2DC] bg-white px-[18px] py-4">
        <ScheduleGrid
          rows={EMPLOYEES}
          result={RESULT}
          period={PERIOD}
          holidays={[]}
          isWeekend={isWeekend}
          fixed={FIXED}
          selected={null}
          disabled={false}
          onSelect={() => {}}
        />
      </div>
    </div>
  );
}
