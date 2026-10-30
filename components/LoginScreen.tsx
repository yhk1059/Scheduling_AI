"use client";

import Link from "next/link";

import { supabaseConfigured } from "@/lib/supabase";

import { LoginButton, PrivacyLink } from "./Account";
import { ui } from "./ui";

/** 로그인하지 않았을 때 앱 대신 보인다(UI_GUIDE "로그인 화면"). */
export default function LoginScreen() {
  return (
    <section className={`${ui.card} flex max-w-[440px] flex-col gap-3.5`}>
      <h1 className="text-[22px] font-semibold text-[#1B1B18]">로그인</h1>
      {supabaseConfigured ? (
        <>
          <p className="text-sm leading-relaxed text-[#3D3D38]">Google로 로그인하면 내 매장과 근무표가 저장돼요.</p>
          <LoginButton className={ui.primary} />
        </>
      ) : (
        <p className="text-sm leading-relaxed text-[#3D3D38]">로그인 설정이 필요해요</p>
      )}
      <div className="flex items-center gap-1">
        <Link href="/demo" className={ui.text}>
          샘플로 체험하기
        </Link>
        {supabaseConfigured && <PrivacyLink />}
      </div>
    </section>
  );
}
