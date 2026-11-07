// 한강 다이닝 시나리오 데이터(docs/DEMO_SCENARIO.md). 데모 영상 녹화(record-dining.ts)와 체험 데이터 생성(gen-demo-shop.ts)이 같이 쓴다.
// Playwright·Supabase를 import하지 않는다(vitest에서 바로 쓴다).
import { dateOfDay, type PeriodRange } from "../lib/period";

export const SHOP_NAME = "한강 다이닝";

export type Hours = [string, string] | null;
const F: Hours = ["09:00", "21:00"];
const AM: Hours = ["09:00", "16:00"];
const PM: Hours = ["16:00", "21:00"];
const E20: Hours = ["09:00", "20:00"];
const N: Hours = null;
/** 평일 같고 토·일만 다른 주 */
const wk = (weekday: Hours, sat: Hours, sun: Hours): Hours[] => [weekday, weekday, weekday, weekday, weekday, sat, sun];
const all = (h: Hours): Hours[] => Array<Hours>(7).fill(h);

/** 시나리오의 직원 20명. 화면에서 천천히 입력하는 3명을 맨 앞에 둔다. week는 월~일 가능 시간. */
export const ROSTER: { name: string; tags: string[]; week: Hours[] }[] = [
  { name: "김도현", tags: ["홀", "리더"], week: all(F) },
  { name: "서민호", tags: ["주방", "리더"], week: [F, N, F, F, F, N, N] },
  { name: "오지훈", tags: ["홀", "신입"], week: wk(PM, F, N) },
  { name: "이수진", tags: ["홀", "리더"], week: wk(F, N, N) },
  { name: "박준영", tags: ["홀", "리더"], week: [N, N, F, F, F, F, F] },
  { name: "최민지", tags: ["홀"], week: all(F) },
  { name: "정하늘", tags: ["홀"], week: wk(AM, N, N) },
  { name: "강태호", tags: ["홀"], week: [N, F, F, F, F, F, F] },
  { name: "윤서아", tags: ["홀"], week: wk(PM, F, F) },
  { name: "임재원", tags: ["홀"], week: [F, N, F, N, F, F, F] },
  { name: "한유나", tags: ["홀"], week: [N, N, N, F, F, F, F] },
  { name: "신예은", tags: ["홀", "신입"], week: [N, E20, N, E20, N, E20, E20] },
  { name: "배지수", tags: ["주방", "리더"], week: [N, N, F, F, F, F, F] },
  { name: "조현우", tags: ["주방", "리더"], week: all(AM) },
  { name: "송다은", tags: ["주방"], week: all(F) },
  { name: "류승현", tags: ["주방"], week: [F, F, F, F, F, F, N] },
  { name: "문가영", tags: ["주방"], week: wk(PM, F, F) },
  { name: "권태윤", tags: ["주방"], week: [N, F, F, F, F, F, F] },
  { name: "홍채원", tags: ["주방", "신입"], week: [F, N, F, N, F, N, F] },
  { name: "양시우", tags: ["주방", "신입"], week: wk(PM, F, F) },
];
export const TYPED_STAFF = ["김도현", "서민호", "오지훈"];
/** 직원 화면에서 가능 시간을 직접 칠하는 사람. 화요일을 비운다. */
export const SCREEN_EMPLOYEE = "서민호";

/** ②에서 직접 입력하는 문장. 나머지는 미리 번역해 적용해 둔다. */
export const LIVE_SENTENCES = ["홀은 평일에 오픈 2명, 미들 1명, 마감 3명", "홀 마감과 주방 마감에는 리더가 꼭 1명씩 있어야 해"];
export const PRESET_SENTENCES = [
  "홀은 주말에 오픈 2명, 미들 2명, 마감 4명",
  "주방은 평일에 오픈 2명, 미들 1명, 마감 2명",
  "주방은 주말에 오픈 2명, 미들 1명, 마감 3명",
  "마감 다음 날 오픈은 안 되게",
  "일주일에 이틀은 꼭 쉬게",
  "마감에는 파트별로 신입이 1명까지만",
  "마감은 파트 안에서 돌아가면서 고르게",
  "근무 일수도 고르게",
];

/** 체험(/demo)용 매장 조건. 영상보다 적게 둔다: 평일·주말을 나누지 않고 신입·순환 규칙은 뺀다(카드 22장 → 12장). 해 없음 원인(화요일에 마감 가능한 주방 리더 없음)은 같다. */
export const DEMO_LIVE_SENTENCES = ["홀은 오픈 2명, 미들 1명, 마감 3명", "홀 마감과 주방 마감에는 리더가 꼭 1명씩 있어야 해"];
export const DEMO_PRESET_SENTENCES = ["주방은 오픈 2명, 미들 1명, 마감 2명", "마감 다음 날 오픈은 안 되게", "일주일에 이틀은 꼭 쉬게"];

/** 근무조 시간 바꾸기(장면 3): 기본 근무조의 끝 시각과 실근무 시간 */
export const SHIFT_EDITS = [
  { code: "A", end: "14:00", hours: "5" },
  { code: "M", end: "16:00", hours: "4" },
  { code: "C", end: "21:00", hours: "4" },
];

/** 월~일 가능 시간 → 날짜별 슬롯. 불가인 날은 뺀다. */
export function slotsFor(week: Hours[], period: PeriodRange): Record<string, [string, string][]> {
  return Object.fromEntries(week.flatMap((h, i) => (h ? [[dateOfDay(period, i + 1), [h]]] : [])));
}

