// 화면 문구를 만드는 순수 함수(UI_GUIDE "문구"). 데이터 이름(period, hard 등)은 그대로 두고 화면에 보이는 말만 여기서 만든다.
import { monthDay, type PeriodRange, type PeriodUnit } from "./period";
import { homeSummary, upcomingRange, type Ward, type WorkPeriod } from "./store";
import type { ConstraintSpec, Nurse } from "./types.gen";

/** "11월 근무표"(달력 월) / "11/2~11/15 근무표"(주 단위). */
export function scheduleName(period: PeriodRange, unit: PeriodUnit): string {
  if (unit === "month") return `${monthDay(period, 1).split("/")[0]}월 근무표`;
  return `${monthDay(period, 1)}~${monthDay(period, period.length)} 근무표`;
}

const UNIT_NAMES: Record<PeriodUnit, string> = { month: "한 달(1일~말일)", "1w": "1주", "2w": "2주", "4w": "4주" };

/** 근무표 주기 select 레이블. */
export function unitName(unit: PeriodUnit): string {
  return UNIT_NAMES[unit];
}

/** 상단 바·홈 요약용: "한 달 단위", "2주 단위". */
export function unitShort(unit: PeriodUnit): string {
  return `${unit === "month" ? "한 달" : UNIT_NAMES[unit]} 단위`;
}

export const TEMPLATE_NAMES: Record<ConstraintSpec["type"], string> = {
  daily_coverage: "필요 인원",
  forbidden_sequence: "금지 순서",
  max_consecutive_work: "최대 연속 근무",
  max_consecutive_nights: "최대 연속 나이트",
  min_days_off: "최소 휴무 일수",
  off_after_night_block: "나이트 다음 휴무",
  skill_mix: "연차별 배치",
  leave: "휴가",
  fixed_assignment: "고정 근무",
  shift_preference: "희망·기피 근무",
  night_fairness: "나이트 고르게",
  weekend_fairness: "주말·공휴일 고르게",
};

/** "반드시" | "가능하면". */
export function hardnessLabel(h: "hard" | "soft"): string {
  return h === "hard" ? "반드시" : "가능하면";
}

const SHIFT_NAMES = { D: "데이", E: "이브닝", N: "나이트", O: "휴무" } as const;

/** [15,16,17,20] → [[15,17],[20,20]] */
export function dayRanges(days: number[]): [number, number][] {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const d of sorted) {
    const last = out.at(-1);
    if (last && last[1] === d - 1) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

/** [15,16,17,20] → "11/15~11/17, 11/20" */
function formatDays(days: number[], period: PeriodRange): string {
  const md = (d: number) => monthDay(period, d);
  return dayRanges(days)
    .map(([a, b]) => (a === b ? md(a) : `${md(a)}~${md(b)}`))
    .join(", ");
}

function nurseLabel(id: string, nurses: Nurse[]): string {
  return nurses.find((n) => n.id === id)?.name ?? "(명단에 없는 간호사)";
}

/** 카드 해석 결과 한 줄. 내부 id와 근무 코드만 있는 표기를 쓰지 않는다. */
export function describeParams(c: ConstraintSpec, nurses: Nurse[], period: PeriodRange): string {
  switch (c.type) {
    case "daily_coverage":
      return `${SHIFT_NAMES[c.params.shift]} · ${c.params.day_kind === "weekday" ? "평일" : "주말·공휴일"} · ${c.params.min}~${c.params.max}명`;
    case "forbidden_sequence":
      return `${SHIFT_NAMES[c.params.first]} 다음 날 ${SHIFT_NAMES[c.params.second]} 금지`;
    case "max_consecutive_work":
      return `연속 근무 ${c.params.days}일까지`;
    case "max_consecutive_nights":
      return `나이트 연속 ${c.params.days}일까지`;
    case "min_days_off":
      return `휴무 ${c.params.days}일 이상`;
    case "off_after_night_block":
      return `나이트 다음 날은 휴무 ${c.params.days}일`;
    case "skill_mix":
      return `${SHIFT_NAMES[c.params.shift]} · ${c.params.min_years}년차 이상 ${c.params.min_count}명 이상`;
    case "leave":
      return `${nurseLabel(c.params.nurse_id, nurses)} · ${formatDays(c.params.days, period)} · 휴무`;
    case "fixed_assignment":
      return `${nurseLabel(c.params.nurse_id, nurses)} · ${monthDay(period, c.params.day)} · ${SHIFT_NAMES[c.params.shift]} 고정`;
    case "shift_preference": {
      const p = c.params;
      const when = p.days?.length ? formatDays(p.days, period) : p.weekends_only ? "주말·공휴일" : "근무표 전체";
      const scope = p.days?.length && p.weekends_only ? `${when} 중 주말·공휴일` : when;
      return `${nurseLabel(p.nurse_id, nurses)} · ${scope} · ${SHIFT_NAMES[p.shift]} ${p.prefer ? "희망" : "피하기"}`;
    }
    case "night_fairness":
      return "나이트 횟수를 고르게";
    case "weekend_fairness":
      return "주말·공휴일 근무를 고르게";
  }
}

/** 병동 규칙 수. 필요 인원(daily_coverage)은 세지 않는다. */
export function wardRuleCount(rules: ConstraintSpec[]): number {
  return rules.filter((r) => r.type !== "daily_coverage").length;
}

/** 평균보다 많은 근무일: 2.6 → "+3일", -0.4 → "0일", -1.6 → "−2일". */
export function formatDeviation(d: number): string {
  const n = Math.round(Math.abs(d));
  if (n === 0) return "0일";
  return `${d > 0 ? "+" : "−"}${n}일`;
}

/** 홈 "지금 할 일" 카드 상태(다음 근무표). */
export type NextTask =
  | { kind: "none"; name: string }
  | { kind: "drafting"; name: string; requests: number }
  | { kind: "generated"; name: string }
  | { kind: "confirmed"; name: string; confirmedAt: string };

export function nextTask(ward: Ward, periods: WorkPeriod[], today: string): NextTask {
  const { next } = homeSummary(periods, today);
  if (next.state === "none") return { kind: "none", name: scheduleName(upcomingRange(ward.unit, periods, today), ward.unit) };
  const p = next.period;
  const name = scheduleName(p, ward.unit);
  if (next.state === "confirmed") return { kind: "confirmed", name, confirmedAt: p.versions.at(-1)?.confirmed_at ?? "" };
  return p.result ? { kind: "generated", name } : { kind: "drafting", name, requests: p.requests.length };
}

/** 홈 지금 할 일 카드의 진행 단계. */
export const TASK_STEPS = ["요청", "근무표", "확정"] as const;

/** 지금 할 일 카드에서 끝난 단계 수. */
export function taskDoneSteps(task: NextTask): number {
  switch (task.kind) {
    case "none":
      return 0;
    case "drafting":
      return task.requests > 0 ? 1 : 0;
    case "generated":
      return 2;
    case "confirmed":
      return 3;
  }
}
