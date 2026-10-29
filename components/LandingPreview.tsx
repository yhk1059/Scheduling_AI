"use client";

// 랜딩 첫 화면의 실제 제품 화면 조각. 앱의 그리드 컴포넌트와 카드 문구(lib/wording)를 샘플 데이터로 정적 렌더한다(조작 불가).
import { isWeekendDay } from "@/lib/period";
import type { Code } from "@/lib/store";
import type { ConstraintSpec, Nurse, Period, ScheduleResult } from "@/lib/types.gen";
import { describeParams, hardnessLabel, TEMPLATE_NAMES } from "@/lib/wording";

import { ScheduleGrid } from "./ScheduleStep";
import { ui } from "./ui";

const CARDS: ConstraintSpec[] = [
  {
    id: "landing-n-off",
    type: "off_after_night_block",
    scope: "ward",
    hardness: "hard",
    weight: 1,
    enabled: true,
    source_text: "나이트 다음 날은 무조건 쉬게",
    params: { days: 1 },
  },
  {
    id: "landing-skill-mix",
    type: "skill_mix",
    scope: "ward",
    hardness: "hard",
    weight: 1,
    enabled: true,
    source_text: "나이트 조마다 3년차 이상 1명은 꼭",
    params: { shift: "N", min_years: 3, min_count: 1 },
  },
];

// 2026년 11월 1~7일(일~토), lib/samples/ward-15.json 명단 앞 5명.
const NURSES: Nurse[] = [
  { id: "n01", name: "이영희", years: 12, night_only: false },
  { id: "n02", name: "박민수", years: 9, night_only: false },
  { id: "n03", name: "김철수", years: 7, night_only: false },
  { id: "n04", name: "정유진", years: 5, night_only: false },
  { id: "n05", name: "최지훈", years: 3, night_only: false },
];
const ROWS: Record<string, Code[]> = {
  n01: ["D", "D", "E", "E", "O", "O", "D"],
  n02: ["E", "E", "O", "N", "N", "O", "O"],
  n03: ["N", "N", "O", "O", "D", "D", "E"],
  n04: ["O", "D", "D", "O", "E", "E", "N"],
  n05: ["D", "O", "N", "N", "O", "D", "D"],
};
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
const FIXED = new Map<string, Code>([["n04-2", "D"]]);

// ConstraintCard는 store의 병동을 읽어 랜딩·데모(빈 store)에서는 그려지지 않으므로, 같은 모양의 적용된 카드를 직접 그린다.
export function PreviewCard({ card, nurses, period }: { card: ConstraintSpec; nurses: Nurse[]; period: Period }) {
  return (
    <article className="flex flex-col gap-2.5 rounded-lg border border-[#E2E2DC] bg-white px-[18px] py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-[#1B1B18]">{TEMPLATE_NAMES[card.type]}</h3>
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
      <p className="rounded-sm bg-[#F6F6F3] px-2.5 py-2 text-xs text-[#3D3D38]">{describeParams(card, nurses, period)}</p>
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
