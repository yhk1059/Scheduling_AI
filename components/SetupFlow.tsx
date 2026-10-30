"use client";

import { useEffect, useRef, useState } from "react";

import { isShopReady, setupStep, useAppStore, type SetupStep } from "@/lib/store";
import { configSummary, presetName, shopRuleCount } from "@/lib/wording";

import RulesStep, { today } from "./RulesStep";
import ShiftTable from "./ShiftTable";
import Stepper from "./Stepper";
import { ui } from "./ui";
import { BasicSection, CoverageSection, RosterSection } from "./ShopSettings";

const LABELS = ["매장·명단", "매장 소개", "매장 조건"];

/** 처음 설정: ① 매장·명단 → ② 매장 소개 → ③ 매장 규칙 → [첫 근무표 만들기]. 근무표가 없는 매장에서만 보인다. */
export default function SetupFlow() {
  const shop = useAppStore((s) => s.shop);
  const step = useAppStore((s) => (s.view.screen === "setup" ? s.view.step : 1));
  const go = useAppStore((s) => s.go);
  const createPeriod = useAppStore((s) => s.createPeriod);
  const markIntroSeen = useAppStore((s) => s.markIntroSeen);

  // 단계를 옮기면 새 단계 제목으로 포커스를 옮긴다(처음 열 때는 옮기지 않는다)
  const rootRef = useRef<HTMLDivElement>(null);
  const prevStep = useRef(step);
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    rootRef.current?.querySelector<HTMLElement>("[data-step-title]")?.focus();
  }, [step]);

  if (!shop) return null;
  const toStep = (s: SetupStep) => go({ screen: "setup", step: s });
  // 끝낸 단계(못 끝낸 첫 단계 앞)까지 눌러 돌아갈 수 있다
  const reached = Math.max(step, setupStep(shop) - 1) as SetupStep;
  // ②는 필수 입력이 없다(ADR-019). [다음]을 누르면 매장 소개를 본 것으로 남긴다
  const canNext = step === 1 ? shop.employees.some((n) => n.active) : true;
  const applied = shopRuleCount(shop.rules);
  const hasStaffing = shop.rules.some((r) => presetName(r) === "필요 인원" && r.enabled !== false);
  const pending = shop.pendingRules.length + shop.pendingConfig.length;
  const title = (text: string) => (
    <h2 tabIndex={-1} data-step-title className={`${ui.cardTitle} outline-none`}>
      {text}
    </h2>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">처음 설정</h1>
        <Stepper label="처음 설정 단계" labels={LABELS} current={step} reached={reached} onSelect={toStep} />
      </div>

      {step === 1 ? (
        <>
          {title("매장·명단")}
          <BasicSection />
          <RosterSection />
        </>
      ) : step === 2 ? (
        <>
          {title("매장 소개")}
          <ShiftSummary />
          <RulesStep key="intro" scope="shop" intro />
          <CoverageSection collapsible />
        </>
      ) : (
        <>
          {title("매장 조건")}
          <RulesStep key="shop" scope="shop" pendingNote={false} />
        </>
      )}

      <div className="flex items-center justify-between gap-4">
        {step > 1 ? (
          <button type="button" onClick={() => toStep((step - 1) as SetupStep)} className={ui.secondary}>
            이전
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          {step < 3 ? (
            <>
              {!canNext && <p className={ui.help}>명단에 직원을 1명 이상 넣으면 다음으로 넘어갈 수 있어요</p>}
              {step === 2 && !hasStaffing && <p className={ui.help}>필요 인원 없이 만들면 인원을 맞추지 않아요</p>}
              <button
                type="button"
                disabled={!canNext}
                onClick={() => {
                  if (step === 2) markIntroSeen();
                  toStep((step + 1) as SetupStep);
                }}
                className={ui.primary}
              >
                다음
              </button>
            </>
          ) : (
            <>
              {applied === 0 && <p className={ui.help}>규칙 없이 만들면 기본 규칙만 지켜요</p>}
              {pending > 0 && <p className={ui.help}>적용하지 않은 규칙 {pending}개는 빠져요</p>}
              {!isShopReady(shop) && (
                <p className={ui.help}>명단에 직원을 1명 이상 넣으면 만들 수 있어요</p>
              )}
              <button type="button" disabled={!isShopReady(shop)} onClick={() => createPeriod(today())} className={ui.primary}>
                첫 근무표 만들기
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** ② 맨 위 근무 형태 요약 한 줄. [바꾸기]로 펼치면 근무 형태 표가 나와 필요 인원을 넣기 전에 코드를 더할 수 있다. */
function ShiftSummary() {
  const config = useAppStore((s) => s.shop?.config);
  const [open, setOpen] = useState(false);
  if (!config) return null;
  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[#3D3D38]">
          <span className="font-medium text-[#1B1B18]">근무 형태</span> · {configSummary(config)}
        </p>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={ui.textSm}>
          {open ? "접기" : "바꾸기"}
        </button>
      </div>
      {open && <ShiftTable />}
    </section>
  );
}
