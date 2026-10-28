// 샘플 병동(PRD J7): 오늘이 속한 달은 확정(운영 중), 다음 달은 요청이 적용된 초안. 솔버를 부르지 않는다.
import { dateOfDay, nextPeriod, periodDays, periodFrom, type PeriodRange } from "./period";
import confirmedSchedules from "./samples/confirmed-schedules.json";
import sample from "./samples/ward-15.json";
import type { Ward, WorkPeriod } from "./store";
import type { ConstraintSpec, ScheduleResult } from "./types.gen";

const SAMPLE_WARD_NAME = "샘플 병동";
const SCHEDULES = confirmedSchedules as Record<string, ScheduleResult>;

function emptyPeriod(range: PeriodRange, id: string): WorkPeriod {
  return {
    ...range,
    id,
    holidays: sample.holidays,
    requests: [],
    pendingRequests: [],
    disabledIds: [],
    ruleOverrides: {},
    carryOver: [],
    carryOverUsed: null,
    result: null,
    resultVersion: null,
    status: "draft",
    versions: [],
    snapshot: null,
  };
}

/** confirmed-schedules.json 키: "{길이}-{1일 요일(월=0)}". */
function shapeKey(range: PeriodRange): string {
  return `${range.length}-${(periodDays(range)[0].weekday + 6) % 7}`;
}

export function buildSample(today: string, makeId: () => string): { ward: Ward; periods: WorkPeriod[] } {
  const nurses = sample.nurses.map((n) => ({ ...n, active: true }));
  const rules = sample.constraints as ConstraintSpec[];
  const ward: Ward = {
    name: SAMPLE_WARD_NAME,
    unit: "month",
    nurses,
    nextNurseNo: nurses.length + 1,
    rules,
    pendingRules: [],
    isSample: true,
  };

  const current = periodFrom("month", `${today.slice(0, 8)}01`);
  const result = SCHEDULES[shapeKey(current)];
  const operating: WorkPeriod = {
    ...emptyPeriod(current, makeId()),
    carryOverUsed: [],
    result,
    status: "confirmed",
    // 시작 전날 18:00 KST에 확정한 것으로 둔다
    versions: [{ confirmed_at: `${dateOfDay(current, 0)}T09:00:00.000Z`, assignments: result.assignments, changed: [] }],
    snapshot: { nurses, rules },
  };
  const next: WorkPeriod = {
    ...emptyPeriod(nextPeriod("month", current), makeId()),
    requests: sample.next_requests as ConstraintSpec[],
  };
  return { ward, periods: [operating, next] };
}
