// 화면 문구를 만드는 순수 함수(UI_GUIDE "문구"). 데이터 이름(period, hard 등)은 그대로 두고 화면에 보이는 말만 여기서 만든다.
import { monthDay, type PeriodRange, type PeriodUnit } from "./period";
import { normalizeRule, ruleShape, type Bound } from "./rules";
import { homeSummary, upcomingRange, type Shop, type WorkPeriod } from "./store";
import type { Cmp, ConstraintSpec, Count, Days, Employee, People, Rule, ShiftChange, Shifts, ShopConfig } from "./types.gen";

/** 제품 이름. 화면 문구에서 제품 이름을 쓸 때 이 상수를 쓴다. */
export const PRODUCT_NAME = "말로";

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

/** 근무 형태 요약 한 줄: "오픈·미들·마감, 각 6시간"(활성 코드만, 더블은 뒤에 코드로). */
/** 요약표의 필요 인원 한 칸: "3명", "1~2명", "2명 이상". 규칙이 없으면 빈 문자열. */
export function coverageText(range: { min: number; max: number | null } | null): string {
  if (!range) return "";
  if (range.max === null) return `${range.min}명 이상`;
  return range.min === range.max ? `${range.min}명` : `${range.min}~${range.max}명`;
}

/** 설정 변경 카드 한 줄: "근무 코드 추가 · P 피크 · 11:00~14:00 · 3시간", 더블은 세는 근무조를 붙인다. */
export function describeShiftChange(change: ShiftChange, config: ShopConfig): string {
  const { code, name, hours, start, end, parts } = change.shift;
  const partNames = (parts ?? []).map((p) => config.shifts.find((s) => s.code === p)?.name ?? p);
  return [
    `근무 코드 ${change.action === "add" ? "추가" : "수정"}`,
    `${code} ${name}`,
    ...(start && end ? [`${start}~${end}`] : []),
    `${hours}시간`,
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

function employeeLabel(id: string, employees: Employee[]): string {
  return employees.find((n) => n.id === id)?.name ?? "(명단에 없는 직원)";
}

// --- 식 규칙 → 카드 제목·문장(ADR-019 설계 §5) ---
// 변환표 모양(프리셋)은 블록 시절 문장 그대로, 그 밖은 "[범위]마다, [when]이면 [then]" 틀이다. LLM 문장을 쓰지 않는다.

type Selector = Shifts | null | undefined;
type Shape = NonNullable<ReturnType<typeof ruleShape>>;
type CountShape = Extract<Shape, { kind: "count" }>;

const OFF = "O";
const WEEKDAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"]; // 0=월
const KIND_NAMES: Record<NonNullable<Days["kind"]>, string> = { all: "", weekday: "평일", weekend: "주말·공휴일", holiday: "공휴일" };

/** 받침이 있으면 a, 없으면 b(은/는, 을/를). */
export function josa(word: string, a: string, b: string): string {
  const ch = word.charCodeAt(word.length - 1);
  return ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 !== 0 ? a : b;
}

const sameSet = (codes: string[] | null | undefined, want: string[]) =>
  !!codes && codes.length === want.length && want.every((c) => codes.includes(c));
const onlyIn = (s: Selector, code: string) => sameSet(s?.in, [code]);
const anyWork = (s: Selector) => sameSet(s?.not_in, [OFF]);
const noPeople = (p: People | null | undefined) =>
  !p?.ids && !p?.tags && !p?.exclude_tags?.length;
const noDays = (d: Days | undefined) => (d?.kind ?? "all") === "all" && !d?.weekdays && !d?.days;

function shiftName(code: string, config: ShopConfig): string {
  const s = config.shifts.find((x) => x.code === code);
  if (!s) return code;
  return s.parts?.length ? `${s.name}(${s.code})` : s.name;
}

/** 근무 고르기: in은 이름을 "·"로, not_in [O]는 "근무", not_in [C, O]는 "마감 말고 다른 근무". */
function shiftsLabel(s: Selector, config: ShopConfig): string {
  const names = (codes: string[]) => codes.map((c) => shiftName(c, config)).join("·");
  if (s?.in) return names(s.in);
  const out: string[] = s?.not_in ?? [];
  const rest = out.filter((c) => c !== OFF);
  if (!out.includes(OFF)) return `${names(rest)} 말고 다른 근무·휴무`;
  return rest.length ? `${names(rest)} 말고 다른 근무` : "근무";
}

/** 사람 고르기: 이름(3명 넘으면 "김OO 외 2명"), "리더 태그", "신입 빼고". 비어 있으면 "". */
function peopleLabel(p: People | null | undefined, employees: Employee[]): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.ids?.length) {
    const names = p.ids.map((id) => employeeLabel(id, employees));
    parts.push(names.length > 3 ? `${names[0]} 외 ${names.length - 1}명` : names.join(" "));
  }
  if (p.tags?.length) parts.push(`${p.tags.join("·")} 태그`);
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

// --- 문장 조각: 조정 가능한 값은 이름과 함께 따로 둔다(화면이 밑줄을 긋는다) ---

/** 카드 문장 한 조각. value가 있으면 조정 가능한 값(Rule.values의 이름). */
export type SentencePart = { text: string } | { value: string; text: string };
/** 카드 해석 결과. parts를 이어 붙이면 text다. */
export interface RuleSentence {
  text: string;
  parts: SentencePart[];
}

type Seg = string | { value: string; text: string };
type Phrase = Seg[];
type Item = string | Phrase | false | null | undefined;

const segText = (s: Seg) => (typeof s === "string" ? s : s.text);
const textOf = (p: Phrase) => p.map(segText).join("");
const filled = (x: Item): x is string | Phrase => !!x && (typeof x === "string" || textOf(x) !== "");
/** 빈 것을 빼고 sep으로 잇는다. */
function joined(sep: string, ...xs: Item[]): Phrase {
  return xs.filter(filled).flatMap((x, i) => [...(i ? [sep] : []), ...(typeof x === "string" ? [x] : x)]);
}
const words = (...xs: Item[]) => joined(" ", ...xs);
const fmt = (n: number) => String(n);
/** 수 하나: 이름이 있으면 조정 가능한 값. */
const num = (b: Bound): Seg => (b.name ? { value: b.name, text: fmt(b.n) } : fmt(b.n));

function sentence(p: Phrase): RuleSentence {
  const parts: SentencePart[] = [];
  for (const s of p) {
    const last = parts.at(-1);
    if (typeof s !== "string") parts.push({ ...s });
    else if (s && last && !("value" in last)) last.text += s;
    else if (s) parts.push({ text: s });
  }
  return { text: textOf(p), parts };
}

/** 수·범위: "3명", "3~4명", "8일 이상", "2번까지", "52시간 이하". */
function boundLabel(min: Bound | undefined, max: Bound | undefined, unit: string): Phrase {
  if (min && max) return min.n === max.n && min.name === max.name ? [num(min), unit] : [num(min), "~", num(max), unit];
  if (min) return [num(min), `${unit} 이상`];
  return [num(max!), unit === "시간" ? `${unit} 이하` : `${unit}까지`];
}

// --- 프리셋(변환표 모양) ---

const isNone = (s: CountShape) => s.max?.n === 0 && !s.min;

/** 휴가 모양: 한 사람 × 날짜에 근무 없음(per=person, not_in [O], 0번, 반드시). */
function isLeaveShape(s: Shape, hardness: string): boolean {
  return (
    s.kind === "count" &&
    hardness === "hard" &&
    s.per === "person" &&
    s.measure === "count" &&
    s.people.ids?.length === 1 &&
    sameSet(s.shifts.not_in, [OFF]) &&
    isNone(s)
  );
}

/** 가능하면 + 휴가 모양(휴무 말고 0번) = 휴무 희망. */
const isOffWish = (s: CountShape, hardness: string) => hardness === "soft" && sameSet(s.shifts.not_in, [OFF]) && isNone(s);

/** 희망·기피: 가능하면인 한 사람·기간 전체 세기에서 대상 날짜를 모두 맞추거나(min) 모두 피하는(0번) 모양. */
function isPreferenceShape(s: Shape, hardness: string): boolean {
  if (s.kind !== "count" || hardness !== "soft") return false;
  const bounded = isNone(s) || (!!s.min && !s.max);
  return s.per === "person" && s.measure === "count" && s.people.ids?.length === 1 && (!!s.shifts.in || isOffWish(s, hardness)) && bounded;
}

function shapeName(s: Shape, hardness: string): string {
  switch (s.kind) {
    case "count": {
      const hours = s.measure === "hours";
      if (s.per === "day") {
        if (hours) return "세는 규칙";
        if (noPeople(s.people)) return "필요 인원";
        const { ids, tags, exclude_tags } = s.people;
        if (!ids && !exclude_tags?.length && tags?.length) return "태그별 배치";
        return "세는 규칙";
      }
      if (isLeaveShape(s, hardness)) return "휴가";
      if (isPreferenceShape(s, hardness)) return "희망·기피 근무";
      if (hours) return "근무 시간";
      if (s.per === "person") return onlyIn(s.shifts, OFF) && noPeople(s.people) && noDays(s.days) && !s.max ? "최소 휴무 일수" : "근무 횟수";
      return onlyIn(s.shifts, OFF) ? "휴무 간격" : "세는 규칙";
    }
    case "forbid":
      return "금지 순서";
    case "off_after":
      return onlyIn(s.after, "C") ? "마감 다음 휴무" : "순서 규칙";
    case "max_run":
      return anyWork(s.run) ? "최대 연속 근무" : onlyIn(s.run, "C") ? "최대 연속 마감" : "순서 규칙";
    case "min_run":
      return onlyIn(s.run, "C") ? "최소 연속 마감" : "순서 규칙";
    case "balance":
      if (s.measure === "count" && noDays(s.days) && onlyIn(s.shifts, "C")) return "마감 고르게";
      if (s.measure === "count" && s.days.kind === "weekend" && !s.days.days && !s.days.weekdays && anyWork(s.shifts)) return "주말·공휴일 고르게";
      return "고르게 규칙";
  }
}

function describeCount(s: CountShape, hardness: string, config: ShopConfig, employees: Employee[], period: PeriodRange): Phrase {
  const who = peopleLabel(s.people, employees);
  const when = daysLabel(s.days, period);
  const shifts = shiftsLabel(s.shifts, config);
  if (isLeaveShape(s, hardness) || isPreferenceShape(s, hardness)) {
    const name = employeeLabel(s.people.ids![0], employees);
    const what = isLeaveShape(s, hardness) ? "휴무" : isOffWish(s, hardness) ? "휴무 희망" : `${shifts} ${isNone(s) ? "피하기" : "희망"}`;
    return [`${name} · ${when || "근무표 전체"} · ${what}`];
  }
  const hours = s.measure === "hours";
  const unit = hours ? "시간" : s.per === "day" ? "명" : onlyIn(s.shifts, OFF) ? "일" : "번";
  const what = hours ? (anyWork(s.shifts) ? "근무 시간" : `${shifts} 근무 시간`) : shifts;
  const none = isNone(s);
  const amount = none ? `${what} 없음` : words(what, boundLabel(s.min, s.max, unit));
  const everyone = who || "모든 사람";
  return s.per === "day"
    ? words(when ? `${when}마다` : "매일", who, amount)
    : s.per === "person"
      ? words(everyone, when || (none ? "" : "근무표마다"), amount)
      : words(everyone, s.per === "person_week" ? "주마다" : `${s.window}일마다`, when, amount);
}

function describeShape(s: Shape, hardness: string, config: ShopConfig, employees: Employee[], period: PeriodRange): Phrase {
  const label = (x: Selector) => shiftsLabel(x, config);
  switch (s.kind) {
    case "count":
      return describeCount(s, hardness, config, employees, period);
    case "balance": {
      const what = s.measure === "hours" ? "근무 시간" : anyWork(s.shifts) ? "근무 수" : `${label(s.shifts)} 수`;
      const history = s.with_history ? "(최근 4주 포함)" : "";
      const gap = hardness === "hard" ? [" · 차이 ", num(s.max_gap), " 이하"] : [];
      return [...words(peopleLabel(s.people, employees), daysLabel(s.days, period), `${what}${josa(what, "을", "를")} 고르게`), history, ...gap];
    }
  }
  let text: Phrase;
  if (s.kind === "forbid") {
    const p = s.pattern;
    text = [`${p.length === 2 ? `${label(p[0])} 다음 날 ${label(p[1])}` : p.map(label).join(" → ")} 금지`];
  } else if (s.kind === "off_after") {
    text = [`${label(s.after)} 다음 날은 휴무 ${s.then_off}일`];
  } else if (s.kind === "max_run") {
    text = anyWork(s.run) ? ["연속 근무 ", num(s.max_len), "일까지"] : [`${label(s.run)} 연속 `, num(s.max_len), "일까지"];
  } else {
    const run = label(s.run);
    text = [`${run}${josa(run, "은", "는")} ${s.min_len}일 이상씩 이어서`];
  }
  return words(peopleLabel(s.people, employees), text);
}

// --- 일반 틀: "[범위]마다, [when]이면 [then]" ---

type Cond = Cmp | { all: Cmp[] } | { any: Cmp[] };
type RequireBody = Extract<Rule["body"], { kind: "require" }>;

/** 날짜 이동: "다음 날", "전날", "다음 3일", "앞 2일", "2일 뒤". 그날이면 "". */
function offsetLabel(offset: Count["offset"]): string {
  const [a, b] = (offset ?? [0, 0]) as number[];
  if (a === 0 && b === 0) return "";
  if (a === b) return a === 1 ? "다음 날" : a === -1 ? "전날" : a > 0 ? `${a}일 뒤` : `${-a}일 전`;
  if (a === 1) return `다음 ${b}일`;
  if (b === -1) return `앞 ${-a}일`;
  if (a === 0) return `그날부터 ${b + 1}일`;
  if (b === 0) return `${-a}일 전부터 그날까지`;
  if (a < 0 && b > 0) return `${-a}일 전부터 ${b}일 뒤까지`;
  return a > 0 ? `${a}~${b}일 뒤` : `${-b}~${-a}일 전`;
}

function countPhrase(c: Count, config: ShopConfig, employees: Employee[], period: PeriodRange): string {
  const shifts = shiftsLabel(c.shifts, config);
  const what = c.measure === "hours" ? (anyWork(c.shifts) ? "근무 시간" : `${shifts} 근무 시간`) : shifts;
  return textOf(words(offsetLabel(c.offset), peopleLabel(c.who, employees), daysLabel(c.days, period), what));
}

function cmpPhrase(c: Cmp, per: string, values: Rule["values"], config: ShopConfig, employees: Employee[], period: PeriodRange): Phrase {
  const left = countPhrase(c.left, config, employees, period);
  const OPS = { ge: "이상", le: "이하" } as const;
  if (typeof c.right === "object" && "shifts" in c.right) {
    const right = countPhrase(c.right, config, employees, period);
    if (c.op === "eq") return [`${left}${josa(left, "과", "와")} ${right}${josa(right, "이", "가")} 같음`];
    return [`${left}${josa(left, "이", "가")} ${right} ${OPS[c.op]}`];
  }
  const ref = typeof c.right === "number" ? null : c.right.value;
  const bound: Bound = ref ? { n: values?.[ref]?.value ?? 0, name: ref } : { n: c.right as number };
  if (c.op === "eq" && bound.n === 0 && !ref) return [`${left} 없음`];
  const unit = c.left.measure === "hours" ? "시간" : per === "day" && !c.left.offset ? "명" : onlyIn(c.left.shifts, OFF) ? "일" : "번";
  return words(left, [num(bound), c.op === "eq" ? unit : `${unit} ${OPS[c.op]}`]);
}

function condPhrase(c: Cond, per: string, values: Rule["values"], config: ShopConfig, employees: Employee[], period: PeriodRange): Phrase {
  const one = (x: Cmp) => cmpPhrase(x, per, values, config, employees, period);
  if ("all" in c) return joined(" 그리고 ", ...c.all.map(one));
  if ("any" in c) return joined(" 또는 ", ...c.any.map(one));
  return one(c);
}

/** 조건 문장 끝을 "~이면"으로: "없음" → "없으면", "같음" → "같으면". */
function ifPhrase(p: Phrase): Phrase {
  const last = p.at(-1);
  if (typeof last === "string" && /(없음|같음)$/.test(last)) return [...p.slice(0, -1), last.replace(/음$/, "으면")];
  return [...p, "이면"];
}

function scopeLabel(fe: RequireBody["for_each"], employees: Employee[], period: PeriodRange): string {
  const who = peopleLabel(fe.people, employees) || "모든 사람";
  const days = daysLabel(fe.days, period);
  switch (fe.per) {
    case "period":
      return words("근무표 전체", days && `${days} 중`).map(segText).join("");
    case "day":
      return days ? `${days}마다` : "매일";
    case "person":
      return textOf(words(`${who}마다`, days && `${days} 중`));
    case "person_day":
      return `${who} · ${days ? `${days}마다` : "날마다"}`;
    case "person_week":
      return textOf(words(`${who} · 주마다`, days && `${days} 중`));
    case "person_window":
      return textOf(words(`${who} · ${fe.window}일마다`, days && `${days} 중`));
  }
}

function describeGeneric(r: Rule, config: ShopConfig, employees: Employee[], period: PeriodRange): Phrase {
  const b = r.body as RequireBody;
  const per = b.for_each.per;
  const then = condPhrase(b.then as Cond, per, r.values, config, employees, period);
  const scope = scopeLabel(b.for_each, employees, period);
  if (!b.when) return words(scope, then);
  return [`${scope}, `, ...ifPhrase(condPhrase(b.when as Cond, per, r.values, config, employees, period)), " ", ...then];
}

const hasOffset = (b: RequireBody) => [b.when, b.then].flatMap((c) => (!c ? [] : "all" in c ? c.all : "any" in c ? c.any : [c])).some((c) => c.left.offset || (typeof c.right === "object" && "shifts" in c.right && c.right.offset));

/** 카드 제목: 변환표 모양의 이름. 맞는 이름이 없으면 조건 규칙(when)·순서 규칙(날짜 이동)·세는 규칙·고르게 규칙. */
export function presetName(c: ConstraintSpec): string {
  if (c.type === "fixed_assignment") return "고정 근무";
  const s = ruleShape(c);
  if (s) return shapeName(s, c.hardness ?? (c.body.kind === "balance" ? "soft" : "hard"));
  if (c.body.kind === "balance") return "고르게 규칙";
  if (c.body.when) return "조건 규칙";
  return hasOffset(c.body) ? "순서 규칙" : "세는 규칙";
}

/**
 * 카드 해석 결과(설계 §5). 변환표 모양은 블록 시절 문장 그대로, 그 밖은 "[범위]마다, [when]이면 [then]".
 * 휴가·희망·기피·고정은 "이름 · 날짜 · 근무" 모양. 근무 이름은 config의 name, 내부 id와 코드만 있는 표기를 쓰지 않는다.
 * 조정 가능한 값은 parts에 이름과 함께 따로 나온다.
 */
export function describeRule(c: ConstraintSpec, config: ShopConfig, employees: Employee[], period: PeriodRange): RuleSentence {
  if (c.type === "fixed_assignment") {
    const { employee_id, day, shift } = c.params;
    return sentence([`${employeeLabel(employee_id, employees)} · ${monthDay(period, day)} · ${shiftName(shift, config)} 고정`]);
  }
  const s = ruleShape(c);
  if (s) return sentence(describeShape(s, c.hardness ?? (c.body.kind === "balance" ? "soft" : "hard"), config, employees, period));
  return sentence(describeGeneric(normalizeRule(c) as Rule, config, employees, period));
}

/** 매장 규칙 수. 필요 인원은 세지 않는다. */
export function shopRuleCount(rules: ConstraintSpec[]): number {
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
  | { kind: "drafting"; name: string }
  | { kind: "generated"; name: string }
  | { kind: "confirmed"; name: string; confirmedAt: string };

export function nextTask(shop: Shop, periods: WorkPeriod[], today: string): NextTask {
  const { next } = homeSummary(periods, today);
  if (next.state === "none") return { kind: "none", name: scheduleName(upcomingRange(shop.unit, periods, today), shop.unit) };
  const p = next.period;
  const name = scheduleName(p, shop.unit);
  if (next.state === "confirmed") return { kind: "confirmed", name, confirmedAt: p.versions.at(-1)?.confirmed_at ?? "" };
  return p.result ? { kind: "generated", name } : { kind: "drafting", name };
}

/** 홈 지금 할 일 카드의 진행 단계. */
export const TASK_STEPS = ["가능 시간", "매장 조건", "근무표", "확정"] as const;

/** 지금 할 일 카드에서 끝난 단계 수. */
export function taskDoneSteps(task: NextTask): number {
  switch (task.kind) {
    case "none":
    case "drafting":
      return 0;
    case "generated":
      return 3;
    case "confirmed":
      return 4;
  }
}
