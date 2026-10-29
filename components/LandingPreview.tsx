"use client";

// 랜딩 첫 화면의 실제 제품 화면 조각. 앱의 그리드 컴포넌트와 카드 문구(lib/wording)를 샘플 데이터로 정적 렌더한다(조작 불가).
import { isWeekendDay } from "@/lib/period";
import type { Code } from "@/lib/store";
import { DEFAULT_CONFIG } from "@/lib/migrate";
import demo from "@/lib/samples/demo-schedule.json";
import ward from "@/lib/samples/ward-15.json";
import type { ConstraintSpec, Nurse, Period, ScheduleResult } from "@/lib/types.gen";
import { describeBlock, hardnessLabel, presetName } from "@/lib/wording";

import { ScheduleGrid } from "./ScheduleStep";
import { ui } from "./ui";

// 샘플 데모(/demo)와 같은 데이터: 병동 규칙 두 장과 근무표 첫 주(2026년 11월 1~7일, 일~토)의 앞 5명.
const CARDS = (ward.constraints as unknown as ConstraintSpec[]).filter((c) => ["rule-noff", "rule-max-nights"].includes(c.id));
const NURSES: Nurse[] = ward.nurses.slice(0, 5);
const ROWS: Record<string, Code[]> = Object.fromEntries(
  NURSES.map((n) => [n.id, (demo.result.assignments as Record<string, Code[]>)[n.id].slice(0, 7)]),
);
const RESULT: ScheduleResult = {
  assignments: ROWS,
  summary: { preferences_total: 0, preferences_met: 0, soft_violation_count: 0 },
  stats: {},
  soft_violations: [],
  diff: null,
  optimal: true,
};
const PERIOD = { start_date: "2026-11-01", length: 7 };
const isWeekend = (d: number) => isWeekendDay(PERIOD, d, []);
const FIXED = new Map<string, Code>([["n04-2", ROWS.n04[1]]]);

// ConstraintCard는 store의 병동을 읽어 랜딩·데모(빈 store)에서는 그려지지 않으므로, 같은 모양의 적용된 카드를 직접 그린다.
export function PreviewCard({ card, nurses, period }: { card: ConstraintSpec; nurses: Nurse[]; period: Period }) {
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
      <p className="rounded-sm bg-[#F6F6F3] px-2.5 py-2 text-xs text-[#3D3D38]">{describeBlock(card, DEFAULT_CONFIG, nurses, period)}</p>
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
          <PreviewCard key={c.id} card={c} nurses={NURSES} period={PERIOD} />
        ))}
      </div>
      <div className="rounded-lg border border-[#E2E2DC] bg-white px-[18px] py-4">
        <ScheduleGrid
          rows={NURSES}
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
