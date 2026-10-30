import { describe, expect, it } from "vitest";

import {
  HISTORY_DAYS,
  carryOverFrom,
  diffAssignments,
  historyFor,
  historyLoadFor,
  isOperating,
  latestConfirmed,
  pastDayLocks,
  previousConfirmedPeriod,
  rosterChanges,
  sameCarryOver,
} from "./continuity";
import { DEFAULT_CONFIG } from "./rules";
import { DEN_CONFIG } from "./test-rules";
import type { Assignments, Code, ShopEmployee, WorkPeriod } from "./store";

// 기준: 2026-11-02 월요일, 2026-11-01 일요일

function period(start_date: string, length: number, extra: Partial<WorkPeriod> = {}): WorkPeriod {
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
    result: null,
    resultVersion: null,
    status: "draft",
    versions: [],
    snapshot: null,
    carryOverUsed: null,
    ...extra,
  };
}

function confirmed(start_date: string, length: number, ...versions: Assignments[]): WorkPeriod {
  return period(start_date, length, {
    status: "confirmed",
    versions: versions.map((assignments, i) => ({ confirmed_at: `2026-10-0${i + 1}T00:00:00Z`, assignments, changed: [] })),
  });
}

/** "DENO..." 문자열 → 코드 배열 */
const row = (s: string) => s.split("") as Code[];
const employee = (id: string, name: string, active = true): ShopEmployee => ({ id, name, tags: [], active });

describe("HISTORY_DAYS", () => {
  it("백엔드와 같은 28일", () => {
    expect(HISTORY_DAYS).toBe(28);
  });
});

describe("latestConfirmed", () => {
  it("versions 마지막 확정본", () => {
    const p = confirmed("2026-11-02", 7, { e01: row("DDDDDDD") }, { e01: row("OOOOOOO") });
    expect(latestConfirmed(p)).toEqual({ e01: row("OOOOOOO") });
  });

  it("확정본이 없으면 null", () => {
    expect(latestConfirmed(period("2026-11-02", 7))).toBeNull();
  });
});

describe("previousConfirmedPeriod", () => {
  const prev = confirmed("2026-11-02", 14, { e01: row("D".repeat(14)) });

  it("연속한 확정 기간", () => {
    expect(previousConfirmedPeriod([prev], { start_date: "2026-11-16", length: 14 })).toBe(prev);
  });

  it("간격이 있으면 null", () => {
    expect(previousConfirmedPeriod([prev], { start_date: "2026-11-23", length: 7 })).toBeNull();
  });

  it("지난 기간이 초안이면 null", () => {
    const draft = period("2026-11-02", 14);
    expect(previousConfirmedPeriod([draft], { start_date: "2026-11-16", length: 14 })).toBeNull();
  });

  it("월 경계를 넘는 달력 월", () => {
    const oct = confirmed("2026-10-01", 31, {});
    expect(previousConfirmedPeriod([oct], { start_date: "2026-11-01", length: 30 })).toBe(oct);
  });
});

describe("carryOverFrom", () => {
  it("마지막 7일, employeeIds 순서", () => {
    const prev = confirmed("2026-11-02", 14, {
      e01: row("DDDDDDDEEENNOO"),
      e02: row("OOOOOOODDDDDDD"),
    });
    expect(carryOverFrom(prev, ["e02", "e01"])).toEqual([
      { employee_id: "e02", shifts: row("DDDDDDD") },
      { employee_id: "e01", shifts: row("EEENNOO") },
    ]);
  });

  it("1주 단위는 정확히 7일 전체", () => {
    const prev = confirmed("2026-11-02", 7, { e01: row("DENOODE") });
    expect(carryOverFrom(prev, ["e01"])).toEqual([{ employee_id: "e01", shifts: row("DENOODE") }]);
  });

  it("employeeIds에 없거나 지난 확정본에 없는 간호사는 뺀다", () => {
    const prev = confirmed("2026-11-02", 7, { e01: row("DDDDDDD"), e02: row("NNNOOOO") });
    expect(carryOverFrom(prev, ["e01", "e03"])).toEqual([{ employee_id: "e01", shifts: row("DDDDDDD") }]);
  });

  it("최신 버전을 쓰고, 확정본이 없으면 []", () => {
    const prev = confirmed("2026-11-02", 7, { e01: row("DDDDDDD") }, { e01: row("OOOOOOO") });
    expect(carryOverFrom(prev, ["e01"])[0].shifts).toEqual(row("OOOOOOO"));
    expect(carryOverFrom(period("2026-11-02", 7), ["e01"])).toEqual([]);
  });
});

describe("historyFor / historyLoadFor", () => {
  // 창: 2026-10-12 ~ 11-08 (target 11-09 시작)
  // A 10-05~10-18: 창에 10-12~10-18(인덱스 8~14)만 들어간다
  const A = confirmed("2026-10-05", 14, {
    e01: row("NNNNNNN" + "NOOOOOO"), // 창 안 N 1회
    e02: row("DDDDDDD" + "DDDDDDD"),
  });
  // B 10-19~11-01: 주말 10-24·25, 10-31·11-01
  const B = confirmed("2026-10-19", 14, {
    e01: row("NNOOOOO" + "OOOOOOO"), // N 2회, 주말 0
    e02: row("OOOOODD" + "OOOOODD"), // 주말 4회
  });
  // C 11-02~11-08: 주말 11-07·08, 공휴일 인덱스 3(11-04)
  const C = period("2026-11-02", 7, {
    status: "confirmed",
    holidays: [3],
    versions: [
      { confirmed_at: "2026-10-01T00:00:00Z", assignments: { e01: row("NNNNNNN"), e02: row("NNNNNNN") }, changed: [] },
      { confirmed_at: "2026-10-02T00:00:00Z", assignments: { e01: row("OOOOOOO"), e02: row("OODOOOO") }, changed: [] },
    ],
  });
  const target = { start_date: "2026-11-09", length: 7 };

  it("최근 28일 확정본 원본: 여러 기간에 걸치고, 최신 버전과 그 날짜의 공휴일", () => {
    expect(historyFor([A, B, C], target, ["e01", "e02"])).toEqual({
      start_date: "2026-10-12",
      rows: {
        e01: row("NOOOOOO" + "NNOOOOO" + "OOOOOOO" + "OOOOOOO"),
        e02: row("DDDDDDD" + "OOOOODD" + "OOOOODD" + "OODOOOO"),
      },
      holidays: ["2026-11-04"],
    });
  });

  it("창의 앞이 비면 확정본이 있는 첫날부터, 사이가 비거나 행이 없는 날은 휴무로 채운다", () => {
    const gap = confirmed("2026-11-02", 3, { e01: row("NDE") });
    const late = confirmed("2026-11-07", 2, { e01: row("DD"), e02: row("NN") });
    expect(historyFor([gap, late], target, ["e01", "e02"])).toEqual({
      start_date: "2026-11-02",
      rows: { e01: row("NDEOODD"), e02: row("OOOOONN") },
      holidays: [],
    });
  });

  it("초안 기간과 target 이후 기간은 쓰지 않고, 없으면 null", () => {
    const draft = period("2026-11-02", 7, { result: null });
    const later = confirmed("2026-11-09", 7, { e01: row("NNNNNNN") });
    expect(historyFor([draft, later], target, ["e01"])).toBeNull();
  });

  it("employeeIds 밖 간호사와 확정본에 없는 간호사는 행이 없다", () => {
    const p = confirmed("2026-11-02", 7, { e01: row("DDDDDOO"), e03: row("NNNNNNN") });
    expect(historyFor([p], target, ["e01", "e02"])!.rows).toEqual({ e01: row("DDDDDOO") });
  });

  it("historyLoadFor: 원본에서 가장 늦게 끝나는 근무조와 주말·공휴일 근무를 센다, 둘 다 0이면 뺀다", () => {
    expect(historyLoadFor(historyFor([A, B, C], target, ["e01", "e02"]), DEN_CONFIG)).toEqual([
      { employee_id: "e01", closings: 3, weekends: 0 },
      { employee_id: "e02", closings: 0, weekends: 2 + 4 + 1 }, // A 10-17·18 D, B 4회, C 공휴일 D
    ]);
    const p = confirmed("2026-11-02", 7, { e01: row("DDDDDOO"), e02: row("NOOOOOO") });
    expect(historyLoadFor(historyFor([p], target, ["e01", "e02"]), DEN_CONFIG)).toEqual([
      { employee_id: "e02", closings: 1, weekends: 0 },
    ]);
    expect(historyLoadFor(null, DEN_CONFIG)).toEqual([]);
  });

  it("historyLoadFor: 복합 코드는 세는 근무조로 센다", () => {
    const config = {
      shifts: [...DEN_CONFIG.shifts, { code: "EN", name: "더블", hours: 16, parts: ["E", "N"] }],
    } as typeof DEN_CONFIG;
    const history = { start_date: "2026-11-02", rows: { e01: ["EN", "N", "D", "O", "O", "EN", "O"] }, holidays: [] };
    expect(historyLoadFor(history, config)).toEqual([{ employee_id: "e01", closings: 3, weekends: 1 }]);
  });

  it("historyLoadFor: 기본 근무 형태에서는 마감을 센다", () => {
    const history = { start_date: "2026-11-02", rows: { e01: ["C", "C", "A", "O", "O", "M", "O"] }, holidays: [] };
    expect(historyLoadFor(history, DEFAULT_CONFIG)).toEqual([{ employee_id: "e01", closings: 2, weekends: 1 }]);
  });
});

describe("isOperating", () => {
  const p = confirmed("2026-11-02", 7, {});
  it("확정 && 시작일 <= today <= 끝", () => {
    expect(isOperating(p, "2026-11-01")).toBe(false);
    expect(isOperating(p, "2026-11-02")).toBe(true);
    expect(isOperating(p, "2026-11-08")).toBe(true);
    expect(isOperating(p, "2026-11-09")).toBe(false);
    expect(isOperating(period("2026-11-02", 7), "2026-11-04")).toBe(false);
  });
});

describe("pastDayLocks", () => {
  const employees = [employee("e01", "김철수"), employee("e02", "이영희")];
  const p = confirmed("2026-10-29", 7, { e01: row("DENODEN"), e02: row("OOOOOOO") }); // 10-29 ~ 11-04

  it("기간 전이면 []", () => {
    expect(pastDayLocks(p, employees, "2026-10-28")).toEqual([]);
    expect(pastDayLocks(p, employees, "2026-10-29")).toEqual([]);
  });

  it("기간 중이면 today 이전 날짜만 fixed_assignment로", () => {
    const locks = pastDayLocks(p, employees, "2026-10-31");
    expect(locks.map((c) => c.id)).toEqual(["lock-e01-1", "lock-e01-2", "lock-e02-1", "lock-e02-2"]);
    expect(locks[1]).toEqual({
      id: "lock-e01-2",
      type: "fixed_assignment",
      scope: "period",
      hardness: "hard",
      weight: 1,
      source_text: "지난 날짜 고정: 김철수 10/30 E",
      enabled: true,
      params: { employee_id: "e01", day: 2, shift: "E" },
    });
  });

  it("월 경계 날짜 표기", () => {
    const locks = pastDayLocks(p, [employees[0]], "2026-11-03");
    expect(locks.map((c) => c.source_text)).toEqual([
      "지난 날짜 고정: 김철수 10/29 D",
      "지난 날짜 고정: 김철수 10/30 E",
      "지난 날짜 고정: 김철수 10/31 N",
      "지난 날짜 고정: 김철수 11/1 O",
      "지난 날짜 고정: 김철수 11/2 D",
    ]);
  });

  it("기간이 끝났으면 전체 날짜", () => {
    expect(pastDayLocks(p, employees, "2026-11-20")).toHaveLength(14);
  });

  it("최신 확정본을 쓰고, 확정본이 없으면 []", () => {
    const v2 = confirmed("2026-10-29", 7, { e01: row("DDDDDDD") }, { e01: row("NNNNNNN") });
    expect(pastDayLocks(v2, employees, "2026-10-30")[0].params).toEqual({ employee_id: "e01", day: 1, shift: "N" });
    expect(pastDayLocks(period("2026-10-29", 7), employees, "2026-11-20")).toEqual([]);
  });
});

describe("diffAssignments", () => {
  it("바뀐 칸만, 새 간호사·빠진 간호사는 무시", () => {
    const before = { e01: row("DEN"), e02: row("OOO") };
    const after = { e01: row("DON"), e03: row("NNN") };
    expect(diffAssignments(before, after)).toEqual([{ employee_id: "e01", day: 2, before: "E", after: "O" }]);
  });

  it("같으면 []", () => {
    expect(diffAssignments({ e01: row("DEN") }, { e01: row("DEN") })).toEqual([]);
  });
});

describe("sameCarryOver", () => {
  const a = { employee_id: "e01", shifts: row("DDN") };
  const b = { employee_id: "e02", shifts: row("OON") };

  it("간호사 순서와 무관", () => {
    expect(sameCarryOver([a, b], [b, a])).toBe(true);
    expect(sameCarryOver([], [])).toBe(true);
  });

  it("근무·간호사가 다르면 false", () => {
    expect(sameCarryOver([a, b], [a, { employee_id: "e02", shifts: row("OOO") }])).toBe(false);
    expect(sameCarryOver([a, b], [a])).toBe(false);
    expect(sameCarryOver([a], [{ employee_id: "e01", shifts: row("DN") }])).toBe(false);
  });
});

describe("rosterChanges", () => {
  const prev = period("2026-11-02", 7, {
    status: "confirmed",
    snapshot: { employees: [employee("e01", "김철수"), employee("e02", "이영희")], rules: [] },
  });

  it("추가된 활성 간호사와 비활성화된 간호사", () => {
    const now = [employee("e01", "김철수"), employee("e02", "이영희", false), employee("e03", "박민수"), employee("e04", "최지훈", false)];
    expect(rosterChanges(prev, now)).toEqual({ added: [now[2]], deactivated: [now[1]] });
  });

  it("바뀐 사람이 없거나 지난 기간이 없으면 빈 목록", () => {
    const now = [employee("e01", "김철수"), employee("e02", "이영희")];
    expect(rosterChanges(prev, now)).toEqual({ added: [], deactivated: [] });
    expect(rosterChanges(null, now)).toEqual({ added: [], deactivated: [] });
  });
});
