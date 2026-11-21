"use client";

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

/** demo: 샘플 매장을 메모리에서 눌러 보는 체험(/demo). 로그인한 사용자도 열 수 있고, 내 매장에는 저장하지 않는다. */
export default function AppShell({ demo = false }: { demo?: boolean }) {
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
  const loading = demo
    ? !authChecked || shop === null
    : !authChecked || (auth !== null && syncStatus === "loading");
  const started = (demo || auth !== null) && shop !== null && !loading;
  const loginScreen = !demo && !loading && auth === null;

  useEffect(() => {
    if (!supabaseConfigured) return;
    return onAuthChange((user) => {
      // 체험에서는 세션을 store에 올리지 않는다
      if (demo) {
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
    // StrictMode에서 두 번 돌아도 이미 체험 중이면 다시 채우지 않는다
    if (!useAppStore.getState().demo) useAppStore.getState().enterDemo(demoData(DEMO_DOC, today()));
  }, [demo, authChecked]);

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
    <div data-app-shell className="flex flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-[#EDEDEA] bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex flex-wrap gap-3 py-3 min-h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {/* 매장 준비를 건너뛰지 않게 그 화면에서는 앱 홈으로 보내지 않는다 */}
            {demo ? (
              <Wordmark size="bar" href="/" />
            ) : started && view.screen !== "setup" ? (
              <button
                type="button"
                aria-label={`${PRODUCT_NAME} 홈`}
                onClick={() => go({ screen: "home" })}
                className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C4247C]"
              >
                <Wordmark size="bar" />
              </button>
            ) : (
              <Wordmark size="bar" href="/" />
            )}
            {started && (
              <>
                <span aria-hidden="true" className="h-5 w-px bg-[#EDEDEA]" />
                <span className="text-sm font-medium text-[#111214]">
                  {shop.name || "이름 없는 매장"}
                  <span className="text-[13px] font-normal text-[#6B6F78]"> · {unitShort(shop.unit)}</span>
                </span>
              </>
            )}
          </div>
          {demo ? <DemoBar /> : !loginScreen && <AccountBar />}
        </div>
        {started && view.screen !== "setup" && (
          <nav className="mx-auto flex max-w-[1200px] gap-1 px-4 pb-3 sm:px-6">
            {tabs.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={t.onClick}
                aria-current={t.current ? "page" : undefined}
                className={`h-9 rounded-full px-4 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C4247C] ${
                  t.current
                    ? "bg-[#111214] font-semibold text-white"
                    : "font-medium text-[#4B4F57] hover:bg-[#F5F5F4] hover:text-[#111214]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 sm:px-6 py-10">
        {demo && (
          <p
            role="status"
            className="flex items-center gap-2.5 rounded-2xl bg-[#F5F5F4] px-5 py-3 text-sm text-[#111214]"
          >
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[#EE46BC]" />
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
          <p role="status" className="text-sm text-[#4B4F57]">
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
