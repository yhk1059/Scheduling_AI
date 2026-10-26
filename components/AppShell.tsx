"use client";

import { useAppStore } from "@/lib/store";

import RulesStep from "./RulesStep";
import ScheduleStep from "./ScheduleStep";
import Stepper from "./Stepper";
import { ui } from "./ui";
import WardStep from "./WardStep";

export default function AppShell() {
  const step = useAppStore((s) => s.step);
  const setStep = useAppStore((s) => s.setStep);
  const period = useAppStore((s) => s.period);
  const nurseCount = useAppStore((s) => s.nurses.length);
  const storageAvailable = useAppStore((s) => s.storageAvailable);
  const resetNotice = useAppStore((s) => s.resetNotice);
  const dismissResetNotice = useAppStore((s) => s.dismissResetNotice);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[#E2E2DC] bg-white">
        <div className="mx-auto flex h-14 max-w-[1360px] items-center justify-between px-8">
          <div className="flex items-baseline gap-3">
            <span className="text-[15px] font-semibold text-[#1B1B18]">간호사 근무표</span>
            <span className="text-xs font-medium text-[#66665E]">
              <span className="font-mono">
                {period.year}년 {period.month}월
              </span>
              {nurseCount > 0 && <> · 로테이션 {nurseCount}명</>}
            </span>
          </div>
          <Stepper current={step} onSelect={setStep} />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-5 px-8 py-6">
        {!storageAvailable && (
          <p role="status" className="rounded-lg border border-[#F1D3A8] bg-[#FDF0DC] px-4 py-2.5 text-sm text-[#7A4506]">
            이 브라우저에서는 저장소를 쓸 수 없어요. 새로고침하면 입력이 사라집니다.
          </p>
        )}
        {resetNotice && (
          <div
            role="status"
            className="flex items-center justify-between rounded-lg border border-[#F1D3A8] bg-[#FDF0DC] px-4 py-1.5 text-sm text-[#7A4506]"
          >
            저장된 데이터가 손상되었거나 이전 버전이라 처음 상태로 초기화했어요.
            <button type="button" onClick={dismissResetNotice} className={ui.text}>
              닫기
            </button>
          </div>
        )}

        {step === 1 ? (
          <WardStep />
        ) : step === 2 ? (
          <RulesStep key="ward" scope="ward" />
        ) : step === 3 ? (
          <RulesStep key="month" scope="month" />
        ) : (
          <ScheduleStep />
        )}
      </main>
    </div>
  );
}
