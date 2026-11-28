"use client";

import { useEffect, useRef, useState } from "react";

import { translate } from "@/lib/api";
import { DEMO_LEAVE_PREFIX, demoLeaveCard } from "@/lib/demo";
import { diffAssignments, isOperating } from "@/lib/continuity";
import { formatRange, periodDays, periodEnd } from "@/lib/period";
import { scheduleSvg } from "@/lib/schedule-image";
import {
  canRevertToConfirmed,
  cardsInOrder,
  carryOverChanged,
  currentPeriod,
  findReplaced,
  hasUnconfirmedChanges,
  toScheduleRequest,
  useAppStore,
} from "@/lib/store";
import { josa, scheduleName } from "@/lib/wording";

import { takeConfirmedEntry } from "./confirmedEntry";
import ConstraintCard from "./ConstraintCard";
import { Spinner, today } from "./RulesStep";
import { StepBar } from "./Stepper";
import { downloadCsv, InlineLock, ScheduleBody, toMessage, ToastAlert, useSolve, WEEKDAYS } from "./ScheduleStep";
import { shortTime } from "./ShopHome";
import { ui } from "./ui";
import { Mark } from "./Wordmark";

const MAX_TEXT_CHARS = 1000; // backend/domain/constants.py MAX_TEXT_CHARS

/**
 * 확정 근무표: 스테퍼 없이 변경 입력이 맨 위에 있다. 카드를 [적용]하면 확정본에서 최소한으로 바꿔 다시 만들고,
 * [다시 확정]으로 새 확정본을 남기거나 [변경 취소]로 마지막 확정본으로 되돌린다. 끝난 근무표는 보기 전용이다.
 */
export default function ConfirmedPeriod() {
  const shop = useAppStore((s) => s.shop);
  const period = useAppStore(currentPeriod);
  const periods = useAppStore((s) => s.periods);
  const inputVersion = useAppStore((s) => s.inputVersion);
  const confirm = useAppStore((s) => s.confirm);
  const revertToConfirmed = useAppStore((s) => s.revertToConfirmed);
  const removeRequest = useAppStore((s) => s.removeRequest);
  const addPendingRequests = useAppStore((s) => s.addPendingRequests);
  const go = useAppStore((s) => s.go);
  const demo = useAppStore((s) => s.demo);
  const sv = useSolve(period?.id ?? "");

  const [entry] = useState(() => (period ? takeConfirmedEntry(period.id) : null));
  const [translating, setTranslating] = useState(false);
  // 이 화면의 변경 입력 바에서 만든 카드(대기·적용). [다시 확정]이나 [변경 취소]까지 남겨 둔다
  const [changeIds, setChangeIds] = useState<string[]>([]);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // [변경 입력]으로 오면 입력 바, 그 밖에는 제목에 포커스를 둔다
  useEffect(() => {
    (entry === "change" ? inputRef.current : titleRef.current)?.focus();
  }, [entry]);

  if (!shop || !period || period.status !== "confirmed") return null;
  const periodId = period.id;
  const now = today();
  const ended = periodEnd(period) < now;
  const busy = sv.busy || translating;
  const { employees, period: range, holidays = [], constraints = [] } = toScheduleRequest(shop, period, periods, now);
  const { result } = period;
  const lastVersion = period.versions.at(-1);
  const unconfirmed = hasUnconfirmedChanges(period);
  const revertable = canRevertToConfirmed(period);
  // 지금 입력으로 만든 근무표가 아니면(다시 만들어도 근무표가 없으면) 다시 확정하지 않는다
  const outdated = period.resultVersion !== inputVersion;
  const ofChange = (c: { id: string }) => changeIds.includes(c.id);
  const changeCards = cardsInOrder(period.pendingRequests.filter(ofChange), period.requests.filter(ofChange), period.cardOrder);
  // 다시 만들기가 끝나 결과에 반영됐을 때만 그렇게 적는다
  const appliedLabel = sv.busy || sv.outcome || sv.toast ? undefined : "적용됨 · 다시 만들었어요";
  // 솔버의 diff는 직전 결과와의 차이라 마지막 확정본과 직접 비교한다
  // 확정본과 다른 표가 보이는 중(다시 확정 전)
  const draftShown = !ended && unconfirmed;
  const diff = unconfirmed && result && lastVersion ? diffAssignments(lastVersion.assignments, result.assignments) : [];

  const translateChange = async (input: string): Promise<string | null> => {
    setTranslating(true);
    sv.setToast(null);
    try {
      const res = await translate({ text: input, scope: "period", context: { config: shop.config, employees, period: range, holidays, today: today() } });
      if (res.status === "ok") {
        addPendingRequests(periodId, res.constraints, res.examples);
        setChangeIds((ids) => [...ids, ...res.constraints.map((c) => c.id)]);
        return null;
      }
      return res.status === "clarify" ? res.question : `아직 지원하지 않는 요청이에요: ${res.reason}`;
    } catch (e) {
      sv.setToast({ message: toMessage(e), retry: () => void translateChange(input) });
      return null;
    } finally {
      setTranslating(false);
    }
  };

  const reconfirm = () => {
    confirm(periodId);
    setChangeIds([]);
  };

  const revert = () => {
    for (const id of changeIds) removeRequest(periodId, id); // 적용하지 않은 변경 카드도 치운다
    revertToConfirmed(periodId);
    sv.clearOutcome();
    setChangeIds([]);
  };

  // 체험은 LLM을 부르지 않고 예시 병가 카드를 넣는다. 이미 넣었으면 그 카드를 쓴다(다시 만든 결과로 사람이 바뀌지 않게)
  const added = [...period.pendingRequests, ...period.requests].find((c) => c.id.startsWith(DEMO_LEAVE_PREFIX));
  // 손으로 고정한 칸이 있는 직원은 예시 병가에서 뺀다(고정과 병가가 부딪혀 근무표가 없어진다)
  const fixed = constraints.flatMap((c) => (c.type === "fixed_assignment" && c.enabled !== false ? [c.params] : []));
  const sample = demo && result ? (added ?? demoLeaveCard(range, result.assignments, employees, fixed)) : null;
  const addSample = () => {
    if (!sample) return;
    addPendingRequests(periodId, [sample]);
    setChangeIds((ids) => [...ids, sample.id]);
  };

  // 받기·인쇄는 직원에게 보이는 것(마지막 확정본)이다. 다시 확정하기 전의 바뀐 표는 내보내지 않는다
  const shared = draftShown && lastVersion ? lastVersion.assignments : result?.assignments;
  const csv = () => result && shared && downloadCsv(period, employees, { ...result, assignments: shared });
  const svg = () =>
    shared &&
    scheduleSvg({
      title: `${shop.name ? `${shop.name} · ` : ""}${scheduleName(period, shop.unit)}`,
      employees,
      period,
      holidays: period.holidays,
      assignments: shared,
      config: shop.config,
    });
  const fileName = `근무표-${period.start_date}_${periodEnd(period)}`;
  const image = () => {
    const s = svg();
    if (s) void downloadPng(s, `${fileName}.png`);
  };
  const print = () => {
    const s = svg();
    if (s) printSvg(s, fileName);
  };
  const todayInfo = isOperating(period, now) ? periodDays(period).find((d) => d.date === now) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div>
          <button type="button" onClick={() => go({ screen: "home" })} className={ui.textSm}>
            ← 근무표 목록
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 ref={titleRef} tabIndex={-1} className={`${ui.pageTitle} outline-none`}>
              {scheduleName(period, shop.unit)}
            </h1>
            <span className="font-mono text-sm text-muted">{formatRange(period)}</span>
            {isOperating(period, now) ? (
              <span className={`${ui.badge} ${ui.badgeTone.operating}`}>운영 중</span>
            ) : (
              <span className={`${ui.badge} ${ui.badgeTone.confirmed}`}>확정</span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-3">
            {sv.loading && (
              <span role="status" className={`${ui.help} flex items-center gap-1.5`}>
                <Spinner />
                만드는 중…
              </span>
            )}
            {lastVersion && (
              <span className={ui.help}>
                마지막 확정 <span className="font-mono">{shortTime(lastVersion.confirmed_at)}</span> ·{" "}
                {demo ? "체험이라 직원 링크는 잠그지 않았어요" : "직원 링크는 잠겼어요. 직원은 같은 링크에서 근무표를 봐요"}
              </span>
            )}
          </div>
        </div>
      </div>

      {!ended && carryOverChanged(period, periods) && (
        <div role="status" className={ui.banner}>
          지난 근무표가 바뀌어 이어지는 근무가 달라졌어요. 다시 만들면 반영돼요
          <button type="button" onClick={sv.run} disabled={busy} className={ui.textSm}>
            다시 만들기
          </button>
        </div>
      )}

      {sv.toast && <ToastAlert toast={sv.toast} busy={busy} onClose={() => sv.setToast(null)} />}

      {!ended && (
        <section className={`${ui.panel} grid grid-cols-[7fr_5fr] gap-6`}>
          {sample ? (
            <DemoChangeBar
              sample={sample.source_text}
              added={added !== undefined}
              busy={busy}
              onAdd={addSample}
            />
          ) : (
            <ChangeBar inputRef={inputRef} busy={busy} translating={translating} onSubmit={translateChange} />
          )}
          <div className="flex min-w-0 flex-col gap-3">
            {changeCards.length === 0 ? (
              <p className="text-sm text-muted">아직 변경이 없어요.</p>
            ) : (
              changeCards.map(({ card, pending }) =>
                pending ? (
                  <ConstraintCard
                    key={card.id}
                    card={card}
                    pending
                    replaces={findReplaced(period.requests, card)}
                    busy={busy}
                    onApplied={sv.run}
                    compact
                  />
                ) : (
                  <ConstraintCard key={card.id} card={card} pending={false} readOnly appliedLabel={appliedLabel} compact />
                ),
              )
            )}
          </div>
        </section>
      )}

      <ScheduleBody
        period={period}
        solve={sv}
        busy={busy}
        readOnly={ended}
        summaryLead={
          diff.length > 0 && (
            <p role="status" className={`${ui.banner} min-w-[360px] flex-1 justify-start! self-stretch`}>
              <span aria-hidden="true" className="size-4 shrink-0 rounded-xs bg-white shadow-[inset_0_0_0_2px_var(--color-changed)]" />
              <span>
                <strong className="font-semibold">
                  <span className="font-mono">{new Set(diff.map((c) => c.employee_id)).size}</span>명,{" "}
                  <span className="font-mono">{diff.length}</span>칸 변경
                </strong>{" "}
                · 주황 테두리 칸이 바뀐 곳이에요. 아직 다시 확정하지 않았어요.
              </span>
            </p>
          )
        }
        gridNote={
          todayInfo && (
            <p className="text-[13px] text-body">
              오늘은{" "}
              <span className="font-mono">
                {todayInfo.month}/{todayInfo.dom}
              </span>{" "}
              {WEEKDAYS[todayInfo.weekday]}
              {josa(WEEKDAYS[todayInfo.weekday], "이에요", "예요")}. 지난 날짜는 <InlineLock /> 자동으로 고정돼요.
            </p>
          )
        }
        actions={
          <>
            <section className="flex flex-col gap-3">
              <h2 className={ui.sectionTitle}>확정 기록</h2>
              <ul className={`${ui.card} flex flex-col py-1.5!`}>
                {period.versions
                  .map((v, i) => (
                    <li key={`${i}-${v.confirmed_at}`} className="flex items-center gap-2 border-b border-soft py-2 text-[13px] text-body last:border-b-0">
                      <span className="font-mono font-medium text-ink">{shortTime(v.confirmed_at)}</span>· 확정 ·{" "}
                      {i === 0 ? (
                        "처음 확정"
                      ) : (
                        <span>
                          바뀐 칸 <span className="font-mono">{v.changed.length}</span>칸
                        </span>
                      )}
                    </li>
                  ))
                  .reverse()}
              </ul>
            </section>
            {/* 확정 뒤에도 할 일(다시 확정·공유)은 아래 고정 바에 둔다 */}
            <StepBar caption={ended ? "끝난 근무표예요" : draftShown ? "바뀐 칸이 있어요. 다시 확정해야 직원에게 보여요" : "확정한 근무표예요"}>
              {!ended && revertable && (
                <button type="button" onClick={revert} disabled={busy} className={ui.text}>
                  변경 취소
                </button>
              )}
              {draftShown && (
                <p className={`${ui.help} mr-1`}>{outdated ? "지금 조건으로 만든 근무표만 확정할 수 있어요" : "받기·인쇄는 마지막 확정본이에요"}</p>
              )}
              <button type="button" onClick={csv} disabled={busy} className={draftShown ? ui.text : ui.secondary}>
                CSV 받기
              </button>
              <button type="button" onClick={image} disabled={busy} className={draftShown ? ui.text : ui.secondary}>
                이미지 받기
              </button>
              <button type="button" onClick={print} disabled={busy} className={draftShown ? ui.text : ui.secondary}>
                인쇄
              </button>
              {draftShown && (
                <button type="button" onClick={reconfirm} disabled={busy || outdated} className={ui.primaryLg}>
                  다시 확정
                </button>
              )}
            </StepBar>
          </>
        }
      />
    </div>
  );
}

function ChangeBar({
  inputRef,
  busy,
  translating,
  onSubmit,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  translating: boolean;
  onSubmit: (text: string) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const tooLong = text.length > MAX_TEXT_CHARS;

  const submit = async () => {
    setNotice(null);
    const input = text.trim();
    const question = await onSubmit(input);
    if (question) setNotice(question);
    else setText((t) => (t.trim() === input ? "" : t));
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className={ui.cardTitle}>변경 입력</h2>
        <p className="text-[13px] text-body">
          확정한 뒤 생긴 병가·휴가를 적으면, 확정 근무표에서 최소한으로 바꿔 다시 만들어요. 이미 지난 날은 건드리지 않아요.
        </p>
      </div>
      <form
        className={`${ui.bar} ${tooLong ? "border-error!" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !tooLong && text.trim() !== "") void submit();
        }}
      >
        <Mark size={18} />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="예: 최지훈 이번 주 병가"
          aria-label="변경 입력"
          aria-invalid={tooLong || undefined}
          className={ui.barInput}
        />
        <button type="submit" disabled={busy || tooLong || text.trim() === ""} className={ui.primaryBar}>
          {translating && <Spinner />}
          {translating ? "읽는 중…" : "요청 만들기"}
        </button>
      </form>
      {notice && (
        <p className="text-sm text-ink">
          {notice} <span className="text-xs font-medium text-muted">내용을 보완해서 다시 입력해 주세요.</span>
        </p>
      )}
    </div>
  );
}

/** 체험의 변경 입력 자리: 말로 적는 대신 예시 병가 카드를 넣는다. */
function DemoChangeBar({ sample, added, busy, onAdd }: { sample: string; added: boolean; busy: boolean; onAdd: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className={ui.cardTitle}>변경 입력</h2>
        <p className="text-[13px] text-body">
          확정한 뒤 생긴 병가·휴가를 적으면, 확정 근무표에서 최소한으로 바꿔 다시 만들어요. 체험에서는 말로 적는 대신 예시 병가를 넣어 볼 수
          있어요.
        </p>
      </div>
      <div>
        <button type="button" onClick={onAdd} disabled={busy || added} className={ui.secondary}>
          {added ? "예시 병가를 넣었어요" : `예시 넣기: “${sample}”`}
        </button>
      </div>
      {added && <p className={ui.help}>오른쪽 카드에서 [적용]을 누르면 바뀌는 칸을 최소로 줄여 다시 만들어요.</p>}
    </div>
  );
}

/** SVG를 2배 크기 PNG로 그려 내려받는다. 단체 대화방에 바로 올릴 수 있게. */
async function downloadPng(svg: string, name: string) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width * 2;
  canvas.height = img.height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(2, 2);
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** 보이지 않는 iframe에 근무표 그림만 넣고 인쇄 창을 연다(가로 방향, 한 장 너비에 맞춤). */
function printSvg(svg: string, title: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>@page{size:landscape;margin:10mm}html,body{margin:0}svg{width:100%;height:auto}</style></head><body>${svg}</body></html>`;
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    win.addEventListener("afterprint", () => frame.remove());
    win.focus();
    win.print();
  };
  document.body.appendChild(frame);
}
