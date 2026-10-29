// 화면 문구를 만드는 순수 함수(UI_GUIDE "문구"). 데이터 이름(period, hard 등)은 그대로 두고 화면에 보이는 말만 여기서 만든다.
import { monthDay, type PeriodRange, type PeriodUnit } from "./period";
import { NIGHT_ONLY_TAG } from "./migrate";
import { homeSummary, isLeaveRule, upcomingRange, type Ward, type WorkPeriod } from "./store";
import type { ConstraintSpec, Days, Nurse, People, ShiftChange, Shifts, WardConfig } from "./types.gen";

/** "11월 근무표"(1일에 시작하는 달력 월) / "11/2~11/15 근무표"(주 단위, 1일이 아닌 날에 시작하는 달력 월). */
export function scheduleName(period: PeriodRange, unit: PeriodUnit): string {
  if (unit === "month" && period.start_date.endsWith("-01")) return `${monthDay(period, 1).split("/")[0]}월 근무표`;
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

/** 근무 형태 요약 한 줄: "데이·이브닝·나이트 3교대, 각 8시간"(활성 코드만, 더블은 뒤에 코드로). */
export function configSummary(config: WardConfig): string {
  const live = config.shifts.filter((s) => s.active !== false && s.hours > 0);
  const base = live.filter((s) => !s.parts?.length);
  const doubles = live.filter((s) => s.parts?.length);
  const names = base.map((s) => s.name).join("·");
  const sameHours = base.every((s) => s.hours === base[0]?.hours);
  const hours =
    base.length === 1
      ? `${base[0].hours}시간`
      : sameHours
        ? `각 ${base[0]?.hours ?? 0}시간`
        : base.map((s) => `${s.name} ${s.hours}시간`).join("·");
  const kind = base.length === 1 ? `${names} 근무` : `${names} ${base.length}교대`;
  return `${kind}, ${hours}${doubles.length ? ` · 더블 ${doubles.map((s) => s.code).join(", ")}` : ""}`;
}

/** 설정 변경 카드 한 줄: "근무 코드 추가 · M 미드 · 11:00부터 8시간", 더블은 세는 근무조를 붙인다. */
export function describeShiftChange(change: ShiftChange, config: WardConfig): string {
  const { code, name, hours, start, parts } = change.shift;
  const partNames = (parts ?? []).map((p) => config.shifts.find((s) => s.code === p)?.name ?? p);
  return [
    `근무 코드 ${change.action === "add" ? "추가" : "수정"}`,
    `${code} ${name}`,
    start ? `${start}부터 ${hours}시간` : `${hours}시간`,
    ...(partNames.length
      ? [`${partNames.map((n, i) => (i < partNames.length - 1 ? n + josa(n, "과", "와") : n)).join(" ")}${josa(partNames.at(-1)!, "으로", "로")} 세요`]
      : []),
  ].join(" · ");
}

/** "반드시" | "가능하면". */
export function hardnessLabel(h: "hard" | "soft"): string {
  return h === "hard" ? "반드시" : "가능하면";
}

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

// --- 블록 → 카드 제목·문장(ADR-018 설계 §6) ---

type Block = Exclude<ConstraintSpec, { type: "fixed_assignment" }>;
type Selector = Shifts | null | undefined;

const OFF = "O";
const WEEKDAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"]; // 0=월
const KIND_NAMES: Record<NonNullable<Days["kind"]>, string> = { all: "", weekday: "평일", weekend: "주말·공휴일", holiday: "공휴일" };

/** 받침이 있으면 a, 없으면 b(은/는, 을/를). */
function josa(word: string, a: string, b: string): string {
  const ch = word.charCodeAt(word.length - 1);
  return ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 !== 0 ? a : b;
}

const sameSet = (codes: string[] | null | undefined, want: string[]) =>
  !!codes && codes.length === want.length && want.every((c) => codes.includes(c));
const onlyIn = (s: Selector, code: string) => sameSet(s?.in, [code]);
const anyWork = (s: Selector) => sameSet(s?.not_in, [OFF]);
const noPeople = (p: People | undefined) =>
  !p?.ids && !p?.tags && !p?.exclude_tags?.length && p?.min_years == null && p?.max_years == null;
const noDays = (d: Days | undefined) => (d?.kind ?? "all") === "all" && !d?.weekdays && !d?.days;

function shiftName(code: string, config: WardConfig): string {
  const s = config.shifts.find((x) => x.code === code);
  if (!s) return code;
  return s.parts?.length ? `${s.name}(${s.code})` : s.name;
}

/** 근무 고르기: in은 이름을 "·"로, not_in [O]는 "근무", not_in [N, O]는 "나이트 말고 다른 근무". */
function shiftsLabel(s: Selector, config: WardConfig): string {
  const names = (codes: string[]) => codes.map((c) => shiftName(c, config)).join("·");
  if (s?.in) return names(s.in);
  const out: string[] = s?.not_in ?? [];
  const rest = out.filter((c) => c !== OFF);
  if (!out.includes(OFF)) return `${names(rest)} 말고 다른 근무·휴무`;
  return rest.length ? `${names(rest)} 말고 다른 근무` : "근무";
}

/** 사람 고르기: 이름(3명 넘으면 "김OO 외 2명"), "책임 태그", "3년차 이상", "나이트전담 빼고". 비어 있으면 "". */
function peopleLabel(p: People | undefined, nurses: Nurse[]): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.ids?.length) {
    const names = p.ids.map((id) => nurseLabel(id, nurses));
    parts.push(names.length > 3 ? `${names[0]} 외 ${names.length - 1}명` : names.join(" "));
  }
  if (p.tags?.length) parts.push(`${p.tags.join("·")} 태그`);
  const { min_years: lo, max_years: hi } = p;
  if (lo != null && hi != null) parts.push(lo === hi ? `${lo}년차` : `${lo}~${hi}년차`);
  else if (lo != null) parts.push(`${lo}년차 이상`);
  else if (hi != null) parts.push(`${hi}년차 이하`);
  if (p.exclude_tags?.length) parts.push(`${p.exclude_tags.join("·")} 빼고`);
  return parts.join(" ");
}

/** 날짜 고르기: "평일", "11/15~11/17", "평일 중 월·수요일", "11/2~11/7 중 주말·공휴일". 비어 있으면 "". */
function daysLabel(d: Days | undefined, period: PeriodRange): string {
  if (!d) return "";
  const kind = KIND_NAMES[d.kind ?? "all"];
  const weekdays = d.weekdays?.length ? `${d.weekdays.map((w) => WEEKDAY_NAMES[w]).join("·")}요일` : "";
  const rest = weekdays && kind ? `${kind} 중 ${weekdays}` : weekdays || kind;
  const dates = d.days?.length ? formatDays(d.days, period) : "";
  return dates && rest ? `${dates} 중 ${rest}` : dates || rest;
}

/** 수·범위: "3명", "3~4명", "8일 이상", "2번까지", "52시간 이하". */
function boundLabel(min: number | null | undefined, max: number | null | undefined, unit: string): string {
  if (min != null && max != null) return min === max ? `${min}${unit}` : `${min}~${max}${unit}`;
  if (min != null) return `${min}${unit} 이상`;
  return unit === "시간" ? `${max}${unit} 이하` : `${max}${unit}까지`;
}

/** 희망·기피: 가능하면인 한 사람·기간 전체 세기에서 대상 날짜를 모두 맞추거나(min) 모두 피하는(max 0) 모양. */
function isPreference(c: ConstraintSpec): c is Extract<ConstraintSpec, { type: "count" }> {
  if (c.type !== "count" || c.hardness !== "soft") return false;
  const p = c.params;
  const bounded = (p.max === 0 && p.min == null) || (p.min != null && p.max == null);
  return p.per === "person" && (p.measure ?? "count") === "count" && p.people?.ids?.length === 1 && !!p.shifts.in && bounded;
}

/** 카드 제목: 블록 모양의 이름. 맞는 이름이 없으면 세는 규칙·순서 규칙·고르게 규칙. */
export function presetName(c: ConstraintSpec): string {
  if (c.type === "fixed_assignment") return "고정 근무";
  if (c.type === "count") {
    const p = c.params;
    const hours = p.measure === "hours";
    if (p.per === "day") {
      if (hours) return "세는 규칙";
      if (noPeople(p.people)) return "필요 인원";
      const { ids, tags, exclude_tags, min_years, max_years } = p.people ?? {};
      if (!ids && !exclude_tags?.length && tags?.length && min_years == null && max_years == null) return "태그별 배치";
      if (!ids && !tags && !exclude_tags?.length) return "연차별 배치";
      return "세는 규칙";
    }
    if (p.people?.tags?.length === 1 && p.people.tags[0] === NIGHT_ONLY_TAG && p.max === 0) return "나이트 전담";
    if (isLeaveRule(c)) return "휴가";
    if (isPreference(c)) return "희망·기피 근무";
    if (hours) return "근무 시간";
    if (p.per === "person") {
      return onlyIn(p.shifts, OFF) && noPeople(p.people) && noDays(p.days) && p.max == null ? "최소 휴무 일수" : "근무 횟수";
    }
    return onlyIn(p.shifts, OFF) ? "휴무 간격" : "세는 규칙";
  }
  if (c.type === "sequence") {
    const p = c.params;
    if (p.forbid) return "금지 순서";
    if (p.after) return onlyIn(p.after, "N") ? "나이트 다음 휴무" : "순서 규칙";
    if (p.min_len == null && anyWork(p.run)) return "최대 연속 근무";
    if (p.min_len == null && onlyIn(p.run, "N")) return "최대 연속 나이트";
    if (onlyIn(p.run, "N")) return "나이트 블록 길이";
    return "순서 규칙";
  }
  const p = c.params;
  if ((p.measure ?? "count") === "count" && noDays(p.days) && onlyIn(p.shifts, "N")) return "나이트 고르게";
  if ((p.measure ?? "count") === "count" && p.days?.kind === "weekend" && !p.days.days && !p.days.weekdays && anyWork(p.shifts))
    return "주말·공휴일 고르게";
  return "고르게 규칙";
}

function describeCount(c: Extract<Block, { type: "count" }>, config: WardConfig, nurses: Nurse[], period: PeriodRange): string {
  const p = c.params;
  const who = peopleLabel(p.people, nurses);
  const when = daysLabel(p.days, period);
  const shifts = shiftsLabel(p.shifts, config);
  if (isLeaveRule(c) || isPreference(c)) {
    const name = nurseLabel(p.people!.ids![0], nurses);
    const what = isLeaveRule(c) ? "휴무" : `${shifts} ${p.max === 0 ? "피하기" : "희망"}`;
    return `${name} · ${when || "근무표 전체"} · ${what}`;
  }
  const hours = p.measure === "hours";
  const unit = hours ? "시간" : p.per === "day" ? "명" : onlyIn(p.shifts, OFF) ? "일" : "번";
  const what = hours ? (anyWork(p.shifts) ? "근무 시간" : `${shifts} 근무 시간`) : shifts;
  const none = p.max === 0 && p.min == null;
  const amount = none ? `${what} 없음` : `${what} ${boundLabel(p.min, p.max, unit)}`;
  const everyone = who || "모든 사람";
  const parts =
    p.per === "day"
      ? [when ? `${when}마다` : "매일", who, amount]
      : p.per === "person"
        ? [everyone, when || (none ? "" : "근무표마다"), amount]
        : [everyone, p.per === "person_week" ? "주마다" : `${p.window}일마다`, when, amount];
  return parts.filter(Boolean).join(" ");
}

function describeSequence(c: Extract<Block, { type: "sequence" }>, config: WardConfig, nurses: Nurse[]): string {
  const p = c.params;
  const who = peopleLabel(p.people, nurses);
  const label = (s: Selector) => shiftsLabel(s, config);
  let text: string;
  if (p.forbid) {
    text = `${p.forbid
      .map((pattern) => (pattern.length === 2 ? `${label(pattern[0])} 다음 날 ${label(pattern[1])}` : pattern.map(label).join(" → ")))
      .join(", ")} 금지`;
  } else if (p.after) {
    text = `${label(p.after)} 다음 날은 휴무 ${p.then_off}일`;
  } else {
    const run = label(p.run);
    if (p.min_len == null) text = anyWork(p.run) ? `연속 근무 ${p.max_len}일까지` : `${run} 연속 ${p.max_len}일까지`;
    else {
      const len = p.max_len == null ? `${p.min_len}일 이상` : p.min_len === p.max_len ? `${p.min_len}일` : `${p.min_len}~${p.max_len}일`;
      text = `${run}${josa(run, "은", "는")} ${len}씩 이어서`;
    }
  }
  return who ? `${who} ${text}` : text;
}

function describeBalance(c: Extract<Block, { type: "balance" }>, config: WardConfig, nurses: Nurse[], period: PeriodRange): string {
  const p = c.params;
  const what = p.measure === "hours" ? "근무 시간" : anyWork(p.shifts) ? "근무 수" : `${shiftsLabel(p.shifts, config)} 수`;
  const text = [peopleLabel(p.people, nurses), daysLabel(p.days, period), `${what}${josa(what, "을", "를")} 고르게`]
    .filter(Boolean)
    .join(" ");
  const history = (p.with_history ?? true) ? "(최근 4주 포함)" : "";
  const gap = (c.hardness ?? "soft") === "hard" ? ` · 차이 ${p.max_gap ?? 1} 이하` : "";
  return `${text}${history}${gap}`;
}

/**
 * 카드 해석 결과 한 줄(설계 §6 "[사람] [날짜·묶음] [근무] [수·범위]"). 근무 이름은 config의 name.
 * 휴가·희망·기피·고정은 "이름 · 날짜 · 근무" 모양으로 쓴다. 내부 id와 코드만 있는 표기를 쓰지 않는다.
 */
export function describeBlock(c: ConstraintSpec, config: WardConfig, nurses: Nurse[], period: PeriodRange): string {
  switch (c.type) {
    case "fixed_assignment": {
      const { nurse_id, day, shift } = c.params;
      return `${nurseLabel(nurse_id, nurses)} · ${monthDay(period, day)} · ${shiftName(shift, config)} 고정`;
    }
    case "count":
      return describeCount(c, config, nurses, period);
    case "sequence":
      return describeSequence(c, config, nurses);
    case "balance":
      return describeBalance(c, config, nurses, period);
  }
}

/** 병동 규칙 수. 필요 인원은 세지 않는다. */
export function wardRuleCount(rules: ConstraintSpec[]): number {
  return rules.filter((r) => presetName(r) !== "필요 인원").length;
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
