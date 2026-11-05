"use client";

import { useEffect, useRef, useState } from "react";

import { translate } from "@/lib/api";
import { isOperating } from "@/lib/continuity";
import { formatRange, periodDays, periodEnd } from "@/lib/period";
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
import { scheduleName } from "@/lib/wording";

import { takeConfirmedEntry } from "./confirmedEntry";
import ConstraintCard from "./ConstraintCard";
import { Spinner, today } from "./RulesStep";
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
  const { employees, period: range, holidays = [] } = toScheduleRequest(shop, period, periods, now);
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
  const diff = unconfirmed ? (result?.diff ?? []) : [];

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

  const csv = () => result && downloadCsv(period, employees, result);
  const todayInfo = isOperating(period, now) ? periodDays(period).find((d) => d.date === now) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div>
          <button type="button" onClick={() => go({ screen: "home" })} className={ui.textSm}>
            ← 근무표 목록
          </button>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 ref={titleRef} tabIndex={-1} className={`${ui.pageTitle} outline-none`}>
              {scheduleName(period, shop.unit)}
            </h1>
            <span className="font-mono text-sm text-[#66665E]">{formatRange(period)}</span>
            {isOperating(period, now) ? (
              <span className={`${ui.badge} ${ui.badgeTone.operating}`}>운영 중</span>
            ) : (
              <span className={`${ui.badge} ${ui.badgeTone.confirmed}`}>확정</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {sv.loading && (
              <span role="status" className={`${ui.help} flex items-center gap-1.5`}>
                <Spinner />
                만드는 중…
              </span>
            )}
            {lastVersion && (
              <span className={ui.help}>
                마지막 확정 <span className="font-mono">{shortTime(lastVersion.confirmed_at)}</span> · 직원 링크는 잠겼어요
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
          <ChangeBar inputRef={inputRef} busy={busy} translating={translating} onSubmit={translateChange} />
          <div className="flex min-w-0 flex-col gap-3">
            {changeCards.length === 0 ? (
              <p className="text-sm text-[#66665E]">아직 변경이 없어요.</p>
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
            <p role="status" className={`${ui.banner} flex-1 justify-start! self-stretch`}>
              <span aria-hidden="true" className="size-4 shrink-0 rounded-xs bg-white shadow-[inset_0_0_0_2px_#D97706]" />
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
            <p className="text-[13px] text-[#3D3D38]">
              오늘은{" "}
              <span className="font-mono">
                {todayInfo.month}/{todayInfo.dom}
              </span>{" "}
              {WEEKDAYS[todayInfo.weekday]}예요. 지난 날짜는 <InlineLock /> 자동으로 고정돼요.
            </p>
          )
        }
        actions={
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                {!ended && revertable && (
                  <button type="button" onClick={revert} disabled={busy} className={ui.text}>
                    변경 취소
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={csv} disabled={busy} className={!ended && (unconfirmed || revertable) ? ui.text : ui.secondary}>
                  CSV 받기
                </button>
                {!ended && unconfirmed && outdated && <p className={`${ui.help} mr-1`}>지금 조건으로 만든 근무표만 확정할 수 있어요</p>}
                {!ended && unconfirmed && (
                  <button type="button" onClick={reconfirm} disabled={busy || outdated} className={ui.primaryLg}>
                    다시 확정
                  </button>
                )}
              </div>
            </div>
            <section className="flex flex-col gap-3">
              <h2 className={ui.sectionTitle}>확정 기록</h2>
              <ul className={`${ui.card} flex flex-col py-1.5!`}>
                {period.versions
                  .map((v, i) => (
                    <li key={v.confirmed_at} className="flex items-center gap-2 border-b border-[#EFEFEB] py-2 text-[13px] text-[#3D3D38] last:border-b-0">
                      <span className="font-mono font-medium text-[#1B1B18]">{shortTime(v.confirmed_at)}</span>· 확정 ·{" "}
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
        <p className="text-[13px] text-[#3D3D38]">
          확정한 뒤 생긴 병가·휴가를 적으면, 확정 근무표에서 최소한으로 바꿔 다시 만들어요. 이미 지난 날은 건드리지 않아요.
        </p>
      </div>
      <form
        className={`${ui.bar} ${tooLong ? "border-[#B42318]!" : ""}`}
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
        <p className="text-sm text-[#1B1B18]">
          {notice} <span className="text-xs font-medium text-[#66665E]">내용을 보완해서 다시 입력해 주세요.</span>
        </p>
      )}
    </div>
  );
}
