"use client";

import { supabaseConfigured } from "@/lib/supabase";

import { LoginButton, PrivacyLink } from "./Account";
import DemoVideoButton from "./DemoVideo";
import { CELL, codeClass } from "./ScheduleStep";
import { ui } from "./ui";
import Wordmark from "./Wordmark";

const STEPS = ["명단을 적고 직원에게 링크 하나를 보내요", "매장 조건을 말로 적어요", "근무표를 만들고 확정해요"];

/** 로그인하지 않았을 때 앱 대신 보인다(UI_GUIDE "로그인 화면"). */
export default function LoginScreen() {
  return (
    <div className="mx-auto grid min-h-[calc(100vh-108px)] w-full max-w-[1100px] grid-cols-[1fr_440px] items-center gap-24">
      <div className="flex flex-col gap-5">
        <Wordmark size="hero" />
        <p className="text-[36px] leading-[1.25] font-semibold tracking-[-0.02em] text-[#1B1B18]">말로 짜는 근무표</p>
        <p className="text-base leading-relaxed text-[#3D3D38]">
          직원 명단만 넣으면 첫 근무표를 시작할 수 있어요. 매장 하나, 계정 하나로 쓰고, 근무표는 서버에 저장돼요.
        </p>
        <ol className="flex flex-col gap-3 border-t border-[#E2E2DC] pt-5">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-3 text-sm text-[#3D3D38]">
              <span className="font-mono font-semibold text-[#155E75]">{i + 1}</span>
              {step}
              {i === STEPS.length - 1 && (
                <span aria-hidden="true" className="flex gap-0.5">
                  {["A", "M", "C", "O"].map((code) => (
                    <span key={code} className={`${CELL} ${codeClass(code, false)}`}>
                      {code}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>

      <section className={`${ui.cardXl} flex flex-col gap-4 px-9 pt-9 pb-7`}>
        <div className="flex flex-col gap-1">
          <h1 className={ui.sectionTitle}>로그인</h1>
          {supabaseConfigured ? (
            <p className="text-sm leading-relaxed text-[#3D3D38]">Google 계정으로만 로그인할 수 있어요</p>
          ) : (
            <p className="text-sm leading-relaxed text-[#3D3D38]">로그인 설정이 필요해요</p>
          )}
        </div>
        {supabaseConfigured && <LoginButton className={`${ui.primaryXl} w-full justify-center`} />}
        <div className="flex items-center gap-3 text-xs text-[#66665E]">
          <span aria-hidden="true" className="h-px flex-1 bg-[#E2E2DC]" />
          또는
          <span aria-hidden="true" className="h-px flex-1 bg-[#E2E2DC]" />
        </div>
        <DemoVideoButton className={`${ui.secondaryXl} w-full justify-center`}>데모 영상 보기</DemoVideoButton>
        {supabaseConfigured && (
          <p className="text-xs leading-relaxed text-[#66665E]">
            내 매장과 근무표는 서버에 저장되고, 언제든 직접 지울 수 있어요.
            <PrivacyLink className="ml-1 rounded-sm underline underline-offset-2 hover:text-[#1B1B18]" />
          </p>
        )}
      </section>
    </div>
  );
}
