// 수동 테스트용 시드(순수 함수). 직원 10명 매장의 가능 시간 버전 5가지. 넣는 일은 scripts/seed.ts가 한다.
import type { AvailabilitySlots, TimeRange } from "./availability";
import { dateOfDay, firstPeriodStart, periodFrom } from "./period";
import { STORAGE_VERSION } from "./rules";
import sample from "./samples/shop-12.json";
import { newPeriod, type Shop, type ShopEmployee, type WorkPeriod } from "./store";
import type { ConstraintSpec, Rule, ShopConfig } from "./types.gen";

export const SEED_SCENARIOS = ["relaxed", "realistic", "tight", "impossible", "partial"] as const;
export type SeedScenario = (typeof SEED_SCENARIOS)[number];

export const SEED_LABELS: Record<SeedScenario, string> = {
  relaxed: "여유",
  realistic: "현실",
  tight: "빠듯",
  impossible: "불가능",
  partial: "미제출",
};

const ROSTER: [string, string[]][] = [
  ["이영희", ["리더"]],
  ["박민수", []],
  ["김철수", []],
  ["정유진", []],
  ["최지훈", []],
  ["강서연", ["리더"]],
  ["윤지민", ["리더"]],
  ["임하늘", []],
  ["서예린", ["신입"]],
  ["신도윤", ["신입"]],
];

const employeeId = (no: number) => `e${String(no).padStart(2, "0")}`;
const ID_BY_NAME = Object.fromEntries(ROSTER.map(([name], i) => [name, employeeId(i + 1)]));

const FULL: TimeRange = ["09:00", "23:00"];
const OPEN: TimeRange = ["09:00", "15:00"];
const DAY: TimeRange = ["09:00", "18:00"];
const EVENING: TimeRange = ["17:00", "23:00"];
const AFTERNOON: TimeRange = ["12:00", "23:00"];

/** 월~일 7칸의 가능 시간. null은 안 되는 날. */
type Week = (TimeRange | null)[];
const weekdays = (weekday: TimeRange | null, sat: TimeRange | null, sun: TimeRange | null): Week => [
  weekday,
  weekday,
  weekday,
  weekday,
  weekday,
  sat,
  sun,
];
const everyDay = (range: TimeRange): Week => Array<TimeRange>(7).fill(range);

const REALISTIC: Record<string, Week> = {
  이영희: weekdays(DAY, FULL, null),
  박민수: weekdays(EVENING, FULL, FULL), // 학생
  김철수: everyDay(FULL),
  정유진: weekdays(OPEN, null, null), // 오전만
  최지훈: weekdays(AFTERNOON, AFTERNOON, null),
  강서연: [FULL, null, null, FULL, FULL, FULL, FULL],
  윤지민: [null, null, FULL, FULL, FULL, FULL, FULL],
  임하늘: [EVENING, null, EVENING, null, null, FULL, FULL], // 주말 위주
  서예린: [null, DAY, null, DAY, null, DAY, DAY],
  신도윤: [FULL, null, null, null, EVENING, EVENING, EVENING],
};

const TIGHT_CLOSERS = ["박민수", "김철수", "최지훈"];
const PARTIAL_MISSING = ["임하늘", "서예린", "신도윤"];
const SATURDAY = 5; // Week의 인덱스
const IMPOSSIBLE_SATURDAY_CLOSER = "김철수";

function weekFor(name: string, scenario: SeedScenario): Week | null {
  switch (scenario) {
    case "relaxed":
      return everyDay(FULL);
    case "realistic":
      return REALISTIC[name];
    case "tight":
      return everyDay(TIGHT_CLOSERS.includes(name) ? FULL : DAY);
    case "impossible": {
      const week = everyDay(FULL);
      if (name !== IMPOSSIBLE_SATURDAY_CLOSER) week[SATURDAY] = DAY;
      return week;
    }
    case "partial":
      return PARTIAL_MISSING.includes(name) ? null : everyDay(FULL);
  }
}

/** 10명 매장에 맞춘 필요 인원. 12명 샘플의 값을 바꾸고 문구도 맞춘다. */
const COVERAGE_MIN: Record<string, [number, string]> = {
  "cov-weekday-C": [2, "평일 마감은 2명"],
  "cov-weekend-M": [1, "주말 미들은 1명"],
  "cov-weekend-C": [2, "주말 마감은 2명"],
};

function seedRules(): ConstraintSpec[] {
  return (sample.constraints as unknown as Rule[]).map((rule) => {
    const coverage = COVERAGE_MIN[rule.id];
    if (!coverage) return rule;
    const [min, source_text] = coverage;
    const values = { ...rule.values, min: { ...rule.values!.min, value: min } };
    return { ...rule, source_text, values };
  });
}

export interface SeedDoc {
  version: number;
  state: { shop: Shop; periods: WorkPeriod[]; view: { screen: "home" }; inputVersion: number };
}

/** 저장 문서와 직원 id별 가능 시간. slots에 없는 직원은 미제출이다. */
export function buildScenario(scenario: SeedScenario, today: string): { doc: SeedDoc; slots: Record<string, AvailabilitySlots> } {
  const employees: ShopEmployee[] = ROSTER.map(([name, tags]) => ({ id: ID_BY_NAME[name], name, tags, active: true }));
  const shop: Shop = {
    name: `테스트 매장 (${SEED_LABELS[scenario]})`,
    unit: "1w",
    config: sample.config as unknown as ShopConfig,
    employees,
    nextEmployeeNo: employees.length + 1,
    rules: seedRules(),
    pendingRules: [],
    pendingConfig: [],
    unconverted: [],
  };
  const range = periodFrom("1w", firstPeriodStart("1w", today));

  const slots: Record<string, AvailabilitySlots> = {};
  for (const [name] of ROSTER) {
    const week = weekFor(name, scenario);
    if (!week) continue;
    const days = week.flatMap((time, i): [string, TimeRange[]][] => (time ? [[dateOfDay(range, i + 1), [time]]] : []));
    slots[ID_BY_NAME[name]] = Object.fromEntries(days) as AvailabilitySlots;
  }

  return {
    doc: { version: STORAGE_VERSION, state: { shop, periods: [newPeriod(range)], view: { screen: "home" }, inputVersion: 0 } },
    slots,
  };
}
