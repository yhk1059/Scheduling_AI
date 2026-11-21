import type { ReactNode } from "react";

/** 근무표 작성 화면의 단계 타일. labels[i]가 단계 i + 1이고, notes[i]는 그 단계의 값 한 줄이다. */
export default function Stepper<S extends number>({
  label: listLabel,
  labels,
  notes,
  current,
  reached,
  onSelect,
}: {
  label: string;
  labels: string[];
  notes?: string[];
  current: S;
  /** 이미 거친 마지막 단계. 그 이하의 다른 단계는 눌러 이동할 수 있다 */
  reached: S;
  onSelect: (step: S) => void;
}) {
  return (
    <ol aria-label={listLabel} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {labels.map((label, i) => {
        const step = (i + 1) as S;
        const active = step === current;
        const done = !active && step <= reached;
        const status = active
          ? { text: "지금 단계", dot: "bg-[#111214]", ink: "text-[#111214]" }
          : done
            ? { text: "완료", dot: "bg-[#12B76A]", ink: "text-[#067647]" }
            : { text: "다음 단계", dot: "bg-[#DCDCD8]", ink: "text-[#6B6F78]" };
        return (
          <li key={step}>
            <button
              type="button"
              disabled={!done}
              onClick={() => onSelect(step)}
              aria-current={active ? "step" : undefined}
              className={`flex h-full w-full flex-col items-start gap-1.5 rounded-2xl px-4 py-3.5 text-left transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C4247C] disabled:cursor-default ${
                active
                  ? "bg-[#F5F5F4] shadow-[inset_0_0_0_1.5px_#111214]"
                  : "bg-white shadow-[inset_0_0_0_1px_#EDEDEA] enabled:hover:bg-[#F5F5F4] enabled:active:bg-[#EDEDEA]"
              }`}
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[#4B4F57]">
                {done ? (
                  <span className="flex size-[22px] items-center justify-center rounded-full bg-[#DDF7E9] text-[#067647]">
                    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path d="M2.5 6.2 5 8.5l4.5-5" />
                    </svg>
                  </span>
                ) : (
                  <span
                    className={`flex size-[22px] items-center justify-center rounded-full font-mono text-xs ${
                      active ? "bg-[#111214] text-white" : "bg-[#F5F5F4] text-[#6B6F78]"
                    }`}
                  >
                    {step}
                  </span>
                )}
                {label}
              </span>
              {notes?.[i] && <span className="text-base font-bold tracking-[-0.02em] text-[#111214]">{notes[i]}</span>}
              <span className={`flex items-center gap-1.5 text-xs font-semibold ${status.ink}`}>
                <span aria-hidden="true" className={`size-[7px] rounded-full ${status.dot}`} />
                {status.text}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** 단계 화면 아래에 붙는 바: 진행도(있으면) + 안내 왼쪽, 이전·다음 같은 행동 오른쪽. */
export function StepBar({ current, total, caption, children }: { current?: number; total?: number; caption: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-30 -mx-4 border-t border-[#EDEDEA] bg-white/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {current !== undefined && total !== undefined ? (
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-full bg-[#EDEDEA]">
              <div className="h-full rounded-full bg-[#111214]" style={{ width: `${(current / total) * 100}%` }} />
            </div>
            <span className="text-sm text-[#4B4F57]">
              <span className="font-mono font-semibold text-[#111214]">
                {current}/{total}
              </span>{" "}
              · {caption}
            </span>
          </div>
        ) : (
          <div className="text-sm text-[#4B4F57]">{caption}</div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3">{children}</div>
      </div>
    </div>
  );
}
