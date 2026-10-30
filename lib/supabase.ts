// Supabase 얇은 래퍼: Google 로그인과 매장 문서(shops 1행) load/save/delete (ADR-014).
// 접근 제어는 RLS(owner_id = auth.uid())가 한다. 오류는 Error로 throw한다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
