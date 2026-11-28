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
    <ol aria-label={listLabel} className="grid grid-cols-3 gap-1.5 sm:gap-2">
      {labels.map((label, i) => {
        const step = (i + 1) as S;
        const active = step === current;
        const done = !active && step <= reached;
        const status = active
          ? { text: "지금 단계", dot: "bg-accent", ink: "text-accent" }
          : done
            ? { text: "완료", dot: "bg-ok", ink: "text-ok" }
            : { text: "다음 단계", dot: "bg-line-strong", ink: "text-muted" };
        return (
          <li key={step}>
            <button
              type="button"
              disabled={!done}
              onClick={() => onSelect(step)}
              aria-current={active ? "step" : undefined}
              className={`flex h-full w-full flex-col items-start gap-1.5 rounded-xl px-2.5 py-2 text-left sm:rounded-2xl sm:px-4 sm:py-3.5 transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default ${
                active
                  ? "bg-soft shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
                  : "bg-white shadow-[inset_0_0_0_1px_var(--color-line)] enabled:hover:bg-soft enabled:active:bg-pressed"
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-body sm:gap-2 sm:text-[13px]">
                {done ? (
                  <span className="flex size-[22px] items-center justify-center rounded-full bg-ok-soft text-ok">
                    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path d="M2.5 6.2 5 8.5l4.5-5" />
                    </svg>
                  </span>
                ) : (
                  <span
                    className={`flex size-[22px] items-center justify-center rounded-full font-mono text-xs ${
                      active ? "bg-accent text-white" : "bg-soft text-muted"
                    }`}
                  >
                    {step}
                  </span>
                )}
                {label}
              </span>
              {/* 좁은 화면에서는 단계 이름만 한 줄로 보여 근무표가 먼저 보이게 한다 */}
              {notes?.[i] && <span className="text-base font-bold tracking-[-0.02em] text-ink max-sm:hidden">{notes[i]}</span>}
              <span className={`flex items-center gap-1.5 text-xs font-semibold max-sm:sr-only ${status.ink}`}>
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
    <div className="sticky bottom-0 z-30 -mx-4 border-t border-line bg-white/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {current !== undefined && total !== undefined ? (
          <div className="hidden items-center gap-3 sm:flex">
            <div aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-full bg-pressed">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(current / total) * 100}%` }} />
            </div>
            <span className="text-sm text-body">
              <span className="font-mono font-semibold text-ink">
                {current}/{total}
              </span>{" "}
              · {caption}
            </span>
          </div>
        ) : (
          <div className="text-sm text-body">{caption}</div>
        )}
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-3 max-sm:[&_button]:px-3.5 max-sm:[&_p]:w-full max-sm:[&_p]:text-right">
          {children}
        </div>
      </div>
    </div>
  );
}
