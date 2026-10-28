import { describe, expect, it } from "vitest";

import { isOperating } from "./continuity";
import { buildSample } from "./sample";
import confirmed from "./samples/confirmed-schedules.json";
import sample from "./samples/ward-15.json";
import { homeSummary, toScheduleRequest } from "./store";
import { nextTask, wardRuleCount } from "./wording";

const TODAY = "2026-10-28";

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("buildSample", () => {
  it("병동: 샘플 병동, 달력 월, 15명 활성, 필요 인원 + 병동 규칙 6개", () => {
    const { ward } = buildSample(TODAY, ids());
    expect(ward).toMatchObject({ name: "샘플 병동", unit: "month", isSample: true, pendingRules: [] });
    expect(ward.nurses).toEqual(sample.nurses.map((n) => ({ ...n, active: true })));
    expect(ward.nextNurseNo).toBe(16);
    expect(ward.rules).toEqual(sample.constraints);
    expect(wardRuleCount(ward.rules)).toBe(6);
  });

  it("2026-10-28 → 10월(31-3) 확정 + 11월 초안, id는 makeId로", () => {
    const { ward, periods } = buildSample(TODAY, ids());
    const [oct, nov] = periods;
    expect(periods).toHaveLength(2);
    expect(oct).toMatchObject({ id: "id-1", start_date: "2026-10-01", length: 31, status: "confirmed", requests: [] });
    expect(oct.result).toEqual(confirmed["31-3"]);
    expect(oct.carryOverUsed).toEqual([]);
    expect(oct.versions).toHaveLength(1);
    expect(oct.versions[0]).toEqual({
      confirmed_at: "2026-09-30T09:00:00.000Z", // 9/30 18:00 KST
      assignments: confirmed["31-3"].assignments,
      changed: [],
    });
    expect(oct.snapshot).toEqual({ nurses: ward.nurses, rules: ward.rules });
    expect(nov).toMatchObject({ id: "id-2", start_date: "2026-11-01", length: 30, status: "draft", result: null });
  });

  it("2027-02-15 → 2월(28일) 확정 + 3월 초안", () => {
    const { periods } = buildSample("2027-02-15", ids());
    expect(periods[0]).toMatchObject({ start_date: "2027-02-01", length: 28, status: "confirmed" });
    expect(periods[0].result).toEqual(confirmed["28-0"]); // 2027-02-01은 월요일
    expect(periods[1]).toMatchObject({ start_date: "2027-03-01", length: 31, status: "draft" });
  });

  it("확정 기간은 운영 중이고, 확정 시각은 오늘 이전", () => {
    const { periods } = buildSample(TODAY, ids());
    expect(isOperating(periods[0], TODAY)).toBe(true);
    expect(isOperating(periods[1], TODAY)).toBe(false);
    expect(new Date(periods[0].versions[0].confirmed_at).getTime()).toBeLessThan(new Date(`${TODAY}T00:00:00+09:00`).getTime());
  });

  it("오늘이 1일이어도 그 달이 운영 중", () => {
    const { periods } = buildSample("2026-11-01", ids());
    expect(periods[0]).toMatchObject({ start_date: "2026-11-01", length: 30 });
    expect(isOperating(periods[0], "2026-11-01")).toBe(true);
  });

  it("다음 달 요청 3개가 적용 상태이고 날짜가 기간 안에 있다", () => {
    const { periods } = buildSample("2027-02-15", ids());
    const next = periods[1];
    expect(next.requests).toEqual(sample.next_requests);
    expect(next.pendingRequests).toEqual([]);
    for (const r of next.requests) {
      const days = (r.params as { days?: number[] | null }).days ?? [];
      for (const d of days) expect(d >= 1 && d <= next.length).toBe(true);
    }
  });

  it("다음 달 요청의 carry_over는 이번 달 마지막 7일, history_load가 채워진다", () => {
    const { ward, periods } = buildSample(TODAY, ids());
    const req = toScheduleRequest(ward, periods[1], periods, TODAY);
    expect(req.carry_over).toHaveLength(15);
    for (const row of req.carry_over!) {
      expect(row.shifts).toEqual(confirmed["31-3"].assignments[row.nurse_id as keyof typeof confirmed["31-3"]["assignments"]].slice(-7));
    }
    expect(req.history_load!.length).toBeGreaterThan(0);
    expect(req.constraints!.filter((c) => c.scope === "period")).toHaveLength(3);
  });

  it("홈: 운영 중 10월 + 작성 중 11월(요청 3개)", () => {
    const { ward, periods } = buildSample(TODAY, ids());
    const home = homeSummary(periods, TODAY);
    expect(home.operating?.start_date).toBe("2026-10-01");
    expect(home.next).toMatchObject({ state: "draft", period: { start_date: "2026-11-01" } });
    expect(nextTask(ward, periods, TODAY)).toEqual({ kind: "drafting", name: "11월 근무표", requests: 3 });
  });
});
