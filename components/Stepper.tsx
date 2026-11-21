/** 근무표 작성 화면의 스테퍼. labels[i]가 단계 i + 1이다. */
export default function Stepper<S extends number>({
  label: listLabel,
  labels,
  current,
  reached,
  onSelect,
}: {
  label: string;
  labels: string[];
  current: S;
  /** 이미 거친 마지막 단계. 그 이하의 다른 단계는 눌러 이동할 수 있다 */
  reached: S;
  onSelect: (step: S) => void;
}) {
  return (
    <ol aria-label={listLabel} className="flex flex-wrap items-center gap-2">
      {labels.map((label, i) => {
        const step = (i + 1) as S;
        const active = step === current;
        const done = !active && step <= reached;
        return (
          <li key={step} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-[#DCDCD8]" />}
            <button
              type="button"
              disabled={!done}
              onClick={() => onSelect(step)}
              aria-current={active ? "step" : undefined}
              className="flex items-center gap-2 rounded-md px-1 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C4247C] disabled:cursor-default enabled:hover:bg-[#F5F5F4] enabled:active:bg-[#EDEDEA]"
            >
              {done ? (
                <span className="flex size-[22px] items-center justify-center rounded-full bg-[#FDEAF4] text-[#C4247C]">
                  <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M2.5 6.2 5 8.5l4.5-5" />
                  </svg>
                </span>
              ) : (
                <span
                  className={`flex size-[22px] items-center justify-center rounded-full font-mono text-xs ${
                    active ? "bg-[#111214] text-white" : "border border-[#DCDCD8] text-[#9499A2]"
                  }`}
                >
                  {step}
                </span>
              )}
              <span
                className={
                  active ? "font-semibold text-[#111214]" : done ? "text-[#4B4F57]" : "text-[#9499A2]"
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
