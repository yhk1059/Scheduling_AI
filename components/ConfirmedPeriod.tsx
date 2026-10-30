"use client";

import { useEffect, useRef, useState } from "react";

import { translate } from "@/lib/api";
import { isOperating } from "@/lib/continuity";
import { formatRange, periodEnd } from "@/lib/period";
import {
  canRevertToConfirmed,
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
import { downloadCsv, ScheduleBody, toMessage, ToastAlert, useSolve } from "./ScheduleStep";
import { ui } from "./ui";
import { confirmedTime } from "./ShopHome";

const MAX_TEXT_CHARS = 1000; // backend/domain/constants.py MAX_TEXT_CHARS

/**
 * 확정 근무표: 스테퍼 없이 변경 입력이 맨 위에 있다. 카드를 [적용]하면 확정본에서 최소한으로 바꿔 다시 만들고,
 * [다시 확정]으로 새 확정본을 남기거나 [변경 취소]로 마지막 확정본으로 되돌린다. 끝난 근무표는 보기 전용이다.
 */
export default function ConfirmedPeriod() {
  const shop = useAppStore((s) => s.shop);
  const period = useAppStore(currentPeriod);
  const periods = useAppStore((s) => s.periods);
  const confirm = useAppStore((s) => s.confirm);
  const revertToConfirmed = useAppStore((s) => s.revertToConfirmed);
  const removeRequest = useAppStore((s) => s.removeRequest);
  const addPendingRequests = useAppStore((s) => s.addPendingRequests);
  const go = useAppStore((s) => s.go);
  const sv = useSolve(period?.id ?? "");

  const [entry] = useState(() => (period ? takeConfirmedEntry(period.id) : null));
  const [translating, setTranslating] = useState(false);
  // 이 화면의 변경 입력 바에서 만든 대기 카드
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
  const changeCards = period.pendingRequests.filter((c) => changeIds.includes(c.id));
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
            <h1 ref={titleRef} tabIndex={-1} className="text-[22px] font-semibold text-[#1B1B18] outline-none">
              {scheduleName(period, shop.unit)}
            </h1>
            <span className="font-mono text-sm text-[#66665E]">{formatRange(period)}</span>
            {isOperating(period, now) ? (
              <span className={`${ui.badge} bg-[#E3F0F3] text-[#155E75]`}>운영 중</span>
            ) : (
              <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>확정</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {sv.loading && (
              <span role="status" className={`${ui.help} mr-1 flex items-center gap-1.5`}>
                <Spinner />
                만드는 중…
              </span>
            )}
            {lastVersion && (
              <span className={`${ui.help} mr-1`}>
                마지막 확정 <span className="font-mono">{confirmedTime(lastVersion.confirmed_at)}</span>
              </span>
            )}
            {!ended && (unconfirmed || revertable) ? (
              <>
                {revertable && (
                  <button type="button" onClick={revert} disabled={busy} className={ui.text}>
                    변경 취소
                  </button>
                )}
                <button type="button" onClick={csv} disabled={busy} className={ui.text}>
                  CSV 받기
                </button>
                {unconfirmed && (
                  <button type="button" onClick={reconfirm} disabled={busy} className={ui.primary}>
                    다시 확정
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={csv} disabled={busy} className={ui.secondary}>
                CSV 받기
              </button>
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

      {!ended && <ChangeBar inputRef={inputRef} busy={busy} translating={translating} onSubmit={translateChange} />}
      {changeCards.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {changeCards.map((c) => (
            <ConstraintCard
              key={c.id}
              card={c}
              pending
              replaces={findReplaced(period.requests, c)}
              busy={busy}
              onApplied={sv.run}
            />
          ))}
        </div>
      )}

      <ScheduleBody period={period} solve={sv} busy={busy} readOnly={ended}>
        {diff.length > 0 && (
          <p role="status" className="rounded-lg border border-[#F1D3A8] bg-[#FDF0DC] px-4 py-2.5 text-sm text-[#7A4506]">
            <span className="font-mono font-semibold">{new Set(diff.map((c) => c.employee_id)).size}</span>명,{" "}
            <span className="font-mono font-semibold">{diff.length}</span>칸 변경 · 주황 테두리 칸이 바뀐 곳이에요. [다시
            확정]하면 새 확정본으로 남겨요.
          </p>
        )}
      </ScheduleBody>
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
    <section className={`${ui.card} flex flex-col gap-2.5`}>
      <div className="flex flex-col gap-1">
        <h2 className={ui.cardTitle}>변경 입력</h2>
        <p className={ui.help}>확정한 뒤 생긴 병가·휴가를 적으면, 확정 근무표에서 최소한으로 바꿔 다시 만들어요.</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !tooLong && text.trim() !== "") void submit();
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="예: 최지훈 이번 주 병가"
          aria-label="변경 입력"
          aria-invalid={tooLong || undefined}
          className={`${ui.input} flex-1 ${tooLong ? "border-[#B42318]" : ""}`}
        />
        <button type="submit" disabled={busy || tooLong || text.trim() === ""} className={ui.primary}>
          {translating && <Spinner />}
          {translating ? "읽는 중…" : "요청 만들기"}
        </button>
      </form>
      {notice && (
        <p className="text-sm text-[#1B1B18]">
          {notice} <span className="text-xs font-medium text-[#66665E]">내용을 보완해서 다시 입력해 주세요.</span>
        </p>
      )}
    </section>
  );
}
