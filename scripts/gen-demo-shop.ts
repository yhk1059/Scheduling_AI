// 랜딩 [체험하기](/demo)의 체험 데이터 lib/samples/demo-shop.json을 만든다(한강 다이닝, docs/DEMO_SCENARIO.md).
// 실행: npm run fastapi-dev를 띄운 채 npm run gen:demo-shop. 체험용 문장 5개(DEMO_*_SENTENCES)의 번역과 해 없음 설명을 지금 받아 두어, 체험할 때는 LLM을 부르지 않는다.
// 카드는 앱과 같은 store 액션(addPendingRules, applyRule)으로 넣는다.
import { writeFileSync } from "node:fs";

import type { AvailabilitySlots } from "../lib/availability";
import { type DemoDoc, requestSignature } from "../lib/demo";
import { periodFrom, type PeriodRange } from "../lib/period";
import { STORAGE_VERSION } from "../lib/rules";
import { createAppStore, newPeriod, refEmployees, toScheduleRequest } from "../lib/store";
import type { ConstraintSpec, ExplainResponse, RuleExample, ShiftChange, SolveResponse } from "../lib/types.gen";
import { DEMO_LIVE_SENTENCES, DEMO_PRESET_SENTENCES, ROSTER, SHIFT_EDITS, SHOP_NAME, slotsFor } from "./dining-data";

const API_URL = "http://127.0.0.1:8000";
const OUT = "lib/samples/demo-shop.json";
const MAX_TRIES = 3;

type Store = ReturnType<typeof createAppStore>;

/** 순수: ROSTER와 기준 주로 직원 id별 가능 시간. 직원 id는 명단 순서대로 e01, e02, …(store의 addEmployees가 매기는 것과 같다). */
export function demoAvailability(base: PeriodRange): Record<string, AvailabilitySlots> {
  return Object.fromEntries(
    ROSTER.flatMap((r, i) => {
      const slots = slotsFor(r.week, base);
      return Object.keys(slots).length === 0 ? [] : [[`e${String(i + 1).padStart(2, "0")}`, slots]];
    }),
  );
}

/** 순수: 빈 store에 한강 다이닝 매장을 만든다(이름, 1주 단위, 직원 20명과 태그, SHIFT_EDITS의 근무조 시각·실근무 시간). 번역은 하지 않는다. */
export function seedDiningShop(store: Store): void {
  const s = store.getState();
  s.startShop();
  s.setShopName(SHOP_NAME);
  s.setUnit("1w");
  s.addEmployees(ROSTER.map(({ name, tags }) => ({ name, tags })));
  for (const { code, end, hours } of SHIFT_EDITS) s.setShift(code, { end, hours: Number(hours) });
}

/** 메모리 Storage. 스크립트는 브라우저 저장소를 쓰지 않는다. */
class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

interface TranslateBody {
  status: string;
  constraints?: ConstraintSpec[];
  config_changes?: ShiftChange[];
  examples?: Record<string, RuleExample[]>;
}

/** 문장을 번역해 대기 카드로 넣고 새 대기 카드 id를 돌려준다. 직원 id로 묶인 규칙이 나오면 다시 번역한다. */
async function translateInto(store: Store, text: string, retries: { count: number }): Promise<string[]> {
  for (let attempt = 1; ; attempt++) {
    const { shop, periods } = store.getState();
    const today = periods[0].start_date;
    const { config, employees, period, holidays } = toScheduleRequest(shop!, periods[0], periods, today);
    const body = await post<TranslateBody>("/api/py/translate", {
      text,
      scope: "shop",
      context: { config, employees, period, holidays, today },
      input_version: 0,
    });
    if (body.status !== "ok") throw new Error(`"${text}" 번역 실패: ${JSON.stringify(body).slice(0, 300)}`);
    const constraints = body.constraints ?? [];
    // 태그 대신 직원 id로 묶이면 카드 문장이 길고 뜻이 흐려진다(DEMO_SCENARIO "남은 위험")
    if (constraints.some((c) => refEmployees(c).length > 0)) {
      if (attempt >= MAX_TRIES) throw new Error(`"${text}"이 ${MAX_TRIES}번 모두 직원 id로 묶였어요`);
      retries.count++;
      console.log(`  "${text}" 직원 id로 묶여 다시 번역 (${attempt}/${MAX_TRIES})`);
      continue;
    }
    const before = new Set([...shop!.pendingConfig, ...shop!.pendingRules].map((c) => c.id));
    store.getState().addPendingRules(constraints, body.config_changes ?? [], body.examples ?? {});
    const after = store.getState().shop!;
    console.log(`  "${text}" → 규칙 ${constraints.length}개`);
    return [...after.pendingConfig, ...after.pendingRules].map((c) => c.id).filter((id) => !before.has(id));
  }
}

async function main(): Promise<void> {
  process.loadEnvFile(".env.local");
  if (!(await fetch(`${API_URL}/api/py/health`).catch(() => null))?.ok) throw new Error("먼저 npm run fastapi-dev를 띄워 주세요");

  const store = createAppStore(() => new MemoryStorage());
  seedDiningShop(store);
  const base = periodFrom("1w", "2026-11-09");
  const availability = demoAvailability(base);
  store.setState({ periods: [{ ...newPeriod(base), holidays: [], availability }] });

  const retries = { count: 0 };
  for (const text of DEMO_PRESET_SENTENCES) {
    for (const id of await translateInto(store, text, retries)) store.getState().applyRule(id);
  }
  for (const text of DEMO_LIVE_SENTENCES) await translateInto(store, text, retries);
  // 체험은 직접 입력하는 2문장의 카드가 대기 중인 상태에서 시작한다
  const shopDoc = structuredClone(store.getState().shop!);

  for (const c of [...shopDoc.pendingConfig, ...shopDoc.pendingRules]) store.getState().applyRule(c.id);
  const { shop, periods } = store.getState();
  const req = toScheduleRequest(shop!, periods[0], periods, base.start_date);
  const solved = await post<SolveResponse>("/api/py/solve", { ...req, input_version: 0 });
  if (solved.status !== "infeasible") throw new Error(`시나리오가 깨졌어요: 해 없음이 아니에요 (${solved.status})`);

  let explained: ExplainResponse | null = null;
  for (let attempt = 1; attempt <= MAX_TRIES && !explained; attempt++) {
    const res = await post<ExplainResponse>("/api/py/explain", { request: { ...req, input_version: 0 }, conflicts: solved.conflicts });
    if (res.proposals.some((p) => p.verified_summary)) explained = res;
    else {
      if (attempt < MAX_TRIES) retries.count++;
      console.log(`  검증된 제안 없음 (${attempt}/${MAX_TRIES})`);
    }
  }
  if (!explained) throw new Error(`설명을 ${MAX_TRIES}번 받았지만 검증된 제안이 없어요`);

  const { text, proposals, fallback } = explained;
  const doc: DemoDoc = {
    version: STORAGE_VERSION,
    shop: shopDoc,
    base,
    availability,
    explanation: { signature: requestSignature(req), response: { text, proposals, fallback } },
  };
  writeFileSync(OUT, JSON.stringify(doc) + "\n");
  const verified = proposals.filter((p) => p.verified_summary).length;
  const pending = shopDoc.pendingRules.length + shopDoc.pendingConfig.length;
  console.log(
    `${OUT} 저장: 직원 ${shopDoc.employees.length}명, 적용된 규칙 ${shopDoc.rules.length}개, 대기 카드 ${pending}장, 검증된 제안 ${verified}개, 재시도 ${retries.count}번`,
  );
}

if (!process.env.VITEST) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
