import { describe, expect, it } from "vitest";

import { LIVE_SENTENCES, PRESET_RULES, PRESET_SENTENCES, ROSTER, SCREEN_EMPLOYEE, slotsFor, storedTranslation, TYPED_STAFF } from "./record-dining";

const WEEK = { start_date: "2026-11-09", length: 7 };

describe("ROSTER", () => {
  it("시나리오의 직원 20명과 가능 시간", () => {
    expect(ROSTER).toHaveLength(20);
    const minho = ROSTER.find((r) => r.name === SCREEN_EMPLOYEE)!;
    expect(minho.tags).toEqual(["주방", "리더"]);
    // 화요일만 비우고 주말은 불가
    expect(minho.week.map((t) => t !== null)).toEqual([true, false, true, true, true, false, false]);
  });

  it("화면에서 입력할 3명이 명단 맨 앞에 있다", () => {
    expect(ROSTER.slice(0, 3).map((r) => r.name)).toEqual(TYPED_STAFF);
  });
});

describe("문장과 저장된 번역", () => {
  it("직접 입력 2문장과 미리 넣을 3문장은 체험과 같은 5문장이다", () => {
    expect(LIVE_SENTENCES).toHaveLength(2);
    expect(PRESET_SENTENCES).toHaveLength(3);
    expect(new Set([...LIVE_SENTENCES, ...PRESET_SENTENCES]).size).toBe(5);
  });

  it("직접 입력 문장마다 저장된 카드와 예시 판정을 돌려준다", () => {
    for (const text of LIVE_SENTENCES) {
      const res = storedTranslation(text, 4)!;
      expect(res.status).toBe("ok");
      expect(res.input_version).toBe(4);
      expect(res.constraints.length, text).toBeGreaterThan(0);
      expect(Object.keys(res.examples ?? {}).every((id) => res.constraints.some((c) => c.id === id))).toBe(true);
    }
  });

  it("예시가 아닌 문장은 저장된 번역이 없다", () => {
    expect(storedTranslation("일요일은 휴무로 해 주세요", 0)).toBeNull();
  });

  it("미리 넣는 문장마다 저장된 적용 규칙이 있다", () => {
    for (const text of PRESET_SENTENCES) expect(PRESET_RULES.some((r) => text.includes(r.source_text)), text).toBe(true);
  });
});

describe("slotsFor", () => {
  it("요일별 가능 시간을 날짜별 슬롯으로 바꾸고 불가인 날은 뺀다", () => {
    const slots = slotsFor([["09:00", "21:00"], null, ["16:00", "21:00"], null, null, null, ["09:00", "16:00"]], WEEK);
    expect(slots).toEqual({
      "2026-11-09": [["09:00", "21:00"]],
      "2026-11-11": [["16:00", "21:00"]],
      "2026-11-15": [["09:00", "16:00"]],
    });
  });
});
