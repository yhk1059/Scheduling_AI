import { describe, expect, it } from "vitest";

import type { Ward, WorkPeriod } from "./store";
import type { ConstraintSpec, Nurse } from "./types.gen";
import {
  describeParams,
  formatDeviation,
  hardnessLabel,
  nextTask,
  scheduleName,
  TEMPLATE_NAMES,
  unitName,
  unitShort,
  wardRuleCount,
} from "./wording";

const NOV = { start_date: "2026-11-01", length: 30 };
const NURSES: Nurse[] = [
  { id: "n01", name: "이영희", years: 12, night_only: false },
  { id: "n02", name: "박민수", years: 9, night_only: false },
  { id: "n03", name: "정유진", years: 5, night_only: false },
];

function card(type: ConstraintSpec["type"], params?: unknown, scope: "ward" | "period" = "ward"): ConstraintSpec {
  return { id: `c-${type}`, scope, source_text: "", type, ...(params !== undefined && { params }) } as ConstraintSpec;
}

describe("scheduleName", () => {
  it("달력 월은 'M월 근무표'", () => {
    expect(scheduleName(NOV, "month")).toBe("11월 근무표");
  });
  it("주 단위는 'M/D~M/D 근무표'", () => {
    expect(scheduleName({ start_date: "2026-11-02", length: 14 }, "2w")).toBe("11/2~11/15 근무표");
  });
  it("월 경계를 넘는 주 단위", () => {
    expect(scheduleName({ start_date: "2026-11-23", length: 14 }, "2w")).toBe("11/23~12/6 근무표");
    expect(scheduleName({ start_date: "2026-12-28", length: 7 }, "1w")).toBe("12/28~1/3 근무표");
  });
});

describe("unitName / unitShort", () => {
  it("근무표 주기 select 레이블", () => {
    expect(unitName("month")).toBe("한 달(1일~말일)");
    expect(unitName("1w")).toBe("1주");
    expect(unitName("2w")).toBe("2주");
    expect(unitName("4w")).toBe("4주");
  });
  it("짧은 이름", () => {
    expect(unitShort("month")).toBe("한 달 단위");
    expect(unitShort("2w")).toBe("2주 단위");
  });
});

describe("TEMPLATE_NAMES / hardnessLabel", () => {
  it("화면용 템플릿 이름", () => {
    expect(TEMPLATE_NAMES.off_after_night_block).toBe("나이트 다음 휴무");
    expect(TEMPLATE_NAMES.min_days_off).toBe("최소 휴무 일수");
    expect(Object.values(TEMPLATE_NAMES).join()).not.toMatch(/오프|N-OFF|[a-z_]{3,}/);
  });
  it("반드시 / 가능하면", () => {
    expect(hardnessLabel("hard")).toBe("반드시");
    expect(hardnessLabel("soft")).toBe("가능하면");
  });
});

describe("describeParams", () => {
  const d = (c: ConstraintSpec) => describeParams(c, NURSES, NOV);

  it("휴가", () => {
    expect(d(card("leave", { nurse_id: "n01", days: [15, 16, 17] }, "period"))).toBe("이영희 · 11/15~11/17 · 휴무");
    expect(d(card("leave", { nurse_id: "n01", days: [20, 15, 16] }, "period"))).toBe(
      "이영희 · 11/15~11/16, 11/20 · 휴무",
    );
  });
  it("희망/기피 근무", () => {
    expect(d(card("shift_preference", { nurse_id: "n02", shift: "N", prefer: false, weekends_only: true }, "period"))).toBe(
      "박민수 · 주말·공휴일 · 나이트 피하기",
    );
    expect(d(card("shift_preference", { nurse_id: "n03", shift: "D", prefer: true, days: [20] }, "period"))).toBe(
      "정유진 · 11/20 · 데이 희망",
    );
    expect(d(card("shift_preference", { nurse_id: "n02", shift: "O", prefer: true, weekends_only: true }, "period"))).toBe(
      "박민수 · 주말·공휴일 · 휴무 희망",
    );
  });
  it("병동 규칙", () => {
    expect(d(card("off_after_night_block", { days: 1 }))).toBe("나이트 다음 날은 휴무 1일");
    expect(d(card("max_consecutive_nights", { days: 3 }))).toBe("나이트 연속 3일까지");
    expect(d(card("daily_coverage", { shift: "D", day_kind: "weekday", min: 3, max: 4 }))).toBe("데이 · 평일 · 3~4명");
    expect(d(card("daily_coverage", { shift: "E", day_kind: "weekend", min: 2, max: 2 }))).toBe(
      "이브닝 · 주말·공휴일 · 2~2명",
    );
  });
  it("명단에 없는 간호사", () => {
    expect(d(card("leave", { nurse_id: "n99", days: [20] }, "period"))).toBe("(명단에 없는 간호사) · 11/20 · 휴무");
  });
  it("모든 템플릿에서 내부 id·코드만 있는 표기를 쓰지 않는다", () => {
    const all = [
      card("daily_coverage", { shift: "N", day_kind: "weekday", min: 2, max: 2 }),
      card("forbidden_sequence", { first: "N", second: "D" }),
      card("max_consecutive_work", { days: 5 }),
      card("max_consecutive_nights", { days: 3 }),
      card("min_days_off", { days: 8 }),
      card("off_after_night_block", { days: 1 }),
      card("skill_mix", { shift: "E", min_years: 3, min_count: 1 }),
      card("leave", { nurse_id: "n01", days: [1] }, "period"),
      card("fixed_assignment", { nurse_id: "n02", day: 10, shift: "O" }, "period"),
      card("shift_preference", { nurse_id: "n03", shift: "E", prefer: false }, "period"),
      card("night_fairness"),
      card("weekend_fairness"),
    ];
    for (const c of all) {
      const text = d(c);
      expect(text, c.type).not.toMatch(/n\d\d|\b[DENO]\b|오프|≤|≥/);
    }
  });
});

describe("wardRuleCount", () => {
  it("필요 인원(daily_coverage)은 세지 않는다", () => {
    const rules = [
      card("daily_coverage", { shift: "D", day_kind: "weekday", min: 3, max: 4 }),
      card("daily_coverage", { shift: "N", day_kind: "weekend", min: 2, max: 2 }),
      card("off_after_night_block", { days: 1 }),
      card("night_fairness"),
    ];
    expect(wardRuleCount(rules)).toBe(2);
    expect(wardRuleCount([])).toBe(0);
  });
});

describe("formatDeviation", () => {
  it("정수 일로 반올림, 0은 부호 없음, 음수는 − 기호", () => {
    expect(formatDeviation(2.6)).toBe("+3일");
    expect(formatDeviation(-0.4)).toBe("0일");
    expect(formatDeviation(0.4)).toBe("0일");
    expect(formatDeviation(0)).toBe("0일");
    expect(formatDeviation(-1.6)).toBe("−2일");
    expect(formatDeviation(1.5)).toBe("+2일");
    expect(formatDeviation(-1.5)).toBe("−2일");
  });
});

describe("nextTask", () => {
  const ward: Ward = {
    name: "내과 병동",
    unit: "month",
    nurses: NURSES.map((n) => ({ ...n, active: true })),
    nextNurseNo: 4,
    rules: [],
    pendingRules: [],
    isSample: false,
  };
  const TODAY = "2026-10-28";
  const result = { assignments: {} } as unknown as NonNullable<WorkPeriod["result"]>;

  function period(start_date: string, length: number, patch: Partial<WorkPeriod> = {}): WorkPeriod {
    return {
      start_date,
      length,
      id: `p-${start_date}`,
      holidays: [],
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
      ...patch,
    };
  }
  const confirmed = (start: string, length: number, at: string) =>
    period(start, length, {
      status: "confirmed",
      result,
      versions: [{ confirmed_at: at, assignments: {}, changed: [] }],
    });

  it("기간이 없으면 오늘 이후 첫 근무표를 만들 차례", () => {
    expect(nextTask(ward, [], TODAY)).toEqual({ kind: "none", name: "11월 근무표" });
  });

  it("작성 중, 생성 전: 적용한 요청 수", () => {
    const p = period("2026-11-01", 30, {
      requests: [card("leave", { nurse_id: "n01", days: [15] }, "period"), card("night_fairness", undefined, "period")],
      pendingRequests: [card("leave", { nurse_id: "n02", days: [3] }, "period")],
    });
    expect(nextTask(ward, [p], TODAY)).toEqual({ kind: "drafting", name: "11월 근무표", requests: 2 });
  });

  it("작성 중, 생성 후", () => {
    expect(nextTask(ward, [period("2026-11-01", 30, { result })], TODAY)).toEqual({
      kind: "generated",
      name: "11월 근무표",
    });
  });

  it("확정", () => {
    const p = confirmed("2026-11-01", 30, "2026-10-28T05:32:00.000Z");
    expect(nextTask(ward, [p], TODAY)).toEqual({
      kind: "confirmed",
      name: "11월 근무표",
      confirmedAt: "2026-10-28T05:32:00.000Z",
    });
  });

  it("운영 중 근무표가 있으면 그다음 근무표를 고른다", () => {
    const nov = confirmed("2026-11-01", 30, "2026-10-28T05:32:00.000Z");
    const during = "2026-11-09";
    expect(nextTask(ward, [nov], during)).toEqual({ kind: "none", name: "12월 근무표" });
    expect(nextTask(ward, [nov, period("2026-12-01", 31)], during)).toEqual({
      kind: "drafting",
      name: "12월 근무표",
      requests: 0,
    });
  });

  it("주 단위 병동은 날짜로 이름을 붙인다", () => {
    expect(nextTask({ ...ward, unit: "2w" }, [], TODAY)).toEqual({ kind: "none", name: "11/2~11/15 근무표" });
  });
});
