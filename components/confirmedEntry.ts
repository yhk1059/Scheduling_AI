// 확정 근무표 화면으로 들어오는 경로. 화면 상태(view)에 남기지 않는 한 번짜리 표시다.
// "change": 홈 운영 중 카드 [변경 입력] → 변경 입력 바에 포커스. "guest-confirmed": 게스트의 첫 확정 → 저장 안내 배너.
export type ConfirmedEntry = "change" | "guest-confirmed";

let pending: { periodId: string; entry: ConfirmedEntry } | null = null;

export function markConfirmedEntry(periodId: string, entry: ConfirmedEntry) {
  pending = { periodId, entry };
}

/** 이 기간으로 들어온 경로를 꺼내고 지운다. */
export function takeConfirmedEntry(periodId: string): ConfirmedEntry | null {
  const found = pending?.periodId === periodId ? pending.entry : null;
  pending = null;
  return found;
}
