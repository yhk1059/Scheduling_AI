"use client";

import { useState } from "react";

import { unitLabel } from "@/lib/period";
import { useAppStore } from "@/lib/store";

import PeriodWork from "./PeriodWork";
import StartScreen from "./StartScreen";
import { ui } from "./ui";
import WardHome from "./WardHome";
import WardSettings from "./WardSettings";

export default function AppShell() {
  const ward = useAppStore((s) => s.ward);
  const view = useAppStore((s) => s.view);
  const go = useAppStore((s) => s.go);
  const storageAvailable = useAppStore((s) => s.storageAvailable);
  const resetNotice = useAppStore((s) => s.resetNotice);
  const dismissResetNotice = useAppStore((s) => s.dismissResetNotice);
  // /app에 들어올 때마다 시작 화면을 보여 준다(저장하지 않는다)
  const [entered, setEntered] = useState(false);
  const started = entered && ward !== null;

  const tabs = [
    { label: "홈", current: view.screen === "home", onClick: () => go({ screen: "home" }) },
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
                {ward.name || "이름 없는 병동"} · {unitLabel(ward.unit)}
              </span>
            )}
          </div>
          <span className="text-xs text-[#66665E]">이 브라우저에만 저장</span>
        </div>
      </header>
      {started && (
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

        {!started ? (
          <StartScreen onDone={() => setEntered(true)} />
        ) : view.screen === "home" ? (
          <WardHome />
        ) : view.screen === "settings" ? (
          <WardSettings />
        ) : (
          <PeriodWork />
        )}
      </main>
    </div>
  );
}
