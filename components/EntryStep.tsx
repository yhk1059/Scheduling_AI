"use client";

import { useAppStore } from "@/lib/store";

import { today } from "./RulesStep";
import { STEPS, stepOf } from "./Stepper";
import { ui } from "./ui";

export const OVERWRITE_MESSAGE = "지금까지 입력한 명단, 규칙, 요청, 근무표가 지워져요. 계속할까요?";

export default function EntryStep({ onDone }: { onDone: () => void }) {
  const hasInput = useAppStore((s) => s.hasInput());
  const step = useAppStore((s) => stepOf(s.view));
  const nurseCount = useAppStore((s) => s.ward?.nurses.filter((n) => n.active).length ?? 0);
  const loadSample = useAppStore((s) => s.loadSample);
  const startWard = useAppStore((s) => s.startWard);
  const createPeriod = useAppStore((s) => s.createPeriod);
  const go = useAppStore((s) => s.go);

  const start = (load: () => void) => {
    if (hasInput && !window.confirm(OVERWRITE_MESSAGE)) return;
    load();
    go({ screen: "settings", tab: "roster" });
    onDone();
  };

  const options = [
    ...(hasInput
      ? [
          {
            title: "이어서 하기",
            body: `저장된 입력으로 돌아가요. ${STEPS.find((s) => s.step === step)?.label} 단계${nurseCount > 0 ? ` · 명단 ${nurseCount}명` : ""}`,
            action: "이어서 하기",
            onClick: onDone,
          },
        ]
      : []),
    {
      title: "샘플로 체험하기",
      body: "샘플 병동(15명)과 규칙·요청을 불러와요. 바로 [생성]까지 해 볼 수 있어요.",
      action: "샘플 불러오기",
      onClick: () => start(() => loadSample(today())),
    },
    {
      title: "내 데이터로 시작하기",
      body: "빈 상태에서 대상 월과 명단부터 입력해요. 엑셀 명단을 붙여넣거나 CSV 파일로 올릴 수 있어요.",
      action: "새로 시작",
      onClick: () =>
        start(() => {
          startWard();
          createPeriod(today());
        }),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">시작 방법</h1>
        <p className="text-sm leading-relaxed text-[#3D3D38]">
          입력은 이 브라우저에만 저장돼요.
          {hasInput && " 샘플이나 새로 시작을 고르면 저장된 입력이 지워져요."}
        </p>
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
    </div>
  );
}
