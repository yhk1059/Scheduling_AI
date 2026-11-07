// 랜딩 [체험하기](/demo)의 데이터. 저장한 체험 문서(lib/samples/demo-shop.json)를 오늘 기준 주로 옮기고,
// LLM을 부르지 않도록 저장한 해 없음 설명을 요청이 같을 때만 돌려준다. 순수 함수만 둔다.
import { isAvailabilityRule, type AvailabilitySlots } from "./availability";
import { dateOfDay, dayOfDate, firstPeriodStart, periodFrom, type PeriodRange } from "./period";
import { stableJson } from "./rules";
import { newPeriod, withDefaultRules, type Data, type Shop, type ShopEmployee } from "./store";
import type { AvailabilityLink } from "./supabase";
import type { ExplainResponse, ScheduleRequest } from "./types.gen";

/** lib/samples/demo-shop.json의 모양(step 1이 만든다). 날짜는 기준 주 base에 묶여 있고, 체험할 때 오늘 기준으로 옮긴다. */
export interface DemoDoc {
  /** STORAGE_VERSION. 다르면 쓰지 않는다 */
  version: number;
  /** 규칙 8문장은 rules에 적용된 상태, 2문장은 pendingRules(예시 판정은 shop.examples) */
  shop: Shop;
  /** 기준 주. 월요일 시작, length 7 */
  base: PeriodRange;
  /** 직원 id → 기준 주 날짜별 가능 시간. 제출한 직원만 있다 */
  availability: Record<string, AvailabilitySlots>;
  /** 대기 카드를 모두 적용한 기준 상태에서 /solve가 해 없음일 때의 /explain 응답. signature는 그 요청의 requestSignature */
  explanation: { signature: string; response: Omit<ExplainResponse, "input_version"> } | null;
}

/** 기준 주의 날짜 키를 range의 같은 인덱스 날짜로 옮긴다. 기준 주 밖의 키는 버린다. */
function shiftSlots(slots: AvailabilitySlots, base: PeriodRange, range: PeriodRange): AvailabilitySlots {
  return Object.fromEntries(
    Object.entries(slots).flatMap(([date, ranges]) => {
      const day = dayOfDate(base, date);
      return day === null ? [] : [[dateOfDay(range, day), ranges]];
    }),
  );
}

/**
 * 체험 시작 상태. 기준 주를 firstPeriodStart("1w", today)로 옮긴다(오늘이 월요일이면 오늘).
 * 공휴일은 빈 배열. 가능 시간의 날짜 키는 같은 요일로 옮기고 기준 주 밖의 키는 버린다.
 * 화면은 ② 매장 조건({ screen: "period", periodId, step: 2 }), inputVersion 0.
 */
export function demoData(doc: DemoDoc, today: string): Data {
  const range = periodFrom("1w", firstPeriodStart("1w", today));
  const availability = Object.fromEntries(
    Object.entries(doc.availability).map(([id, slots]) => [id, shiftSlots(slots, doc.base, range)]),
  );
  // 공휴일이 끼면 주말 필요 인원이 달라져 시나리오가 깨진다
  const period = { ...newPeriod(range), holidays: [], availability, availabilityUsed: null };
  return {
    shop: withDefaultRules(doc.shop),
    periods: [period],
    view: { screen: "period", periodId: period.id, step: 2 },
    inputVersion: 0,
  };
}

/** 요청의 규칙 제약(type "rule", enabled !== false, avail- 제외)만 id 순으로 정렬해 stableJson한 문자열. */
export function requestSignature(req: Omit<ScheduleRequest, "input_version">): string {
  // 가능 시간 규칙은 날짜마다 id·내용이 바뀌므로 넣지 않는다
  const rules = (req.constraints ?? [])
    .filter((c) => c.type === "rule" && c.enabled !== false && !isAvailabilityRule(c.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return stableJson(rules);
}

/** 저장된 설명이 이 요청의 signature와 같으면 input_version을 붙여 돌려준다. 아니면 null. */
export function demoExplanation(
  doc: DemoDoc,
  req: Omit<ScheduleRequest, "input_version">,
  inputVersion: number,
): ExplainResponse | null {
  if (!doc.explanation || doc.explanation.signature !== requestSignature(req)) return null;
  return { ...doc.explanation.response, input_version: inputVersion };
}

/** ①과 매장 홈이 링크 행 대신 쓰는 제출 현황. 가능 시간이 있는 직원은 submitted_at = submittedAt, 없으면 null. token은 빈 문자열. */
export function demoLinkRows(
  availability: Record<string, AvailabilitySlots>,
  employees: ShopEmployee[],
  submittedAt: string,
): AvailabilityLink[] {
  return employees.map((e) => {
    const slots = availability[e.id];
    return { token: "", employee_id: e.id, slots: slots ?? {}, submitted_at: slots ? submittedAt : null };
  });
}
