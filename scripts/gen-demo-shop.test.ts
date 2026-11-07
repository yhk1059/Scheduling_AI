import { describe, expect, it } from "vitest";

import { periodFrom } from "../lib/period";
import { createAppStore } from "../lib/store";
import { demoAvailability, seedDiningShop } from "./gen-demo-shop";

const BASE = periodFrom("1w", "2026-11-09");

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

describe("demoAvailability", () => {
  it("20명 모두 가능 시간이 있고 서민호(e02)는 화요일이 비어 있다", () => {
    const av = demoAvailability(BASE);
    expect(Object.keys(av)).toHaveLength(20);
    expect(av.e02).not.toHaveProperty("2026-11-10");
    expect(av.e02["2026-11-09"]).toEqual([["09:00", "21:00"]]);
  });
});

describe("seedDiningShop", () => {
  it("한강 다이닝 매장: 1주 단위, 직원 20명과 태그, 근무조 시각", () => {
    const store = createAppStore(memoryStorage);
    seedDiningShop(store);
    const shop = store.getState().shop!;
    expect(shop.name).toBe("한강 다이닝");
    expect(shop.unit).toBe("1w");
    expect(shop.employees).toHaveLength(20);
    expect(shop.employees[1]).toMatchObject({ id: "e02", name: "서민호", tags: ["주방", "리더"], active: true });
    const byCode = Object.fromEntries(shop.config.shifts.map((s) => [s.code, s]));
    expect(byCode.A).toMatchObject({ start: "09:00", end: "14:00", hours: 5 });
    expect(byCode.M).toMatchObject({ start: "12:00", end: "16:00", hours: 4 });
    expect(byCode.C).toMatchObject({ start: "17:00", end: "21:00", hours: 4 });
  });
});
