"use client";

// 랜딩 첫 화면의 실제 제품 화면 조각. 앱의 카드·그리드 컴포넌트를 샘플 데이터로 정적 렌더한다(조작 불가).
import type { Code } from "@/lib/store";
import type { ConstraintSpec, Nurse, ScheduleResult } from "@/lib/types.gen";

import ConstraintCard from "./ConstraintCard";
import { ScheduleGrid } from "./ScheduleStep";

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
const DAYS = 7;
const dow = (d: number) => new Date(2026, 10, d).getDay();
const isWeekend = (d: number) => dow(d) === 0 || dow(d) === 6;
const FIXED = new Map<string, Code>([["n04-2", "D"]]);

export default function LandingPreview() {
  return (
    <div inert className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        {CARDS.map((c) => (
          <ConstraintCard key={c.id} card={c} pending={false} />
        ))}
      </div>
      <div className="rounded-lg border border-[#E2E2DC] bg-white px-[18px] py-4">
        <ScheduleGrid
          rows={NURSES}
          result={RESULT}
          month={11}
          days={DAYS}
          dow={dow}
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
