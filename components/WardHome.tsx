"use client";

import { formatRange } from "@/lib/period";
import { homeSummary, isWardReady, upcomingRange, useAppStore, viewForPeriod, type WorkPeriod } from "@/lib/store";
import { nextTask, scheduleName, TASK_STEPS, taskDoneSteps, unitShort, wardRuleCount } from "@/lib/wording";

import { markConfirmedEntry } from "./confirmedEntry";
import { today } from "./RulesStep";
import { ui } from "./ui";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 마지막 확정 시각. 오늘이면 "14:32", 아니면 날짜까지. */
export function confirmedTime(iso: string): string {
  const full = formatTime(iso);
  return full.startsWith(today()) ? full.slice(11) : full;
}


/** 홈의 확정 시각: "10/28 14:32". */
function shortTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 진행 단계 한 줄(표시만, 누를 수 없다). */
function TaskProgress({ done }: { done: number }) {
  return (
    <ol aria-label="진행 단계" className="flex items-center gap-1.5 text-xs">
      {TASK_STEPS.map((label, i) => {
        const finished = i < done;
        const current = i === done;
        return (
          <li key={label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true" className="h-px w-4 bg-[#C9C9C1]" />}
            {finished ? (
              <span className="flex size-[18px] items-center justify-center rounded-full bg-[#E3F0F3] text-[#155E75]">
                <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M2.5 6.2 5 8.5l4.5-5" />
                </svg>
              </span>
            ) : (
              <span
                className={`flex size-[18px] items-center justify-center rounded-full font-mono text-[11px] ${
                  current ? "bg-[#155E75] text-white" : "border border-[#C9C9C1] text-[#66665E]"
                }`}
              >
                {i < TASK_STEPS.length - 1 ? i + 1 : ""}
              </span>
            )}
            <span className={current ? "font-semibold text-[#1B1B18]" : "text-[#3D3D38]"}>
              {label}
              {finished && <span className="sr-only"> (완료)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function WardHome() {
  const ward = useAppStore((s) => s.ward);
  const periods = useAppStore((s) => s.periods);
  const createPeriod = useAppStore((s) => s.createPeriod);
  const go = useAppStore((s) => s.go);
  if (!ward) return null;

  const ready = isWardReady(ward);
  const nurseCount = ward.nurses.filter((n) => n.active).length;
  const now = today();
  const { operating, next, recent } = homeSummary(periods, now);
  const task = nextTask(ward, periods, now);
  const create = () => createPeriod(now);
  const open = (p: WorkPeriod) => go(viewForPeriod(p));
  const name = (p: WorkPeriod) => scheduleName(p, ward.unit);
  // 다음 근무표가 확정됐고 그 뒤에 만든 근무표가 없으면 그다음 근무표를 만들 수 있다
  const canCreateAfter = next.state === "confirmed" && periods.at(-1)?.id === next.period.id;
  const afterName = scheduleName(upcomingRange(ward.unit, periods, now), ward.unit);
  // 운영 중 카드·지금 할 일 카드에 나온 근무표는 다시 보여 주지 않는다
  const shown = new Set([operating?.id, next.state === "none" ? undefined : next.period.id]);
  const past = recent.filter((p) => p.status === "confirmed" && !shown.has(p.id));
  const operatingAt = operating?.versions.at(-1)?.confirmed_at;

  const taskText =
    task.kind === "none"
      ? periods.length === 0
        ? "첫 근무표를 만들 차례예요"
        : `${task.name}를 만들 차례예요`
      : task.kind === "drafting"
        ? task.requests > 0
          ? `요청 ${task.requests}개를 넣었어요. 아직 근무표를 만들지 않았어요`
          : "아직 근무표를 만들지 않았어요"
        : task.kind === "generated"
          ? "근무표를 만들었어요. 확인하고 확정하세요"
          : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">{ward.name || "이름 없는 병동"}</h1>
        <div className="flex items-center gap-2 text-sm text-[#3D3D38]">
          <span>
            간호사 <span className="font-mono">{nurseCount}</span>명 · 병동 규칙{" "}
            <span className="font-mono">{wardRuleCount(ward.rules)}</span>개 · {unitShort(ward.unit)}
          </span>
          <button type="button" onClick={() => go({ screen: "settings", tab: "roster" })} className={ui.text}>
            병동 설정
          </button>
        </div>
      </div>

      {!ready ? (
        <section className={`${ui.card} flex items-center justify-between gap-4`}>
          <p className="text-sm leading-relaxed text-[#3D3D38]">
            명단과 필요 인원을 입력하면 첫 근무표를 만들 수 있어요.
          </p>
          <button type="button" onClick={() => go({ screen: "settings", tab: "roster" })} className={ui.primary}>
            병동 설정 열기
          </button>
        </section>
      ) : (
        <>
          {operating && (
            <section className={`${ui.card} flex items-center justify-between gap-4`}>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h2 className={ui.cardTitle}>{name(operating)}</h2>
                  <span className={`${ui.badge} bg-[#E3F0F3] text-[#155E75]`}>운영 중</span>
                </div>
                <p className="flex items-center gap-2 text-xs text-[#66665E]">
                  <span className="font-mono">{formatRange(operating)}</span>
                  {operatingAt && (
                    <span>
                      마지막 확정 <span className="font-mono">{shortTime(operatingAt)}</span>
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  markConfirmedEntry(operating.id, "change");
                  go({ screen: "confirmed", periodId: operating.id });
                }}
                className={ui.secondary}
              >
                변경 입력
              </button>
            </section>
          )}

          <section className={`${ui.card} flex items-center justify-between gap-4`}>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <h2 className={ui.cardTitle}>{task.name}</h2>
                <span className="font-mono text-xs text-[#66665E]">
                  {formatRange(next.state === "none" ? upcomingRange(ward.unit, periods, now) : next.period)}
                </span>
              </div>
              <TaskProgress done={taskDoneSteps(task)} />
              <p className="text-sm leading-relaxed text-[#3D3D38]">
                {task.kind === "confirmed" ? (
                  <>
                    확정했어요{task.confirmedAt && <> · <span className="font-mono">{shortTime(task.confirmedAt)}</span></>}
                  </>
                ) : (
                  taskText
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {next.state === "none" ? (
                <button type="button" onClick={create} className={ui.primary}>
                  {task.name} 만들기
                </button>
              ) : task.kind === "confirmed" ? (
                <>
                  <button type="button" onClick={() => open(next.period)} className={ui.secondary}>
                    열기
                  </button>
                  {canCreateAfter && (
                    <button type="button" onClick={create} className={ui.primary}>
                      {afterName} 만들기
                    </button>
                  )}
                </>
              ) : (
                <button type="button" onClick={() => open(next.period)} className={ui.primary}>
                  {task.kind === "generated" ? "근무표 확인하기" : "이어서 하기"}
                </button>
              )}
            </div>
          </section>

          <section className={`${ui.card} flex flex-col gap-3`}>
            <h2 className={ui.cardTitle}>지난 근무표</h2>
            {past.length === 0 ? (
              <p className="text-sm text-[#3D3D38]">확정한 근무표가 여기에 쌓여요.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#E2E2DC] text-left text-xs font-medium text-[#66665E]">
                    <th className="py-2 pr-4 font-medium">근무표</th>
                    <th className="py-2 font-medium">확정 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((p) => {
                    const confirmedAt = p.versions.at(-1)?.confirmed_at;
                    return (
                      <tr key={p.id} className="border-b border-[#EFEFEB] last:border-b-0">
                        <td className="py-1.5 pr-4">
                          <button
                            type="button"
                            onClick={() => open(p)}
                            className="rounded-md px-1 text-[13px] font-medium text-[#1B1B18] underline-offset-2 hover:bg-[#EFEFEB] hover:underline"
                          >
                            {name(p)}
                          </button>
                        </td>
                        <td className="py-1.5 font-mono text-[13px] text-[#3D3D38]">
                          {confirmedAt ? shortTime(confirmedAt) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
