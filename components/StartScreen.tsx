"use client";

import Link from "next/link";
import { useState } from "react";

import sample from "@/lib/samples/shop-12.json";
import { currentPeriod, useAppStore, type View } from "@/lib/store";
import { supabaseConfigured } from "@/lib/supabase";
import type { ConstraintSpec } from "@/lib/types.gen";
import { scheduleName, shopRuleCount } from "@/lib/wording";

import { PrivacyLink } from "./Account";
import Dialog from "./Dialog";
import { ui } from "./ui";

const SCREEN_LABELS: Record<Exclude<View["screen"], "period" | "confirmed">, string> = {
  home: "근무표 목록",
  setup: "처음 설정",
  settings: "매장 설정",
};
const SAMPLE_EMPLOYEES = sample.employees.length;
const SAMPLE_RULES = shopRuleCount(sample.constraints as unknown as ConstraintSpec[]);

export default function StartScreen({ onDone }: { onDone: () => void }) {
  const hasInput = useAppStore((s) => s.hasInput());
  // 이어서 갈 화면 이름. 근무표 화면이면 "11월 근무표"
  const screenLabel = useAppStore((s) => {
    if (s.view.screen !== "period" && s.view.screen !== "confirmed") return SCREEN_LABELS[s.view.screen];
    const p = currentPeriod(s);
    return p && s.shop ? scheduleName(p, s.shop.unit) : "근무표";
  });
  const employeeCount = useAppStore((s) => s.shop?.employees.filter((n) => n.active).length ?? 0);
  const startShop = useAppStore((s) => s.startShop);
  const showLogin = useAppStore((s) => supabaseConfigured && s.auth === null);
  const [pending, setPending] = useState(false);

  const fresh = () => {
    startShop();
    onDone();
  };
  // 입력이 있으면 지우기 전에 확인한다
  const start = () => (hasInput ? setPending(true) : fresh());

  const options = [
    ...(hasInput
      ? [
          {
            title: "이어서 하기",
            body: `이 브라우저에 저장된 입력으로 돌아가요. ${screenLabel}${employeeCount > 0 ? ` · 직원 ${employeeCount}명` : ""}`,
            action: "이어서 하기",
            onClick: onDone,
          },
        ]
      : []),
    {
      title: "샘플로 체험하기",
      body: `직원 ${SAMPLE_EMPLOYEES}명과 매장 조건 ${SAMPLE_RULES}개로 만든 4주 근무표를 볼 수 있어요. 지금 입력은 그대로 남아요.`,
      action: "샘플로 체험하기",
      href: "/demo",
    },
    {
      title: "내 매장으로 시작하기",
      body: "빈 매장에서 명단과 필요 인원부터 입력해요.",
      action: "내 매장으로 시작하기",
      onClick: start,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">시작 방법</h1>
        <p className="text-sm leading-relaxed text-[#3D3D38]">입력은 이 브라우저에만 저장돼요.</p>
      </div>
      <div className={`grid gap-4 ${options.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {options.map((o, i) => (
          <section key={o.title} className={`${ui.card} flex flex-col gap-2.5`}>
            <h2 className={ui.cardTitle}>{o.title}</h2>
            <p className="flex-1 text-sm leading-relaxed text-[#3D3D38]">{o.body}</p>
            <div>
              {o.href ? (
                <Link href={o.href} className={i === 0 ? ui.primary : ui.secondary}>
                  {o.action}
                </Link>
              ) : (
                <button type="button" onClick={o.onClick} className={i === 0 ? ui.primary : ui.secondary}>
                  {o.action}
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      {showLogin && (
        <p className="flex items-center gap-1 text-sm text-[#3D3D38]">
          로그인하면 다른 기기에서도 이어서 쓸 수 있어요.
          <PrivacyLink className={ui.textSm} />
        </p>
      )}
      {pending && (
        <Dialog
          title="지금 입력을 지우고 새로 시작할까요?"
          onClose={() => setPending(false)}
          secondary={{ label: "취소", onClick: () => setPending(false) }}
          primary={{
            label: "지우고 시작",
            onClick: () => {
              setPending(false);
              fresh();
            },
          }}
        >
          이 브라우저에 저장된 명단, 규칙, 요청, 근무표가 지워져요. 되돌릴 수 없어요.
        </Dialog>
      )}
    </div>
  );
}
