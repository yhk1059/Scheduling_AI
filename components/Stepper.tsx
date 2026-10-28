/** 기간 작업 단계: ① 준비 → ② 요청 → ③ 근무표. */
export type PeriodStep = 1 | 2 | 3;

const STEPS: { step: PeriodStep; label: string }[] = [
  { step: 1, label: "준비" },
  { step: 2, label: "요청" },
  { step: 3, label: "근무표" },
];

export default function Stepper({
  current,
  reached,
  onSelect,
}: {
  current: PeriodStep;
  /** 이미 거친 마지막 단계. 그 이하의 다른 단계는 눌러 이동할 수 있다 */
  reached: PeriodStep;
  onSelect: (step: PeriodStep) => void;
}) {
  return (
    <ol aria-label="기간 작업 단계" className="flex items-center gap-2">
      {STEPS.map(({ step, label }, i) => {
        const active = step === current;
        const done = !active && step <= reached;
        return (
          <li key={step} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-[#C9C9C1]" />}
            <button
              type="button"
              disabled={!done}
              onClick={() => onSelect(step)}
              aria-current={active ? "step" : undefined}
              className="flex items-center gap-2 rounded-md px-1 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155E75] disabled:cursor-default enabled:hover:bg-[#EFEFEB] enabled:active:bg-[#E2E2DC]"
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
