"use client";

import { useEffect, useRef, useState } from "react";

import { setupStep, useAppStore } from "@/lib/store";
import { onAuthChange, supabaseConfigured } from "@/lib/supabase";
import { unitShort } from "@/lib/wording";

import { AccountBar, LoginPromptDialog } from "./Account";
import ConfirmedPeriod from "./ConfirmedPeriod";
import PeriodWork from "./PeriodWork";
import SetupFlow from "./SetupFlow";
import StartScreen from "./StartScreen";
import { ui } from "./ui";
import ShopHome from "./ShopHome";
import ShopSettings from "./ShopSettings";

export default function AppShell() {
  const shop = useAppStore((s) => s.shop);
  const view = useAppStore((s) => s.view);
  const go = useAppStore((s) => s.go);
  const storageAvailable = useAppStore((s) => s.storageAvailable);
  const resetNotice = useAppStore((s) => s.resetNotice);
  const dismissResetNotice = useAppStore((s) => s.dismissResetNotice);
  const auth = useAppStore((s) => s.auth);
  const syncStatus = useAppStore((s) => s.sync.status);
  const retrySave = useAppStore((s) => s.retrySave);
  // 매장이 있으면(게스트 입력 포함) 바로 들어간다. 게스트는 [시작 화면]으로 새로 시작을 다시 고를 수 있다(PRD J0)
  const [showStart, setShowStart] = useState(false);
  // 첫 세션 확인 전에는 시작 화면을 띄우지 않는다
  const [authChecked, setAuthChecked] = useState(!supabaseConfigured);
  const loading = !authChecked || (auth !== null && syncStatus === "loading");
  // 랜딩의 [내 매장으로 시작하기]: /app?start=new. 매장이 이미 있으면(로그인·게스트 입력) 그대로 들어간다
  const [startNew] = useState(() => new URLSearchParams(window.location.search).get("start") === "new");
  const started = !showStart && shop !== null && !loading;
  const startHandled = useRef(false);

  useEffect(() => {
    if (!startNew || loading || startHandled.current) return;
    startHandled.current = true;
    window.history.replaceState(null, "", "/app");
    const s = useAppStore.getState();
    if (s.auth === null && !s.hasInput()) s.startShop();
  }, [startNew, loading]);

  // 근무표를 한 번도 만들지 않은 매장은 처음 설정의 못 끝낸 첫 단계부터 연다
  useEffect(() => {
    if (!started) return;
    const s = useAppStore.getState();
    if (s.shop && s.periods.length === 0 && s.view.screen !== "setup") s.go({ screen: "setup", step: setupStep(s.shop) });
  }, [started]);

  useEffect(() => {
    if (!supabaseConfigured) return;
    return onAuthChange((user) => {
      const s = useAppStore.getState();
      // 토큰 갱신 등으로 같은 사용자가 다시 오면 서버 문서를 다시 읽지 않는다
      if (user && s.auth?.userId !== user.id) void s.signedIn(user);
      // 게스트의 첫 세션 확인(null)에 이 브라우저 데이터를 지우지 않는다
      else if (!user && s.auth) s.signedOut();
      setAuthChecked(true);
    });
  }, []);

  const tabs = [
    { label: "근무표", current: view.screen === "home", onClick: () => go({ screen: "home" }) },
    {
      label: "병동 설정",
      current: view.screen === "settings",
      onClick: () => go({ screen: "settings", tab: "roster" }),
    },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[#E2E2DC] bg-white">
        <div className="mx-auto flex h-14 max-w-[1360px] items-center justify-between px-8">
          <div className="flex items-baseline gap-3">
            <span className="text-[15px] font-semibold text-[#1B1B18]">간호사 근무표</span>
            {started && (
              <span className="text-xs font-medium text-[#66665E]">
                {shop.name || "이름 없는 병동"} · {unitShort(shop.unit)}
              </span>
            )}
          </div>
          <AccountBar />
        </div>
      </header>
      {started && (
        <nav className="border-b border-[#E2E2DC] bg-white">
          <div className="mx-auto flex max-w-[1360px] gap-1 px-6">
            {view.screen !== "setup" && tabs.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={t.onClick}
                aria-current={t.current ? "page" : undefined}
                className={`${ui.text} ${t.current ? "font-semibold text-[#1B1B18]" : ""}`}
              >
                {t.label}
              </button>
            ))}
            {auth === null && (
              <button type="button" onClick={() => setShowStart(true)} className={`${ui.text} ml-auto`}>
                시작 화면
              </button>
            )}
          </div>
        </nav>
      )}

      <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-5 px-8 py-6">
        {!storageAvailable && (
          <p role="status" className={ui.banner}>
            이 브라우저에서는 저장소를 쓸 수 없어요. 새로고침하면 입력이 사라져요.
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

        {auth !== null && syncStatus === "error" && (
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
        ) : !started ? (
          <StartScreen onDone={() => setShowStart(false)} />
        ) : view.screen === "home" ? (
          <ShopHome />
        ) : view.screen === "setup" ? (
          <SetupFlow />
        ) : view.screen === "settings" ? (
          <ShopSettings />
        ) : view.screen === "confirmed" ? (
          <ConfirmedPeriod key={view.periodId} />
        ) : (
          <PeriodWork />
        )}
        <LoginPromptDialog />
      </main>
    </div>
  );
}
