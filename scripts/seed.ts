// 수동 테스트용 시드. e2e 테스트 계정의 매장을 지우고 고른 버전으로 채운 뒤, 그 계정으로 로그인한 브라우저를 연다.
// 실행: npm run dev를 띄운 채 npm run seed -- <버전> (--no-open이면 브라우저를 열지 않는다)
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { AvailabilitySlots } from "../lib/availability";
import { localDate } from "../lib/period";
import { buildScenario, SEED_LABELS, SEED_SCENARIOS, type SeedDoc, type SeedScenario } from "../lib/seed-scenarios";

const APP_URL = "http://localhost:3000/app";

export function parseSeedArgs(args: string[]): { scenario: SeedScenario; open: boolean } {
  const scenario = args.find((a) => !a.startsWith("--")) as SeedScenario | undefined;
  if (!scenario || !SEED_SCENARIOS.includes(scenario)) {
    const list = SEED_SCENARIOS.map((s) => `  ${s} (${SEED_LABELS[s]})`).join("\n");
    throw new Error(`버전을 골라 주세요: npm run seed -- <버전>\n${list}`);
  }
  return { scenario, open: !args.includes("--no-open") };
}

/** 근무표의 직원별 링크 행. 토큰은 DB가 정한다. slots에 없는 직원은 미제출이다. */
export function linkRows(doc: SeedDoc, slots: Record<string, AvailabilitySlots>, shopId: string, submittedAt: string) {
  const { shop, periods } = doc.state;
  return shop.employees.map((e) => ({
    shop_id: shopId,
    period_start: periods[0].start_date,
    period_length: periods[0].length,
    employee_id: e.id,
    employee_name: e.name,
    shop_name: shop.name,
    slots: slots[e.id] ?? {},
    submitted_at: slots[e.id] ? submittedAt : null,
  }));
}

/** supabase-js가 세션을 두는 localStorage 키. */
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`.env.local에 ${name}이 필요해요`);
  return v;
}

async function main() {
  const { scenario, open } = parseSeedArgs(process.argv.slice(2));
  process.loadEnvFile(".env.local");

  // 대상은 언제나 테스트 계정이다. RLS라 그 계정의 행만 지워진다
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const db = createClient(url, env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.signInWithPassword({ email: env("E2E_TEST_EMAIL"), password: env("E2E_TEST_PASSWORD") });
  if (authError) throw new Error(`테스트 계정 로그인 실패: ${authError.message}`);

  const { doc, slots } = buildScenario(scenario, localDate(new Date()));
  const { shop, periods } = doc.state;

  // shops 행을 지우면 링크와 공용 링크 행도 함께 지워진다(on delete cascade)
  const { error: deleteError } = await db.from("shops").delete().eq("owner_id", auth.user.id);
  if (deleteError) throw new Error(deleteError.message);
  const { data: row, error: shopError } = await db.from("shops").insert({ owner_id: auth.user.id, data: doc }).select("id").single();
  if (shopError) throw new Error(shopError.message);
  const { error: linkError } = await db.from("availability_links").insert(linkRows(doc, slots, row.id, new Date().toISOString()));
  if (linkError) throw new Error(linkError.message);
  console.log(`${shop.name}: 직원 ${shop.employees.length}명 중 ${Object.keys(slots).length}명 제출, ${periods[0].start_date}부터 ${periods[0].length}일`);

  if (!open) return;

  const server = await fetch(APP_URL).catch(() => null);
  if (!server?.ok) throw new Error(`시드는 넣었어요. 브라우저를 열려면 먼저 npm run dev를 띄워 주세요 (${APP_URL})`);

  // 앱 코드를 바꾸지 않고, 테스트 계정 세션을 새 브라우저의 저장소에 넣어 로그인 상태로 연다
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await context.addInitScript(
    ([key, session]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, session);
    },
    [authStorageKey(url), JSON.stringify(auth.session)],
  );
  const page = await context.newPage();
  await page.goto(APP_URL);
  console.log("브라우저를 닫으면 끝나요.");
  await new Promise((resolve) => browser.on("disconnected", resolve));
}

if (!process.env.VITEST) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
