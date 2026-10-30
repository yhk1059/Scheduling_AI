"use client";

import { useEffect, useState } from "react";

import { useAppStore } from "@/lib/store";
import { onAuthChange, supabaseConfigured } from "@/lib/supabase";
import { unitShort } from "@/lib/wording";

import { AccountBar } from "./Account";
import ConfirmedPeriod from "./ConfirmedPeriod";
import PeriodWork from "./PeriodWork";
import LoginScreen from "./LoginScreen";
import { ui } from "./ui";
import ShopHome from "./ShopHome";
import ShopSettings from "./ShopSettings";
import ShopSetup from "./ShopSetup";

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
  // 첫 세션 확인 전에는 로그인 화면을 띄우지 않는다
  const [authChecked, setAuthChecked] = useState(!supabaseConfigured);
  const loading = !authChecked || (auth !== null && syncStatus === "loading");
  const started = auth !== null && shop !== null && !loading;

  useEffect(() => {
    if (!supabaseConfigured) return;
    return onAuthChange((user) => {
      const s = useAppStore.getState();
      // 토큰 갱신 등으로 같은 사용자가 다시 오면 서버 문서를 다시 읽지 않는다
      if (user && s.auth?.userId !== user.id) void s.signedIn(user);
      // 세션이 끝난 채 다시 열어도 남은 캐시를 지운다. 다음 로그인 계정에 올라가지 않게 한다
      else if (!user && (s.auth || s.hasInput())) s.signedOut();
      setAuthChecked(true);
    });
  }, []);

  const tabs = [
    { label: "근무표", current: view.screen === "home", onClick: () => go({ screen: "home" }) },
    {
      label: "매장 설정",
      current: view.screen === "settings",
      onClick: () => go({ screen: "settings", tab: "roster" }),
    },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[#E2E2DC] bg-white">
        <div className="mx-auto flex h-14 max-w-[1360px] items-center justify-between px-8">
          <div className="flex items-baseline gap-3">
            <span className="text-[15px] font-semibold text-[#1B1B18]">매장 직원 근무표</span>
            {started && (
              <span className="text-xs font-medium text-[#66665E]">
                {shop.name || "이름 없는 매장"} · {unitShort(shop.unit)}
              </span>
            )}
          </div>
          <AccountBar />
        </div>
      </header>
      {started && view.screen !== "setup" && (
        <nav className="border-b border-[#E2E2DC] bg-white">
          <div className="mx-auto flex max-w-[1360px] gap-1 px-6">
            {tabs.map((t) => (
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
          </div>
        </nav>
      )}

      <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-5 px-8 py-6">
        {!storageAvailable && (
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

        {started && syncStatus === "error" && (
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
        ) : auth === null ? (
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
