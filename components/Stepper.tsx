import type { Step } from "@/lib/store";

const STEPS: { step: Step; label: string }[] = [
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
