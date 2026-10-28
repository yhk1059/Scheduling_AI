import type { View } from "@/lib/store";

/** 지금 화면의 단계(병동 → 규칙 → 요청 → 근무표). 화면 구조 개편 전까지 쓴다. */
export type Step = 1 | 2 | 3 | 4;

/** 화면 → 단계. 기간 ①·②는 요청 단계, ③은 근무표다. */
export function stepOf(view: View): Step {
  if (view.screen === "settings") return view.tab === "roster" ? 1 : 2;
  if (view.screen === "period") return view.step === 3 ? 4 : 3;
  return 1;
}

export function viewOf(step: Step, periodId: string | undefined): View {
  if (step === 1) return { screen: "settings", tab: "roster" };
  if (step === 2 || periodId === undefined) return { screen: "settings", tab: "rules" };
  return { screen: "period", periodId, step: step === 3 ? 2 : 3 };
}

export const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: "병동" },
  { step: 2, label: "규칙" },
  { step: 3, label: "이달 요청" },
  { step: 4, label: "근무표" },
];

export default function Stepper({ current, onSelect }: { current: Step; onSelect: (step: Step) => void }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map(({ step, label }, i) => {
        const done = step < current;
        const active = step === current;
        return (
          <li key={step} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-[#C9C9C1]" />}
            <button
              type="button"
              disabled={!done}
              onClick={() => onSelect(step)}
              aria-current={active ? "step" : undefined}
              className="flex items-center gap-2 rounded-md px-1 text-sm disabled:cursor-default enabled:hover:bg-[#EFEFEB]"
            >
              {done ? (
                <span className="flex size-[22px] items-center justify-center rounded-full bg-[#E3F0F3] text-[#155E75]">
                  <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M2.5 6.2 5 8.5l4.5-5" />
                  </svg>
                </span>
              ) : (
                <span
                  className={`flex size-[22px] items-center justify-center rounded-full font-mono text-xs ${
                    active ? "bg-[#155E75] text-white" : "border border-[#C9C9C1] text-[#9A9A91]"
                  }`}
                >
                  {step}
                </span>
              )}
              <span
                className={
                  active ? "font-semibold text-[#1B1B18]" : done ? "text-[#3D3D38]" : "text-[#9A9A91]"
                }
              >
                {label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
