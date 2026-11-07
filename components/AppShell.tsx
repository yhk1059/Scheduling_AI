"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { demoData } from "@/lib/demo";
import { DEMO_DOC } from "@/lib/demo-doc";
import { useAppStore } from "@/lib/store";
import { onAuthChange, supabaseConfigured } from "@/lib/supabase";
import { PRODUCT_NAME } from "@/lib/product";
import { unitShort } from "@/lib/wording";

import { AccountBar } from "./Account";
import ConfirmedPeriod from "./ConfirmedPeriod";
import { DemoBar } from "./Demo";
import PeriodWork from "./PeriodWork";
import LoginScreen from "./LoginScreen";
import { ui } from "./ui";
import Wordmark from "./Wordmark";
import ShopHome from "./ShopHome";
import ShopSettings from "./ShopSettings";
import ShopSetup from "./ShopSetup";
import { today } from "./RulesStep";

/** demo: 로그인 없이 샘플 매장을 메모리에서 눌러 보는 체험(/demo). 로그인한 사용자는 /app으로 보낸다. */
export default function AppShell({ demo = false }: { demo?: boolean }) {
  const router = useRouter();
  const shop = useAppStore((s) => s.shop);
  const view = useAppStore((s) => s.view);
  const go = useAppStore((s) => s.go);
  const storageAvailable = useAppStore((s) => s.storageAvailable);
  const resetNotice = useAppStore((s) => s.resetNotice);
  const dismissResetNotice = useAppStore((s) => s.dismissResetNotice);
  const auth = useAppStore((s) => s.auth);
  const syncStatus = useAppStore((s) => s.sync.status);
  const retrySave = useAppStore((s) => s.retrySave);
  // 첫 세션 확인 전에는 로그인 화면을 띄우지 않는다
  const [authChecked, setAuthChecked] = useState(!supabaseConfigured);
  // 체험에서는 세션을 store에 올리지 않고 있는지만 본다
  const [hasUser, setHasUser] = useState(false);
  const loading = demo
    ? !authChecked || shop === null
    : !authChecked || (auth !== null && syncStatus === "loading");
  const started = (demo || auth !== null) && shop !== null && !loading;
  const loginScreen = !demo && !loading && auth === null;

  useEffect(() => {
    if (!supabaseConfigured) return;
    return onAuthChange((user) => {
      if (demo) {
        setHasUser(user !== null);
        setAuthChecked(true);
        return;
      }
      const s = useAppStore.getState();
      // 토큰 갱신 등으로 같은 사용자가 다시 오면 서버 문서를 다시 읽지 않는다
      if (user && s.auth?.userId !== user.id) void s.signedIn(user);
      // 세션이 끝난 채 다시 열어도 남은 캐시를 지운다. 다음 로그인 계정에 올라가지 않게 한다
      else if (!user && (s.auth || s.hasInput())) s.signedOut();
      setAuthChecked(true);
    });
  }, [demo]);

  useEffect(() => {
    if (!demo || !authChecked) return;
    if (hasUser) router.replace("/app");
    // StrictMode에서 두 번 돌아도 이미 체험 중이면 다시 채우지 않는다
    else if (!useAppStore.getState().demo) useAppStore.getState().enterDemo(demoData(DEMO_DOC, today()));
  }, [demo, authChecked, hasUser, router]);

  // 체험을 떠나면 메모리 상태를 비운다
  useEffect(() => {
    if (!demo) return;
    return () => useAppStore.getState().exitDemo();
  }, [demo]);

  const tabs = [
    {
      label: "매장 설정",
      current: view.screen === "settings",
      onClick: () => go({ screen: "settings", tab: "shifts" }),
    },
    { label: "근무표", current: view.screen === "home", onClick: () => go({ screen: "home" }) },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[#E2E2DC] bg-white">
        <div className="mx-auto flex h-[60px] max-w-[1360px] items-center justify-between px-10">
          <div className="flex items-center gap-3">
            {/* 매장 준비를 건너뛰지 않게 그 화면에서는 앱 홈으로 보내지 않는다 */}
            {demo ? (
              <Wordmark size="bar" href="/" />
            ) : started && view.screen !== "setup" ? (
              <button
                type="button"
                aria-label={`${PRODUCT_NAME} 홈`}
                onClick={() => go({ screen: "home" })}
                className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155E75]"
              >
                <Wordmark size="bar" />
              </button>
            ) : (
              <Wordmark size="bar" href="/" />
            )}
            {started && (
              <>
                <span aria-hidden="true" className="h-5 w-px bg-[#E2E2DC]" />
                <span className="text-sm font-medium text-[#1B1B18]">
                  {shop.name || "이름 없는 매장"}
                  <span className="text-[13px] font-normal text-[#66665E]"> · {unitShort(shop.unit)}</span>
                </span>
              </>
            )}
          </div>
          {demo ? <DemoBar /> : !loginScreen && <AccountBar />}
        </div>
        {started && view.screen !== "setup" && (
          <nav className="mx-auto flex h-11 max-w-[1360px] px-10">
            {tabs.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={t.onClick}
                aria-current={t.current ? "page" : undefined}
                className={`mr-5 h-11 border-b-2 px-1 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155E75] ${
                  t.current
                    ? "border-[#155E75] font-semibold text-[#1B1B18]"
                    : "border-transparent font-medium text-[#3D3D38] hover:text-[#1B1B18]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-5 px-10 py-6">
        {demo && (
          <p
            role="status"
            className="rounded-lg border border-[#CFE4EA] bg-[#F0F6F8] px-4 py-2.5 text-sm text-[#1B1B18]"
          >
            샘플 매장 한강 다이닝을 눌러 보고 있어요. 바꾼 내용은 저장되지 않고, 새로고침하면 처음으로 돌아가요.
          </p>
        )}
        {!demo && !storageAvailable && (
          <p role="status" className={ui.banner}>
            이 브라우저에서는 저장소를 쓸 수 없어요. 저장에 실패하면 입력이 사라질 수 있어요.
          </p>
        )}
        {resetNotice && (
          <div role="status" className={ui.banner}>
            저장된 데이터가 손상되었거나 이전 버전이라 처음 상태로 초기화했어요.
            <button type="button" onClick={dismissResetNotice} className={ui.textSm}>
              닫기
            </button>
          </div>
        )}

        {!demo && started && syncStatus === "error" && (
          <div role="status" className={ui.banner}>
            저장하지 못했어요. 이 브라우저에 보관하고 있어요
            <button type="button" onClick={() => void retrySave()} className={ui.textSm}>
              다시 시도
            </button>
          </div>
        )}

        {loading ? (
          <p role="status" className="text-sm text-[#3D3D38]">
            불러오는 중…
          </p>
        ) : !demo && auth === null ? (
          <LoginScreen />
        ) : !started ? (
          <div role="alert" className={ui.banner}>
            내 매장을 불러오지 못했어요. 잠시 후 다시 시도해 주세요
            <button type="button" onClick={() => void retrySave()} className={ui.textSm}>
              다시 시도
            </button>
          </div>
        ) : view.screen === "home" ? (
          <ShopHome />
        ) : view.screen === "setup" ? (
          <ShopSetup />
        ) : view.screen === "settings" ? (
          <ShopSettings />
        ) : view.screen === "confirmed" ? (
          <ConfirmedPeriod key={view.periodId} />
        ) : (
          <PeriodWork />
        )}
      </main>
    </div>
  );
}
