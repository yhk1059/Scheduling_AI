"use client";

import { useState } from "react";

import { useAppStore, type View } from "@/lib/store";

import Dialog from "./Dialog";
import { today } from "./RulesStep";
import { ui } from "./ui";

const SCREEN_LABELS: Record<View["screen"], string> = { home: "병동 홈", settings: "병동 설정", period: "기간 작업" };

export default function StartScreen({ onDone }: { onDone: () => void }) {
  const hasInput = useAppStore((s) => s.hasInput());
  const screen = useAppStore((s) => s.view.screen);
  const nurseCount = useAppStore((s) => s.ward?.nurses.filter((n) => n.active).length ?? 0);
  const loadSample = useAppStore((s) => s.loadSample);
  const startWard = useAppStore((s) => s.startWard);
  const go = useAppStore((s) => s.go);
  const [pending, setPending] = useState<(() => void) | null>(null);

  const sample = () => {
    loadSample(today());
    go({ screen: "home" });
    onDone();
  };
  const fresh = () => {
    startWard();
    onDone();
  };
  // 입력이 있으면 지우기 전에 확인한다
  const start = (load: () => void) => (hasInput ? setPending(() => load) : load());

  const options = [
    ...(hasInput
      ? [
          {
            title: "이어서 하기",
            body: `이 브라우저에 저장된 입력으로 돌아가요. ${SCREEN_LABELS[screen]}${nurseCount > 0 ? ` · 명단 ${nurseCount}명` : ""}`,
            action: "이어서 하기",
            onClick: onDone,
          },
        ]
      : []),
    {
      title: "샘플로 체험하기",
      body: "샘플 병동(15명)과 병동 규칙을 불러와요. 바로 기간을 만들어 근무표를 생성해 볼 수 있어요.",
      action: "샘플로 체험하기",
      onClick: () => start(sample),
    },
    {
      title: "내 병동으로 시작하기",
      body: "빈 병동에서 명단과 필요 인원부터 입력해요. 엑셀 명단을 붙여넣거나 CSV 파일로 올릴 수 있어요.",
      action: "내 병동으로 시작하기",
      onClick: () => start(fresh),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">시작 방법</h1>
        <p className="text-sm leading-relaxed text-[#3D3D38]">입력은 이 브라우저에만 저장돼요.</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {options.map((o, i) => (
          <section key={o.title} className={`${ui.card} flex flex-col gap-2.5`}>
            <h2 className={ui.cardTitle}>{o.title}</h2>
            <p className="flex-1 text-sm leading-relaxed text-[#3D3D38]">{o.body}</p>
            <div>
              <button type="button" onClick={o.onClick} className={i === 0 ? ui.primary : ui.secondary}>
                {o.action}
              </button>
            </div>
          </section>
        ))}
      </div>
      {pending && (
        <Dialog
          title="지금 입력을 지우고 새로 시작할까요?"
          confirmLabel="지우고 시작"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const load = pending;
            setPending(null);
            load();
          }}
        >
          이 브라우저에 저장된 명단, 규칙, 요청, 근무표가 지워져요. 되돌릴 수 없어요.
        </Dialog>
      )}
    </div>
  );
}
