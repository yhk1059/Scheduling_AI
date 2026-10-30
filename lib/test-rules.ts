// 테스트용 식 규칙(backend/tests/rules.py와 같은 모양). 앱 코드에서 쓰지 않는다.
import { normalizeRule } from "./rules";
import type { Cmp, ConstraintSpec, Count, Days, People, Rule, Shifts, ShopConfig, Value } from "./types.gen";

type Over = Partial<Omit<Rule, "type" | "body" | "values">> & { type?: never };
type Body = Rule["body"];
type Cond = Cmp | { all: Cmp[] } | { any: Cmp[] };
/** 코드 이름이 뜻을 갖지 않는 테스트용 근무 형태. N이 가장 늦게 끝난다. */
export const DEN_CONFIG: ShopConfig = {
  shifts: [
    { code: "D", name: "데이", hours: 8, start: "07:00", end: "15:00" },
    { code: "E", name: "이브닝", hours: 8, start: "15:00", end: "23:00" },
    { code: "N", name: "나이트", hours: 8, start: "16:00", end: "24:00" },
    { code: "O", name: "휴무", hours: 0 },
  ],
};

export const OFF: Shifts = { in: ["O"] };
export const WORK: Shifts = { not_in: ["O"] };

function rule(body: Body, values: Record<string, Value>, over: Over): ConstraintSpec {
  return normalizeRule({ id: "r", type: "rule", scope: "shop", source_text: "", ...over, values, body } as ConstraintSpec);
}

const cnt = (shifts: Shifts, offset?: [number, number], extra: Partial<Count> = {}): Count => ({ ...extra, ...(offset && { offset }), shifts });
const cmp = (left: Count, op: Cmp["op"], right: Cmp["right"]): Cmp => ({ left, op, right });
const require = (for_each: Extract<Body, { kind: "require" }>["for_each"], then: Cond, when?: Cond): Body =>
  ({ kind: "require", for_each, then, ...(when && { when }) }) as Body;
const flip = (s: Shifts): Shifts => (s.in ? { not_in: s.in } : { in: s.not_in! });

interface CountSpec {
  people?: People;
  days?: Days;
  shifts: Shifts;
  per: "day" | "person" | "person_week" | "person_window";
  window?: number;
  measure?: "hours";
  min?: number;
  max?: number;
}

function countNoun({ measure, per, shifts }: CountSpec): string {
  if (measure === "hours") return "근무 시간";
  if (per === "day") return "인원";
  return shifts.in?.length === 1 && shifts.in[0] === "O" ? "휴무 일수" : "횟수";
}

/** 세기: 범위(per)마다 고른 칸의 수(또는 근무 시간)가 min~max. per=day면 people은 세는 사람, 아니면 묶는 사람. */
export function count(p: CountSpec, over: Over = {}): ConstraintSpec {
  const noun = countNoun(p);
  const left = cnt(p.shifts, undefined, {
    ...(p.measure && { measure: p.measure }),
    ...(p.per === "day" && p.people && { who: p.people }),
  });
  const forEach =
    p.per === "day" ? { per: p.per, days: p.days } : { per: p.per, people: p.people, days: p.days, ...(p.window && { window: p.window }) };
  const values: Record<string, Value> = {};
  const cmps: Cmp[] = [];
  if (p.min !== undefined && p.min === p.max) {
    values.min = { value: p.min, label: noun };
    cmps.push(cmp(left, "eq", { value: "min" }));
  } else {
    if (p.min !== undefined) {
      values.min = { value: p.min, label: `최소 ${noun}` };
      cmps.push(cmp(left, "ge", { value: "min" }));
    }
    if (p.max !== undefined) {
      values.max = { value: p.max, label: `최대 ${noun}` };
      cmps.push(cmp(left, "le", { value: "max" }));
    }
  }
  return rule(require(forEach, cmps.length === 1 ? cmps[0] : ({ all: cmps } as Cond)), values, over);
}

/** 금지 순서: 연속한 날의 근무 패턴. */
export function forbid(pattern: Shifts[], people?: People, over: Over = {}): ConstraintSpec {
  return rule(require({ per: "person_day", people }, { any: pattern.map((s, i) => cmp(cnt(s, [i, i]), "eq", 0)) } as Cond), {}, over);
}

/** 최대 연속: 창 max_len + 1일 안에 max_len번까지. */
export function maxRun(run: Shifts, max_len: number, people?: People, over: Over = {}): ConstraintSpec {
  const noun = run.in?.length === 1 && run.in[0] === "N" ? "나이트" : run.not_in?.length === 1 && run.not_in[0] === "O" ? "근무" : "일수";
  return rule(require({ per: "person_window", people, window: max_len + 1 }, cmp(cnt(run), "le", { value: "max_len" })), { max_len: { value: max_len, label: `최대 연속 ${noun}` } }, over);
}

/** 최소 연속: 전날 S 아님 ∧ 그날 S → 다음 min_len−1일 S 아님. */
export function minRun(run: Shifts, min_len: number, over: Over = {}): ConstraintSpec {
  const when = { all: [cmp(cnt(flip(run), [-1, -1]), "ge", 1), cmp(cnt(run, [0, 0]), "ge", 1)] } as Cond;
  return rule(require({ per: "person_day" }, cmp(cnt(flip(run), [1, min_len - 1]), "eq", 0), when), {}, over);
}

/** 다음 휴무: 그날 after ∧ 다음 날 after 아님 → 다음 then_off일 휴무. */
export function offAfter(after: Shifts, then_off: number, over: Over = {}): ConstraintSpec {
  const when = { all: [cmp(cnt(after, [0, 0]), "ge", 1), cmp(cnt(flip(after), [1, 1]), "ge", 1)] } as Cond;
  return rule(require({ per: "person_day" }, cmp(cnt(WORK, [1, then_off]), "eq", 0), when), {}, over);
}

/** 고르게: 기본은 가능하면·낮음. */
export function balance(
  p: { people?: People; days?: Days; shifts: Shifts; measure?: "hours"; with_history?: boolean; max_gap?: number },
  over: Over = {},
): ConstraintSpec {
  const { max_gap = 1, ...rest } = p;
  return rule({ kind: "balance", ...rest, max_gap: { value: "max_gap" } } as Body, { max_gap: { value: max_gap, label: "최대 차이" } }, over);
}

/** 칸 고정. */
export function fixedCell(employee_id: string, day: number, shift: string, over: { id?: string; weight?: number } = {}): ConstraintSpec {
  return normalizeRule({ id: "f", type: "fixed_assignment", scope: "period", source_text: "", ...over, params: { employee_id, day, shift } } as ConstraintSpec);
}

