// Supabase 얇은 래퍼: Google 로그인, 매장 문서(shops 1행) load/save/delete (ADR-014), 직원 링크(ADR-020).
// 접근 제어는 RLS(owner_id = auth.uid())가 한다. 오류는 Error로 throw한다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AvailabilitySlots } from "./availability";
import type { PeriodRange } from "./period";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** env가 없으면 false. 이때 앱은 로그인 설정 안내만 보인다(빌드는 env 없이도 돌아야 함). */
export const supabaseConfigured: boolean = Boolean(URL && ANON_KEY);

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  if (!URL || !ANON_KEY) throw new Error("Supabase env is not configured");
  client ??= createClient(URL, ANON_KEY, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" },
  });
  return client;
}

export interface AuthUser {
  id: string;
  email: string | null;
}

/** 로그인 상태가 바뀔 때마다 알린다. 초기 세션도 한 번 알린다(INITIAL_SESSION). 해제 함수를 돌려준다. */
export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  const { data } = supabase().auth.onAuthStateChange((_event, session) => {
    const u = session?.user;
    cb(u ? { id: u.id, email: u.email ?? null } : null);
  });
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/app` },
  });
  if (error) throw new Error(error.message);
}

// e2e 전용 로그인(ADR-020). NEXT_PUBLIC_E2E_LOGIN이 빌드에 없으면 이 코드는 번들에 들어가지 않는다.
if (process.env.NEXT_PUBLIC_E2E_LOGIN === "1" && typeof window !== "undefined") {
  (window as unknown as { __e2eSignIn: (email: string, password: string) => Promise<void> }).__e2eSignIn = async (email, password) => {
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase().auth.signOut();
  if (error) throw new Error(error.message);
}

export interface ShopRow {
  data: unknown;
  updatedAt: string;
}

/** 내 매장 문서. 없으면 null. RLS가 내 행만 보여 준다. */
export async function loadShop(): Promise<ShopRow | null> {
  const { data, error } = await supabase()
    .from("shops")
    .select("data, updated_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { data: data.data, updatedAt: data.updated_at as string } : null;
}

/** 내 매장 문서를 통째로 저장한다(owner_id 기준 upsert, 마지막 저장이 이김). */
export async function saveShop(userId: string, data: unknown): Promise<{ updatedAt: string }> {
  const { data: row, error } = await supabase()
    .from("shops")
    .upsert({ owner_id: userId, data }, { onConflict: "owner_id" })
    .select("updated_at")
    .single();
  if (error) throw new Error(error.message);
  return { updatedAt: row.updated_at as string };
}

/** 내 매장 문서를 지운다. Google 계정 연결은 남는다. */
export async function deleteShop(): Promise<void> {
  const { data, error: authError } = await supabase().auth.getUser();
  if (authError || !data.user) throw new Error(authError?.message ?? "Not signed in");
  const { error } = await supabase().from("shops").delete().eq("owner_id", data.user.id);
  if (error) throw new Error(error.message);
}

export interface AvailabilityLink {
  token: string;
  employee_id: string;
  slots: AvailabilitySlots;
  submitted_at: string | null;
}

const LINK_COLUMNS = "token, employee_id, slots, submitted_at";

/** 이 근무표의 링크 행들. */
export async function loadAvailabilityLinks(periodStart: string): Promise<AvailabilityLink[]> {
  const { data, error } = await supabase().from("availability_links").select(LINK_COLUMNS).eq("period_start", periodStart);
  if (error) throw new Error(error.message);
  return data as AvailabilityLink[];
}

// 시작일을 빠르게 바꿔도 앞선 호출의 삭제가 뒤 호출의 행을 지우지 않게 차례로 돌린다
let linkQueue: Promise<unknown> = Promise.resolve();

/**
 * 작성 중 근무표의 공용 링크와 직원 행을 맞춘다. 없는 직원의 행은 만들고(토큰은 DB가 정한다), 있는 행은 이름만 고친다.
 * 잠기지 않은 다른 시작일의 행은 지운다(작성 중 근무표는 하나뿐이라 시작일이 바뀐 옛 행이다).
 * 명단에서 빠진 직원의 행도 지운다. 공용 링크의 명단에 남지 않게 한다.
 */
export function syncAvailabilityLinks(
  period: PeriodRange,
  employees: { id: string; name: string }[],
  shopName: string,
): Promise<{ shareToken: string; rows: AvailabilityLink[] }> {
  const work = async () => {
    const { data: shop, error: shopError } = await supabase().from("shops").select("id").maybeSingle();
    if (shopError || !shop) throw new Error(shopError?.message ?? "Shop not saved yet");
    const { error: deleteError } = await supabase()
      .from("availability_links")
      .delete()
      .eq("shop_id", shop.id)
      .neq("period_start", period.start_date)
      .is("locked_at", null);
    if (deleteError) throw new Error(deleteError.message);
    const { error: deleteShareError } = await supabase()
      .from("availability_shares")
      .delete()
      .eq("shop_id", shop.id)
      .neq("period_start", period.start_date)
      .is("locked_at", null);
    if (deleteShareError) throw new Error(deleteShareError.message);
    if (employees.length > 0) {
      const { error: deleteLeftError } = await supabase()
        .from("availability_links")
        .delete()
        .eq("shop_id", shop.id)
        .eq("period_start", period.start_date)
        .is("locked_at", null)
        .not("employee_id", "in", `(${employees.map((n) => JSON.stringify(n.id)).join(",")})`);
      if (deleteLeftError) throw new Error(deleteLeftError.message);
    }
    const { error } = await supabase()
      .from("availability_links")
      .upsert(
        employees.map((n) => ({
          shop_id: shop.id,
          period_start: period.start_date,
          period_length: period.length,
          employee_id: n.id,
          employee_name: n.name,
          shop_name: shopName,
        })),
        { onConflict: "shop_id,period_start,employee_id" },
      );
    if (error) throw new Error(error.message);
    const { error: shareError } = await supabase()
      .from("availability_shares")
      .upsert({ shop_id: shop.id, period_start: period.start_date }, { onConflict: "shop_id,period_start", ignoreDuplicates: true });
    if (shareError) throw new Error(shareError.message);
    const { data: share, error: readError } = await supabase()
      .from("availability_shares")
      .select("token")
      .eq("shop_id", shop.id)
      .eq("period_start", period.start_date)
      .single();
    if (readError) throw new Error(readError.message);
    return { shareToken: share.token as string, rows: await loadAvailabilityLinks(period.start_date) };
  };
  const run = linkQueue.then(work, work);
  linkQueue = run;
  return run;
}

/** 확정: 이 근무표의 링크를 잠근다. 이미 잠긴 행은 그대로 두어 다시 확정해도 처음 시각이 남는다. */
export async function lockAvailabilityLinks(periodStart: string): Promise<void> {
  for (const table of ["availability_links", "availability_shares"]) {
    const { error } = await supabase()
      .from(table)
      .update({ locked_at: new Date().toISOString() })
      .eq("period_start", periodStart)
      .is("locked_at", null);
    if (error) throw new Error(error.message);
  }
}

export interface AvailabilityRoster {
  shop_name: string;
  period_start: string;
  period_length: number;
  locked: boolean;
  employees: { employee_name: string; link_token: string; submitted: boolean }[];
}

/** 공용 링크로 명단을 읽는다. 없는 링크면 null. */
export async function getAvailabilityRoster(token: string): Promise<AvailabilityRoster | null> {
  const { data, error } = await supabase().rpc("get_availability_roster", { p_token: token });
  // 22P02: 토큰 형식이 아니다
  if (error?.code === "22P02") return null;
  if (error) throw new Error(error.message);
  const rows = data as (AvailabilityRoster["employees"][number] & Omit<AvailabilityRoster, "employees">)[];
  if (rows.length === 0) return null;
  const { shop_name, period_start, period_length, locked } = rows[0];
  return { shop_name, period_start, period_length, locked, employees: rows };
}

export interface EmployeeAvailability {
  shop_name: string;
  employee_name: string;
  period_start: string;
  period_length: number;
  slots: AvailabilitySlots;
  locked: boolean;
}

/** 고른 직원의 토큰으로 읽는다. 없으면 null. */
export async function getAvailability(token: string): Promise<EmployeeAvailability | null> {
  const { data, error } = await supabase().rpc("get_availability", { p_token: token });
  // 22P02: 토큰 형식이 아니다
  if (error?.code === "22P02") return null;
  if (error) throw new Error(error.message);
  return (data as EmployeeAvailability[])[0] ?? null;
}

/** 직원 제출. 잠겼거나 없는 링크는 throw하지 않고 그 상태를 돌려준다. */
export async function submitAvailability(token: string, slots: AvailabilitySlots): Promise<"ok" | "locked" | "not_found"> {
  const { error } = await supabase().rpc("submit_availability", { p_token: token, p_slots: slots });
  if (!error) return "ok";
  if (error.code === "P0001") return "locked";
  if (error.code === "P0002" || error.code === "22P02") return "not_found";
  throw new Error(error.message);
}
