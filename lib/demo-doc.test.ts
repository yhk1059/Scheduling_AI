import { describe, expect, it } from "vitest";

import { requestSignature, demoData } from "./demo";
import { DEMO_DOC } from "./demo-doc";
import { STORAGE_VERSION } from "./rules";
import { createAppStore, refEmployees, toScheduleRequest } from "./store";

// scripts/dining-data.ts의 문장. 생성된 JSON을 스크립트 모듈과 따로 검사하려고 여기 적는다
const LIVE = ["홀은 평일에 오픈 2명, 미들 1명, 마감 3명", "홀 마감과 주방 마감에는 리더가 꼭 1명씩 있어야 해"];
const PRESET = [
  "홀은 주말에 오픈 2명, 미들 2명, 마감 4명",
  "주방은 평일에 오픈 2명, 미들 1명, 마감 2명",
  "주방은 주말에 오픈 2명, 미들 1명, 마감 3명",
  "마감 다음 날 오픈은 안 되게",
  "일주일에 이틀은 꼭 쉬게",
  "마감에는 파트별로 신입이 1명까지만",
  "마감은 파트 안에서 돌아가면서 고르게",
  "근무 일수도 고르게",
];
const TODAY = "2026-11-09";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

/** 번역은 한 문장을 규칙 여러 개로 나누고 원문도 그 조각으로 둘 수 있다. 원문이 어느 문장에서 나왔는지. */
const sentenceOf = (sentences: string[], source: string) => sentences.find((s) => s.includes(source));

describe("DEMO_DOC", () => {
  const { shop } = DEMO_DOC;

  it("현재 저장 형식이고 직원은 20명", () => {
    expect(DEMO_DOC.version).toBe(STORAGE_VERSION);
    expect(shop.employees).toHaveLength(20);
  });

  it("직접 입력하는 2문장은 대기 카드로 남아 있다", () => {
    expect(shop.pendingRules.every((c) => sentenceOf(LIVE, c.source_text))).toBe(true);
    expect(new Set(shop.pendingRules.map((c) => sentenceOf(LIVE, c.source_text)))).toEqual(new Set(LIVE));
  });

  it("미리 넣는 8문장은 적용돼 있다", () => {
    const applied = new Set(shop.rules.map((c) => sentenceOf(PRESET, c.source_text)));
    for (const s of PRESET) expect(applied).toContain(s);
  });

  it("가능 시간은 20명 모두 있고 서민호(e02)는 화요일이 비어 있다", () => {
    expect(Object.keys(DEMO_DOC.availability)).toHaveLength(20);
    expect(DEMO_DOC.availability.e02).not.toHaveProperty("2026-11-10");
  });

  it("해 없음 설명에 검증된 제안이 있다", () => {
    expect(DEMO_DOC.explanation).not.toBeNull();
    expect(DEMO_DOC.explanation!.response.proposals.filter((p) => p.verified_summary).length).toBeGreaterThan(0);
  });

  it("대기 카드를 모두 적용한 체험 상태의 요청이 저장한 설명의 signature와 같다", () => {
    const store = createAppStore(memoryStorage);
    store.setState(demoData(DEMO_DOC, TODAY));
    const s = store.getState();
    for (const c of [...s.shop!.pendingConfig, ...s.shop!.pendingRules]) store.getState().applyRule(c.id);
    const { shop: applied, periods } = store.getState();
    const req = toScheduleRequest(applied!, periods[0], periods, TODAY);
    expect(requestSignature(req)).toBe(DEMO_DOC.explanation!.signature);
  });

  it("직원 id로 묶인 규칙이 없다", () => {
    expect([...shop.rules, ...shop.pendingRules].filter((c) => refEmployees(c).length > 0)).toEqual([]);
  });
});
