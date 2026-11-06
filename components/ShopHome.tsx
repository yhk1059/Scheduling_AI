"use client";

import { useEffect, useState } from "react";

import { formatRange } from "@/lib/period";
import { closingSpread } from "@/lib/stats";
import { loadShareStatus, type AvailabilityLink } from "@/lib/supabase";
import { homeSummary, isShopReady, upcomingRange, useAppStore, viewForPeriod, type WorkPeriod } from "@/lib/store";
import { nextTask, scheduleName, TASK_STEPS, taskDoneSteps, unitShort, shopRuleCount } from "@/lib/wording";

import { markConfirmedEntry } from "./confirmedEntry";
import { today } from "./RulesStep";
import { ui } from "./ui";

/** 홈의 확정 시각: "10/28 14:32". */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 진행 단계 한 줄(표시만, 누를 수 없다). Stepper와 같은 모양이다. */
function TaskProgress({ done }: { done: number }) {
  return (
    <ol aria-label="진행 단계" className="flex items-center gap-2 text-sm">
      {TASK_STEPS.map((label, i) => {
        const finished = i < done;
        const current = i === done;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-[#C9C9C1]" />}
            {finished ? (
              <span className="flex size-[22px] items-center justify-center rounded-full bg-[#E3F0F3] text-[#155E75]">
                <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M2.5 6.2 5 8.5l4.5-5" />
                </svg>
              </span>
            ) : (
              <span
                className={`flex size-[22px] items-center justify-center rounded-full font-mono text-xs ${
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

/** 작성 중 근무표의 공용 링크와 제출 현황. 읽기만 한다(링크를 만들고 맞추는 것은 ① 가능 시간). period가 없으면 읽지 않는다. */
function useShareStatus(period: WorkPeriod | null) {
  const shop = useAppStore((s) => s.shop);
  const shopName = shop?.name ?? "";
  const employees = (shop?.employees ?? []).filter((n) => n.active);
  const roster = JSON.stringify(employees.map(({ id, name }) => ({ id, name })));
  const start = period?.start_date;
  const length = period?.length;
  const [links, setLinks] = useState<{ key: string; shareToken: string; rows: AvailabilityLink[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [none, setNone] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${start}|${length}|${shopName}|${roster}`;

  useEffect(() => {
    if (start === undefined || length === undefined) return;
    let live = true;
    loadShareStatus(start)
      .then((loaded) => {
        if (!live) return;
        setLinks(loaded ? { key, ...loaded } : null);
        setNone(loaded ? null : key);
      })
      .catch(() => {
        if (live) setFailed(key);
      });
    return () => {
      live = false;
    };
  }, [key, start, length, attempt]);

  const current = links?.key === key ? links : null;
  return {
    url: current ? `${location.origin}/a/${current.shareToken}` : null,
    total: employees.length,
    missing: employees.filter((n) => !current?.rows.find((r) => r.employee_id === n.id)?.submitted_at).map((n) => n.name),
    failed: failed === key,
    none: none === key,
    reload: () => {
      setFailed(null);
      setAttempt((n) => n + 1);
    },
  };
}

/** 지금 할 일 패널 오른쪽의 직원 링크 카드. */
function ShareCard({ status }: { status: ReturnType<typeof useShareStatus> }) {
  const { url, total, missing, failed, none, reload } = status;
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const submitted = total - missing.length;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url ?? "");
      setCopied(url);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div className={`${ui.card} flex min-w-0 flex-col gap-2.5`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[#1B1B18]">직원 링크</h3>
        {url && (
          <button type="button" onClick={() => void copy()} className={ui.secondarySm}>
            {copied === url ? "복사했어요" : "링크 복사"}
          </button>
        )}
      </div>
      {url && (
        <>
          <p className="truncate font-mono text-xs text-[#3D3D38]">{url}</p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] text-[#1B1B18]">
              <span className="font-mono">
                {submitted} / {total}
              </span>
              명 제출
            </p>
            <button type="button" onClick={reload} className={ui.textSm}>
              새로고침
            </button>
          </div>
          <div aria-hidden="true" className="h-1.5 overflow-hidden rounded bg-[#E2E2DC]">
            <div className="h-full bg-[#155E75]" style={{ width: `${total === 0 ? 0 : (submitted / total) * 100}%` }} />
          </div>
          {missing.length > 0 && <p className={ui.help}>미제출: {missing.join(", ")}</p>}
        </>
      )}
      {failed ? (
        <div role="alert" className="flex flex-col items-start gap-1 text-[13px] text-[#B42318]">
          링크를 불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요
          <button type="button" onClick={reload} className={ui.textSm}>
            다시 시도
          </button>
        </div>
      ) : (
        !url && (
          <p role="status" className={ui.help}>
            {none ? "[이어서 하기]를 누르면 링크가 만들어져요." : "불러오는 중…"}
          </p>
        )
      )}
      {copyFailed && (
        <p role="alert" className={ui.error}>
          복사하지 못했어요. 위의 링크를 직접 복사해 주세요
        </p>
      )}
    </div>
  );
}

/** 지금 할 일: 다음 근무표의 상태 문장, 진행 단계, 버튼 하나. 작성 중이면 오른쪽에 직원 링크 카드를 둔다. */
function TaskPanel() {
  const shop = useAppStore((s) => s.shop)!;
  const periods = useAppStore((s) => s.periods);
  const createPeriod = useAppStore((s) => s.createPeriod);
  const go = useAppStore((s) => s.go);
  const now = today();
  const { next } = homeSummary(periods, now);
  const task = nextTask(shop, periods, now);
  const draft = next.state === "draft" ? next.period : null;
  const share = useShareStatus(draft);
  const create = () => createPeriod(now);
  // 다음 근무표(오늘 이후 가장 늦은 근무표)가 확정됐으면 그다음 근무표를 만들 수 있다
  const canCreateAfter = next.state === "confirmed";
  const afterName = scheduleName(upcomingRange(shop.unit, periods, now), shop.unit);
  const submittedText = share.url ? `${share.total}명 중 ${share.total - share.missing.length}명이 가능 시간을 제출했어요.` : "";

  return (
    <section className={`${ui.panel} px-8! py-7! ${draft ? "grid grid-cols-[1fr_320px] gap-8" : ""}`}>
      <div className="flex min-w-0 flex-col items-start gap-3.5">
        <div className="flex items-center gap-2.5">
          <span className={ui.eyebrow}>지금 할 일</span>
          <span className="font-mono text-xs text-[#66665E]">
            {formatRange(next.state === "none" ? upcomingRange(shop.unit, periods, now) : next.period)}
          </span>
        </div>
        <div className="text-[22px] leading-[1.35] font-semibold text-[#1B1B18]">
          <h2 className="inline">{task.name}</h2>
          {task.kind === "none" &&
            (periods.length === 0 ? " · 첫 근무표를 만들 차례예요" : "를 만들 차례예요")}
          {task.kind === "drafting" && " · 직원 링크를 공유하고 조건을 확인하세요"}
          {task.kind === "generated" && " · 근무표를 만들었어요. 확인하고 확정하세요"}
          {task.kind === "confirmed" && (
            <>
              {" · 확정했어요"}
              {task.confirmedAt && (
                <>
                  {" · "}
                  <span className="font-mono">{shortTime(task.confirmedAt)}</span>
                </>
              )}
            </>
          )}
        </div>
        {draft && (
          <p className="text-sm leading-relaxed text-[#3D3D38]">
            {task.kind === "drafting" ? `아직 근무표를 만들지 않았어요. ${submittedText}` : submittedText}
          </p>
        )}
        <TaskProgress done={taskDoneSteps(task)} />
        <div className="flex items-center gap-2">
          {next.state === "none" ? (
            <button type="button" onClick={create} className={ui.primaryLg}>
              {task.name} 만들기
            </button>
          ) : task.kind === "confirmed" ? (
            <>
              <button type="button" onClick={() => go(viewForPeriod(next.period))} className={ui.secondaryLg}>
                열기
              </button>
              {canCreateAfter && (
                <button type="button" onClick={create} className={ui.primaryLg}>
                  {afterName} 만들기
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={() => go(viewForPeriod(next.period))} className={ui.primaryLg}>
              {task.kind === "generated" ? "근무표 확인하기" : "이어서 하기"}
            </button>
          )}
        </div>
      </div>
      {draft && <ShareCard status={share} />}
    </section>
  );
}

export default function ShopHome() {
  const shop = useAppStore((s) => s.shop);
  const periods = useAppStore((s) => s.periods);
  const go = useAppStore((s) => s.go);
  if (!shop) return null;

  const ready = isShopReady(shop);
  const employeeCount = shop.employees.filter((n) => n.active).length;
  const now = today();
  const { operating, next, recent } = homeSummary(periods, now);
  const open = (p: WorkPeriod) => go(viewForPeriod(p));
  const name = (p: WorkPeriod) => scheduleName(p, shop.unit);
  // 운영 중 카드·지금 할 일 카드에 나온 근무표는 다시 보여 주지 않는다
  const shown = new Set([operating?.id, next.state === "none" ? undefined : next.period.id]);
  const rest = recent.filter((p) => p.status === "confirmed" && !shown.has(p.id));
  // 오늘 이후에 시작하는 확정 근무표는 지난 근무표가 아니라 다가오는 근무표다
  const upcoming = rest.filter((p) => p.start_date > now);
  const past = rest.filter((p) => p.start_date <= now);
  const operatingAt = operating?.versions.at(-1)?.confirmed_at;

  const table = (rows: WorkPeriod[]) => (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-[#E2E2DC] text-left text-xs font-medium text-[#66665E]">
          <th className="py-2 pr-4 font-medium">근무표</th>
          <th className="py-2 pr-4 font-medium">날짜</th>
          <th className="py-2 pr-4 font-medium">확정</th>
          <th className="py-2 pr-4 font-medium">마감 횟수 차이</th>
          <th className="py-2 font-medium">
            <span className="sr-only">열기</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const last = p.versions.at(-1);
          const again = p.versions.length - 1;
          const spread = last
            ? closingSpread(last.assignments, shop.config, (p.snapshot?.employees ?? shop.employees).filter((n) => n.active).map((n) => n.id))
            : null;
          return (
            <tr
              key={p.id}
              onClick={() => open(p)}
              className="cursor-pointer border-b border-[#EFEFEB] transition-colors duration-[120ms] last:border-b-0 hover:bg-[#F6F6F3]"
            >
              <td className="py-1.5 pr-4 font-medium text-[#1B1B18]">{name(p)}</td>
              <td className="py-1.5 pr-4 font-mono text-[#3D3D38]">{formatRange(p)}</td>
              <td className="py-1.5 pr-4 text-[#3D3D38]">
                <span className="font-mono">{last ? shortTime(last.confirmed_at) : "—"}</span>
                {again > 0 && (
                  <>
                    {" · "}
                    <span className="font-mono">{again}</span>번 다시 확정
                  </>
                )}
              </td>
              <td className="py-1.5 pr-4 font-mono text-[#3D3D38]">{spread ? `${spread.min} ~ ${spread.max}` : "—"}</td>
              <td className="py-1.5 text-right">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    open(p);
                  }}
                  className={ui.textSm}
                >
                  열기 →
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className={ui.pageTitle}>{shop.name || "이름 없는 매장"}</h1>
        <div className="flex items-center gap-2 text-[13px] text-[#66665E]">
          <span>
            직원 <span className="font-mono">{employeeCount}</span>명 · 매장 조건{" "}
            <span className="font-mono">{shopRuleCount(shop.rules)}</span>개 · {unitShort(shop.unit)}
          </span>
          <button type="button" onClick={() => go({ screen: "settings", tab: "shifts" })} className={ui.text}>
            매장 설정
          </button>
        </div>
      </div>

      {!ready ? (
        <section className={`${ui.card} flex items-center justify-between gap-4`}>
          <p className="text-sm leading-relaxed text-[#3D3D38]">
            명단을 입력하면 첫 근무표를 만들 수 있어요.
          </p>
          <button type="button" onClick={() => go({ screen: "settings", tab: "roster" })} className={ui.primary}>
            매장 설정 열기
          </button>
        </section>
      ) : (
        <>
          {operating && (
            <section className="flex items-center gap-3 rounded-lg border border-[#E2E2DC] bg-white px-5 py-3.5">
              <span className={`${ui.badge} ${ui.badgeTone.operating}`}>운영 중</span>
              <h2 className="text-base font-semibold text-[#1B1B18]">
                <button
                  type="button"
                  onClick={() => open(operating)}
                  className="rounded-md underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155E75]"
                >
                  {name(operating)}
                </button>
              </h2>
              <span className="font-mono text-xs text-[#66665E]">{formatRange(operating)}</span>
              {operatingAt && (
                <span className="text-xs text-[#66665E]">
                  마지막 확정 <span className="font-mono">{shortTime(operatingAt)}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  markConfirmedEntry(operating.id, "change");
                  go({ screen: "confirmed", periodId: operating.id });
                }}
                className={`${ui.secondary} ml-auto`}
              >
                변경 입력
              </button>
            </section>
          )}

          <TaskPanel />

          {upcoming.length > 0 && (
            <section className={`${ui.card} flex flex-col gap-3`}>
              <h2 className={ui.cardTitle}>다가오는 근무표</h2>
              {table(upcoming)}
            </section>
          )}

          <section className={`${ui.card} flex flex-col gap-3`}>
            <h2 className={ui.cardTitle}>지난 근무표</h2>
            {past.length === 0 ? <p className="text-sm text-[#3D3D38]">확정한 근무표가 여기에 쌓여요.</p> : table(past)}
          </section>
        </>
      )}
    </div>
  );
}
