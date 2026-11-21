import { describe, expect, it } from "vitest";

import { demoData, demoExplanation, demoLeaveCard, demoLinkRows, requestSignature, type DemoDoc } from "./demo";
import { isLeaveRule } from "./store";
import { DEFAULT_CONFIG, STORAGE_VERSION } from "./rules";
import type { Shop, ShopEmployee } from "./store";
import type { ConstraintSpec, ScheduleRequest } from "./types.gen";

const EMPLOYEES: ShopEmployee[] = [
  { id: "e01", name: "김도현", tags: ["홀", "리더"], active: true },
  { id: "e02", name: "서민호", tags: ["주방", "리더"], active: true },
  { id: "e03", name: "오지훈", tags: ["홀", "신입"], active: true },
];

const noOpenAfterClose = {
  id: "r-close-open",
  type: "rule",
  scope: "shop",
  hardness: "hard",
  source_text: "마감 다음 날 오픈은 안 되게",
  body: {
    kind: "require",
    for_each: { per: "person_day" },
    when: { left: { shifts: { in: ["C"] } }, op: "ge", right: 1 },
    then: { left: { shifts: { in: ["A"] }, offset: 1 }, op: "eq", right: 0 },
  },
} as unknown as ConstraintSpec;

const leaderClose = {
  id: "r-leader-close",
  type: "rule",
  scope: "shop",
  hardness: "hard",
  source_text: "마감에는 리더가 꼭 1명",
  values: { min: { value: 1, label: "최소 리더 인원" } },
  body: {
    kind: "require",
    for_each: { per: "day" },
    then: { left: { people: { tags: ["리더"] }, shifts: { in: ["C"] } }, op: "ge", right: { value: "min" } },
  },
} as unknown as ConstraintSpec;

const SHOP: Shop = {
  name: "한강 다이닝",
  unit: "1w",
  config: DEFAULT_CONFIG,
  employees: EMPLOYEES,
  nextEmployeeNo: 4,
  rules: [noOpenAfterClose, leaderClose],
  pendingRules: [],
  pendingConfig: [],
  unconverted: [],
};

const BASE = { start_date: "2026-11-09", length: 7 }; // 월요일

function doc(over: Partial<DemoDoc> = {}): DemoDoc {
  return {
    version: STORAGE_VERSION,
    shop: SHOP,
    base: BASE,
    availability: {
      e01: { "2026-11-09": [["09:00", "21:00"]], "2026-11-10": [["16:00", "21:00"]], "2026-11-16": [["09:00", "12:00"]] },
      e02: { "2026-11-11": [["09:00", "16:00"]] },
    },
    explanation: null,
    ...over,
  };
}

function request(constraints: ConstraintSpec[]): Omit<ScheduleRequest, "input_version"> {
  return {
    config: DEFAULT_CONFIG,
    employees: EMPLOYEES.map(({ id, name, tags }) => ({ id, name, tags })) as ScheduleRequest["employees"],
    period: BASE,
    holidays: [],
    constraints,
  };
}

const fixed: ConstraintSpec = {
  id: "fix-e01-1",
  type: "fixed_assignment",
  scope: "period",
  source_text: "칸 고정",
  params: { employee_id: "e01", day: 1, shift: "A" },
};
const avail = { ...noOpenAfterClose, id: "avail-e02", source_text: "가능 시간" } as ConstraintSpec;

describe("demoData", () => {
  it("수요일이면 다음 월요일부터 1주, 공휴일 없이 ② 매장 조건으로 연다", () => {
    const data = demoData(doc(), "2026-10-28");
    expect(data.periods).toHaveLength(1);
    expect(data.periods[0]).toMatchObject({
      id: "p-2026-11-02",
      start_date: "2026-11-02",
      length: 7,
      holidays: [],
      status: "draft",
      availabilityUsed: null,
    });
    expect(data.view).toEqual({ screen: "period", periodId: "p-2026-11-02", step: 2 });
    expect(data.inputVersion).toBe(0);
    expect(data.shop?.name).toBe("한강 다이닝");
  });

  it("월요일이면 그날부터 시작한다", () => {
    expect(demoData(doc(), "2026-11-09").periods[0].start_date).toBe("2026-11-09");
  });

  it("가능 시간을 같은 요일로 옮기고 기준 주 밖의 날짜는 버린다", () => {
    const { availability } = demoData(doc(), "2026-10-28").periods[0];
    expect(availability).toEqual({
      e01: { "2026-11-02": [["09:00", "21:00"]], "2026-11-03": [["16:00", "21:00"]] },
      e02: { "2026-11-04": [["09:00", "16:00"]] },
    });
  });

  it("공휴일이 든 주로 옮겨도 공휴일을 비운다", () => {
    const period = demoData(doc(), "2026-12-16").periods[0];
    expect(period.start_date).toBe("2026-12-21");
    expect(period.holidays).toEqual([]);
  });
});

describe("requestSignature", () => {
  it("규칙 순서가 달라도 같다", () => {
    expect(requestSignature(request([noOpenAfterClose, leaderClose]))).toBe(
      requestSignature(request([leaderClose, noOpenAfterClose])),
    );
  });

  it("가능 시간 규칙, 칸 고정, 꺼진 규칙은 영향이 없다", () => {
    const off = { ...leaderClose, id: "r-off", enabled: false } as ConstraintSpec;
    expect(requestSignature(request([noOpenAfterClose, leaderClose, avail, fixed, off]))).toBe(
      requestSignature(request([noOpenAfterClose, leaderClose])),
    );
  });

  it("반드시/가능하면이나 값이 바뀌면 다르다", () => {
    const base = requestSignature(request([noOpenAfterClose, leaderClose]));
    const soft = { ...leaderClose, hardness: "soft" } as ConstraintSpec;
    const value = { ...leaderClose, values: { min: { value: 0, label: "최소 리더 인원" } } } as ConstraintSpec;
    expect(requestSignature(request([noOpenAfterClose, soft]))).not.toBe(base);
    expect(requestSignature(request([noOpenAfterClose, value]))).not.toBe(base);
  });

  it("규칙을 끄면 다르다", () => {
    const off = { ...leaderClose, enabled: false } as ConstraintSpec;
    expect(requestSignature(request([noOpenAfterClose, off]))).not.toBe(
      requestSignature(request([noOpenAfterClose, leaderClose])),
    );
  });
});

describe("demoExplanation", () => {
  const req = request([noOpenAfterClose, leaderClose]);
  const response = { text: "화요일 주방 마감에 리더가 없어요.", proposals: [], fallback: false };

  it("signature가 같으면 input_version을 붙여 돌려준다", () => {
    const d = doc({ explanation: { signature: requestSignature(req), response } });
    expect(demoExplanation(d, request([leaderClose, noOpenAfterClose, avail]), 7)).toEqual({ ...response, input_version: 7 });
  });

  it("signature가 다르면 null", () => {
    const d = doc({ explanation: { signature: requestSignature(req), response } });
    expect(demoExplanation(d, request([noOpenAfterClose]), 1)).toBeNull();
  });

  it("저장된 설명이 없으면 null", () => {
    expect(demoExplanation(doc(), req, 1)).toBeNull();
  });

  it("설명·제안 문장의 기준 주 날짜를 요청 근무표의 같은 요일 날짜로 옮긴다", () => {
    const dated = {
      text: "서민호는 11/10, 11/15에 마감이 불가능해 11/10에는 리더가 없어요. 1/10은 그대로예요.",
      proposals: [{ title: "11/10만 끄기", description: "11/9~11/15 중 11/10", changes: [] }],
      fallback: false,
    };
    const d = doc({ explanation: { signature: requestSignature(req), response: dated } });
    // 기준 주 11/9(월)~11/15(일) → 11/23(월)~11/29(일)
    const moved = { ...request([noOpenAfterClose, leaderClose]), period: { start_date: "2026-11-23", length: 7 } };
    expect(demoExplanation(d, moved, 3)).toEqual({
      text: "서민호는 11/24, 11/29에 마감이 불가능해 11/24에는 리더가 없어요. 1/10은 그대로예요.",
      proposals: [{ title: "11/24만 끄기", description: "11/23~11/29 중 11/24", changes: [] }],
      fallback: false,
      input_version: 3,
    });
  });
});

describe("demoLinkRows", () => {
  it("가능 시간이 있는 직원만 제출 시각을 갖고, 명단 순서를 따른다", () => {
    const { availability } = doc();
    const rows = demoLinkRows(availability, EMPLOYEES, "2026-11-01T09:00:00Z");
    expect(rows).toEqual([
      { token: "", employee_id: "e01", slots: availability.e01, submitted_at: "2026-11-01T09:00:00Z" },
      { token: "", employee_id: "e02", slots: availability.e02, submitted_at: "2026-11-01T09:00:00Z" },
      { token: "", employee_id: "e03", slots: {}, submitted_at: null },
    ]);
  });
});

describe("demoLeaveCard", () => {
  // 2026-11-23은 월요일 → 화~목은 11/24~11/26
  const period = { start_date: "2026-11-23", length: 7 };
  const assignments = {
    e01: ["A", "O", "O", "A", "A", "O", "O"],
    e02: ["A", "C", "C", "C", "O", "O", "O"],
    e03: ["O", "M", "M", "O", "A", "A", "O"],
  };

  it("화~목에 가장 많이 일하는 직원의 병가 요청을 만든다", () => {
    const card = demoLeaveCard(period, assignments, EMPLOYEES);
    expect(isLeaveRule(card)).toBe(true);
    expect(card).toMatchObject({ scope: "period", source_text: "서민호 11/24~11/26 병가" });
    expect(JSON.stringify(card.type === "rule" && card.body)).toContain('"ids":["e02"]');
    expect(JSON.stringify(card.type === "rule" && card.body)).toContain('"days":[2,3,4]');
  });
});
