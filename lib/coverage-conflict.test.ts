import { describe, expect, it } from "vitest";

import { count, forbid } from "./test-rules";
import { coverageBounds, coverageDays, effectiveCoverage, findCoverageConflict } from "./coverage-conflict";
import type { PeriodRange } from "./period";
import type { ConstraintSpec, Days, Shifts } from "./types.gen";

const A: Shifts = { in: ["A"] };
const C: Shifts = { in: ["C"] };
// 2026-11-02(월) ~ 11-08(일): 6, 7일이 토·일
const WEEK: PeriodRange = { start_date: "2026-11-02", length: 7 };

function cov(id: string, days: Days, shifts: Shifts, min?: number, max?: number, over: Partial<ConstraintSpec> = {}): ConstraintSpec {
  return count({ per: "day", days, shifts, min, max }, { id, default: true, ...over } as never);
}

describe("coverageBounds", () => {
  it("정확히 n명은 min = max", () => {
    expect(coverageBounds(cov("a", { kind: "all" }, A, 1, 1))).toEqual({ min: 1, max: 1 });
  });
  it("이상만 있으면 max null", () => {
    expect(coverageBounds(cov("a", { kind: "weekend" }, A, 2))).toEqual({ min: 2, max: null });
  });
  it("이하만 있으면 min 0", () => {
    expect(coverageBounds(cov("a", { kind: "all" }, A, undefined, 3))).toEqual({ min: 0, max: 3 });
  });
  it("범위", () => {
    expect(coverageBounds(cov("a", { kind: "all" }, A, 1, 3))).toEqual({ min: 1, max: 3 });
  });
  it("필요 인원 모양이 아니면 null", () => {
    expect(coverageBounds(forbid([C, A]))).toBeNull();
    expect(coverageBounds(count({ per: "person", shifts: A, max: 3 }))).toBeNull();
    expect(coverageBounds(count({ per: "day", people: { tags: ["리더"] }, shifts: A, min: 1 }))).toBeNull();
    expect(coverageBounds({ ...cov("a", { kind: "all" }, A, 1), scope: "period" })).toBeNull();
  });
});

describe("coverageDays", () => {
  it("주말 + 공휴일", () => {
    expect(coverageDays({ kind: "weekend" }, WEEK, [4])).toEqual([4, 6, 7]);
  });
  it("평일은 공휴일을 뺀다", () => {
    expect(coverageDays({ kind: "weekday" }, WEEK, [4])).toEqual([1, 2, 3, 5]);
  });
  it("공휴일만", () => {
    expect(coverageDays({ kind: "holiday" }, WEEK, [4])).toEqual([4]);
  });
  it("전체와 생략", () => {
    expect(coverageDays({ kind: "all" }, WEEK, [])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(coverageDays(undefined, WEEK, [])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("요일(0=월)과 날짜는 교집합", () => {
    expect(coverageDays({ weekdays: [5, 6] }, WEEK, [])).toEqual([6, 7]);
    expect(coverageDays({ days: [1, 6] }, WEEK, [])).toEqual([1, 6]);
    expect(coverageDays({ weekdays: [0], days: [1, 6] }, WEEK, [])).toEqual([1]);
    expect(coverageDays({ kind: "weekday", days: [3, 6] }, WEEK, [])).toEqual([3]);
  });
});

describe("findCoverageConflict", () => {
  const daily1 = cov("old", { kind: "all" }, A, 1, 1);
  const weekend2 = cov("new", { kind: "weekend" }, A, 2);

  it("매일 오픈 정확히 1명 vs 주말 오픈 2명 이상 → 충돌", () => {
    expect(findCoverageConflict([daily1], weekend2, WEEK, [])?.id).toBe("old");
  });
  it("평일 2명 이상 vs 주말 3명 이상 → 날짜가 안 겹친다", () => {
    expect(findCoverageConflict([cov("old", { kind: "weekday" }, A, 2)], cov("new", { kind: "weekend" }, A, 3), WEEK, [])).toBeNull();
  });
  it("매일 1~3명 vs 주말 2명 이상 → 범위가 겹친다", () => {
    expect(findCoverageConflict([cov("old", { kind: "all" }, A, 1, 3)], weekend2, WEEK, [])).toBeNull();
  });
  it("이하 vs 이상이 어긋나면 충돌", () => {
    expect(findCoverageConflict([cov("old", { kind: "all" }, A, undefined, 1)], weekend2, WEEK, [])?.id).toBe("old");
  });
  it("같은 날짜, 다른 근무조 → null", () => {
    expect(findCoverageConflict([cov("old", { kind: "all" }, C, 1, 1)], weekend2, WEEK, [])).toBeNull();
  });
  it("코드 집합이 다르면 충돌로 보지 않는다", () => {
    expect(findCoverageConflict([cov("old", { kind: "all" }, { in: ["A", "M"] }, 1, 1)], cov("new", { kind: "all" }, A, 3), WEEK, [])).toBeNull();
  });
  it("기존 규칙이 꺼졌거나 가능하면이면 null", () => {
    expect(findCoverageConflict([{ ...daily1, enabled: false }], weekend2, WEEK, [])).toBeNull();
    expect(findCoverageConflict([{ ...daily1, hardness: "soft" }], weekend2, WEEK, [])).toBeNull();
  });
  it("카드가 가능하면이면 null", () => {
    expect(findCoverageConflict([daily1], { ...weekend2, hardness: "soft" }, WEEK, [])).toBeNull();
  });
  it("카드가 필요 인원 모양이 아니면 null", () => {
    expect(findCoverageConflict([daily1], forbid([C, A], undefined, { id: "new" }), WEEK, [])).toBeNull();
  });
  it("같은 id는 건너뛴다", () => {
    expect(findCoverageConflict([{ ...daily1, id: "new" }], weekend2, WEEK, [])).toBeNull();
  });
  it("필요 인원 모양이 아닌 기존 규칙은 건너뛴다", () => {
    const leaders = count({ per: "day", people: { tags: ["리더"] }, shifts: A, max: 0 }, { id: "x" });
    expect(findCoverageConflict([leaders], weekend2, WEEK, [])).toBeNull();
  });
  it("첫 번째 충돌을 돌려준다", () => {
    const other = cov("old2", { kind: "weekend" }, A, 0, 0);
    expect(findCoverageConflict([cov("ok", { kind: "all" }, A, 2), daily1, other], weekend2, WEEK, [])?.id).toBe("old");
  });
  it("토·일요일 고르기와 주말이 겹친다", () => {
    expect(findCoverageConflict([cov("old", { weekdays: [5, 6] }, A, 1, 1)], weekend2, WEEK, [])?.id).toBe("old");
  });
  it("특정일과 평일은 그날이 평일일 때만 겹친다", () => {
    const wk = cov("new", { kind: "weekday" }, A, 2);
    expect(findCoverageConflict([cov("old", { days: [3] }, A, 1, 1)], wk, WEEK, [])?.id).toBe("old");
    expect(findCoverageConflict([cov("old", { days: [6] }, A, 1, 1)], wk, WEEK, [])).toBeNull();
  });
  it("공휴일이면 주말과 겹친다", () => {
    const old = cov("old", { days: [3] }, A, 1, 1);
    expect(findCoverageConflict([old], weekend2, WEEK, [])).toBeNull();
    expect(findCoverageConflict([old], weekend2, WEEK, [3])?.id).toBe("old");
  });
});

describe("effectiveCoverage", () => {
  const formWeekday = cov("f-wd", { kind: "weekday" }, A, 1, 2);
  const formWeekend = cov("f-we", { kind: "weekend" }, A, 2, 2);
  const daily = cov("daily", { kind: "all" }, A, 1);

  it("폼 규칙만 있으면 그 범위", () => {
    expect(effectiveCoverage([formWeekday, formWeekend], "A", "weekday", WEEK, [])).toEqual({ min: 1, max: 2 });
    expect(effectiveCoverage([formWeekday, formWeekend], "A", "weekend", WEEK, [])).toEqual({ min: 2, max: 2 });
  });
  it("규칙이 없으면 null", () => {
    expect(effectiveCoverage([], "A", "weekday", WEEK, [])).toBeNull();
    expect(effectiveCoverage([formWeekday], "C", "weekday", WEEK, [])).toBeNull();
  });
  it("매일 오픈 1명 이상 + 평일 오픈 1~2명", () => {
    expect(effectiveCoverage([daily, formWeekday], "A", "weekday", WEEK, [])).toEqual({ min: 1, max: 2 });
    expect(effectiveCoverage([daily, formWeekday], "A", "weekend", WEEK, [])).toEqual({ min: 1, max: null });
  });
  it("min은 가장 큰 값, max는 가장 작은 값", () => {
    const r1 = cov("r1", { kind: "all" }, A, 2, 5);
    const r2 = cov("r2", { kind: "weekday" }, A, 1, 3);
    expect(effectiveCoverage([r1, r2], "A", "weekday", WEEK, [])).toEqual({ min: 2, max: 3 });
  });
  it("일부 날에만 적용되는 규칙은 넣지 않는다", () => {
    const sat = cov("sat", { weekdays: [5] }, A, 3);
    const some = cov("some", { days: [7] }, A, 3);
    expect(effectiveCoverage([sat, some], "A", "weekend", WEEK, [])).toBeNull();
    expect(effectiveCoverage([daily, sat], "A", "weekend", WEEK, [])).toEqual({ min: 1, max: null });
  });
  it("토·일 고르기는 공휴일이 없을 때 주말 전부를 덮는다", () => {
    const satSun = cov("ss", { weekdays: [5, 6] }, A, 3);
    expect(effectiveCoverage([satSun], "A", "weekend", WEEK, [])).toEqual({ min: 3, max: null });
    expect(effectiveCoverage([satSun], "A", "weekend", WEEK, [4])).toBeNull();
  });
  it("가능하면 규칙과 꺼진 규칙은 무시", () => {
    expect(effectiveCoverage([{ ...daily, hardness: "soft" }], "A", "weekday", WEEK, [])).toBeNull();
    expect(effectiveCoverage([{ ...daily, enabled: false }], "A", "weekday", WEEK, [])).toBeNull();
  });
  it("복합 코드·제외 집합·사람 고르기는 무시", () => {
    const multi = cov("m", { kind: "all" }, { in: ["A", "M"] }, 3);
    const notIn = cov("n", { kind: "all" }, { not_in: ["O"] }, 3);
    const leaders = count({ per: "day", people: { tags: ["리더"] }, shifts: A, min: 1 }, { id: "l" });
    expect(effectiveCoverage([multi, notIn, leaders], "A", "weekday", WEEK, [])).toBeNull();
  });
  it("공휴일로 주말 날이 늘어도 매일 규칙은 전부 덮는다", () => {
    expect(effectiveCoverage([daily], "A", "weekend", WEEK, [3, 4])).toEqual({ min: 1, max: null });
    expect(effectiveCoverage([daily], "A", "weekday", WEEK, [3, 4])).toEqual({ min: 1, max: null });
  });
  it("그 요일 종류의 날이 없는 기간은 null", () => {
    const monday: PeriodRange = { start_date: "2026-11-02", length: 1 };
    expect(effectiveCoverage([daily], "A", "weekend", monday, [])).toBeNull();
    expect(effectiveCoverage([daily], "A", "weekday", monday, [])).toEqual({ min: 1, max: null });
  });
});
