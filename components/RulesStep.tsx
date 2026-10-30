"use client";

import { useState } from "react";

import { ApiError, errorMessage, translate } from "@/lib/api";
import { firstPeriodStart, periodFrom, type PeriodRange, type PeriodUnit } from "@/lib/period";
import {
  cardsInOrder,
  currentPeriod,
  findReplaced,
  orphanConstraintIds,
  toScheduleRequest,
  useAppStore,
  type Ward,
  type WorkPeriod,
} from "@/lib/store";
import type { ConstraintSpec } from "@/lib/types.gen";
import { wardRuleCount } from "@/lib/wording";

import ConstraintCard, { ShiftChangeCardView } from "./ConstraintCard";
import { ui } from "./ui";

const MAX_TEXT_CHARS = 1000; // backend/domain/constants.py MAX_TEXT_CHARS

const COPY = {
  ward: {
    title: "병동 규칙",
    description: "근무표가 바뀌어도 똑같이 지키는 규칙을 말로 적어 주세요. 만든 카드를 확인하고 [적용]해야 반영돼요.",
    placeholder: "예: 나이트 다음 날은 무조건 쉬게",
    submit: "규칙 만들기",
    empty: "아직 규칙이 없어요.",
    examples: ["나이트 다음 날은 무조건 쉬게", "3년차 이상이 매 근무 1명은 있게", "나이트는 3일 넘게 연속으로 하지 않게"],
  },
  period: {
    title: "요청",
    description: "이 근무표의 휴가, 고정 근무, 희망·기피 근무를 말로 적어 주세요. 만든 카드를 확인하고 [적용]해야 반영돼요.",
    placeholder: "예: 이영희 15~17일 휴가",
    submit: "요청 만들기",
    empty: "아직 요청이 없어요.",
    examples: [],
  },
} as const;

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 기간이 아직 없을 때 병동 규칙 해석·표시에 쓰는 다음 기간 범위. */
export function previewRange(unit: PeriodUnit): PeriodRange {
  return periodFrom(unit, firstPeriodStart(unit, today()));
}

type Notice = { kind: "clarify" | "unsupported"; text: string } | null;

/** pendingNote=false: 처음 설정 ③처럼 화면이 대기 카드 안내를 버튼 옆에 따로 둘 때. */
export default function RulesStep({ scope, pendingNote = true }: { scope: "ward" | "period"; pendingNote?: boolean }) {
  const copy = COPY[scope];
  const ward = useAppStore((s) => s.ward);
  const period = useAppStore(currentPeriod);
  const addPendingRules = useAppStore((s) => s.addPendingRules);
  const addPendingRequests = useAppStore((s) => s.addPendingRequests);
  const setDisabled = useAppStore((s) => s.setDisabled);
  const go = useAppStore((s) => s.go);

  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [failure, setFailure] = useState<{ message: string; text: string } | null>(null);
  const [blocked, setBlocked] = useState(false);

  if (!ward || (scope === "period" && !period)) return null;
  const orphanCount = orphanConstraintIds(ward, period).length;
  const pending = scope === "ward" ? ward.pendingRules : period!.pendingRequests;
  // 필요 인원 폼이 만든 제약(cov-*)은 [명단·필요 인원] 탭에서 다룬다
  const applied = scope === "ward" ? ward.rules.filter((c) => !c.id.startsWith("cov-")) : period!.requests;
  const cards = cardsInOrder(pending, applied, scope === "ward" ? ward.cardOrder : period!.cardOrder);
  const tooLong = text.length > MAX_TEXT_CHARS;

  // 설정 변경 카드와 딸린 카드(병동 규칙에만 있다). 딸린 카드는 설정 카드 바로 아래에 둔다
  const configCards = scope === "ward" ? ward.pendingConfig : [];
  const attached = new Map(configCards.flatMap((cfg) => cfg.ruleIds.map((id) => [id, cfg.change.shift.code] as const)));
  const pendingCount = pending.length + configCards.length;
  const order = ward.cardOrder ?? [];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  const items = [
    ...configCards.map((cfg) => ({ id: cfg.id, cfg, entry: null })),
    ...cards.filter(({ card }) => !attached.has(card.id)).map((entry) => ({ id: entry.card.id, cfg: null, entry })),
  ]
    .map((x, i) => ({ x, i }))
    .sort((a, b) => rank(a.x.id) - rank(b.x.id) || a.i - b.i)
    .map(({ x }) => x);

  const renderCard = (c: ConstraintSpec, isPending: boolean) =>
    isPending ? (
      <ConstraintCard
        key={c.id}
        card={c}
        pending
        replaces={findReplaced(scope === "ward" ? ward.rules : period!.requests, c)}
      />
    ) : scope === "period" ? (
      <ConstraintCard
        key={c.id}
        card={c}
        pending={false}
        off={period!.disabledIds.includes(c.id)}
        onToggleOff={(off) => setDisabled(period!.id, c.id, off)}
      />
    ) : (
      <ConstraintCard key={c.id} card={c} pending={false} />
    );

  const applyAll = () => {
    const store = useAppStore.getState();
    // 설정 카드를 먼저 적용해 근무 형태가 바뀐 뒤 규칙이 들어가게 한다
    for (const cfg of configCards) store.applyRule(cfg.id);
    // 표시 순서의 아래(오래된 카드)부터 적용해 교체 규칙이 새 카드를 남기게 한다
    for (const { card } of cards.filter((x) => x.pending).reverse()) {
      if (scope === "ward") store.applyRule(card.id);
      else store.applyRequest(period!.id, card.id);
    }
  };

  const run = async (input: string) => {
    setLoading(true);
    setNotice(null);
    setFailure(null);
    try {
      // 기간이 없으면(병동 설정) 활성 명단과 다음 기간 범위로 해석한다
      const { nurses, period: range, holidays } = period
        ? toScheduleRequest(ward, period, useAppStore.getState().periods, today())
        : {
            nurses: ward.nurses.filter((n) => n.active).map(({ id, name, years, tags }) => ({ id, name, years, tags })),
            period: previewRange(ward.unit),
            holidays: [],
          };
      const res = await translate({
        text: input,
        scope,
        context: { config: ward.config, nurses, period: range, holidays, today: today() },
      });
      if (res.status === "ok") {
        if (scope === "ward") addPendingRules(res.constraints, res.config_changes ?? [], res.examples);
        else addPendingRequests(period!.id, res.constraints, res.examples);
        setText("");
      } else if (res.status === "clarify") {
        setNotice({ kind: "clarify", text: res.question });
      } else {
        setNotice({ kind: "unsupported", text: `아직 지원하지 않는 규칙이에요: ${res.reason}` });
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("INTERNAL", String(e));
      setFailure({ message: errorMessage(err), text: input });
    } finally {
      setLoading(false);
    }
  };

  const onNext = () => {
    if (!period) return;
    if (orphanCount > 0) {
      setBlocked(true);
    } else {
      go({ screen: "period", periodId: period.id, step: 2 });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 병동 규칙은 병동 설정의 탭 안에 놓이므로 페이지 제목을 두지 않는다 */}
      <div className="flex flex-col gap-1">
        {scope === "period" && (
          <h2 tabIndex={-1} data-step-title className={`${ui.cardTitle} outline-none`}>
            {copy.title}
          </h2>
        )}
        <p className="text-sm leading-relaxed text-[#3D3D38]">{copy.description}</p>
      </div>

      <section className={`${ui.card} flex flex-col gap-2.5`}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!loading && !tooLong && text.trim() !== "") void run(text.trim());
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={copy.placeholder}
            aria-label={`${copy.title} 입력`}
            aria-invalid={tooLong || undefined}
            className={`${ui.input} flex-1 ${tooLong ? "border-[#B42318]" : ""}`}
          />
          <button type="submit" disabled={loading || tooLong || text.trim() === ""} className={ui.primary}>
            {loading && <Spinner />}
            {loading ? "읽는 중…" : copy.submit}
          </button>
        </form>
        {copy.examples.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className={ui.help}>예시</span>
            {copy.examples.map((ex) => (
              <button key={ex} type="button" onClick={() => setText(ex)} className={ui.textSm}>
                {ex}
              </button>
            ))}
          </div>
        )}
        {failure && (
          <div role="alert" className="flex items-center gap-2 text-sm text-[#9F1F14]">
            {failure.message}
            <button type="button" disabled={loading} onClick={() => void run(failure.text)} className={ui.textSm}>
              다시 시도
            </button>
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm">
            {notice?.kind === "clarify" && (
              <p className="text-[#1B1B18]">
                {notice.text} <span className="text-xs font-medium text-[#66665E]">내용을 보완해서 다시 입력해 주세요.</span>
              </p>
            )}
            {notice?.kind === "unsupported" && <p className="text-[#7A4506]">{notice.text}</p>}
          </div>
          <span className={`shrink-0 font-mono text-xs ${tooLong ? "text-[#B42318]" : "text-[#9A9A91]"}`}>
            {text.length}/{MAX_TEXT_CHARS}
          </span>
        </div>
      </section>

      {items.length === 0 ? (
        <p className="text-sm text-[#66665E]">{copy.empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {pendingCount >= 2 && (
            <div className="flex justify-end">
              <button type="button" onClick={applyAll} className={ui.secondary}>
                모두 적용
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {items.map(({ id, cfg, entry }) =>
              cfg ? (
                <div key={id} className="flex flex-col gap-3">
                  <ShiftChangeCardView card={cfg} />
                  {ward.pendingRules
                    .filter((c) => cfg.ruleIds.includes(c.id))
                    .map((c) => (
                      <div key={c.id} className="pl-4">
                        <ConstraintCard
                          card={c}
                          pending
                          replaces={findReplaced(ward.rules, c)}
                          withConfig={cfg.change.shift.code}
                        />
                      </div>
                    ))}
                </div>
              ) : (
                renderCard(entry!.card, entry!.pending)
              ),
            )}
          </div>
        </div>
      )}

      {scope === "period" && period && <PeriodRules ward={ward} period={period} />}

      {scope === "ward" && pendingNote && pendingCount > 0 && (
        <p className={ui.help}>적용하지 않은 카드 {pendingCount}개는 근무표에 반영되지 않아요.</p>
      )}

      {scope === "period" && (
      <div className="flex items-center justify-end gap-4">
        <div className="flex items-center gap-3">
          {blocked && orphanCount > 0 && (
            <p role="alert" className={ui.error}>
              명단에 없는 간호사를 가리키는 규칙·요청 {orphanCount}개를 삭제하거나 고친 뒤 넘어갈 수 있어요.
            </p>
          )}
          {pending.length > 0 && (
            <p className={ui.help}>적용하지 않은 카드 {pending.length}개는 근무표에 반영되지 않아요.</p>
          )}
          <button type="button" onClick={onNext} className={ui.primary}>
            다음
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

export function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M7 1.5A5.5 5.5 0 1 1 1.5 7" strokeLinecap="round" />
    </svg>
  );
}

/** 이 근무표에 적용되는 병동 규칙(접힌 목록). [이번 근무표에서만 끄기]는 이 기간의 disabledIds만 바꾼다. */
function PeriodRules({ ward, period }: { ward: Ward; period: WorkPeriod }) {
  const setDisabled = useAppStore((s) => s.setDisabled);
  const periods = useAppStore((s) => s.periods);
  const [open, setOpen] = useState(false);
  // 확정 기간의 snapshot, 이 기간의 수정본(ruleOverrides), 꺼짐(enabled=false)이 반영된 목록
  const rules = (toScheduleRequest(ward, period, periods, today()).constraints ?? []).filter((c) => c.scope === "ward");
  const offCount = rules.filter((c) => c.enabled === false).length;

  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className={ui.cardTitle}>이 근무표에 적용되는 병동 규칙</h3>
          <p className={ui.help}>
            <span className="font-mono">{wardRuleCount(rules)}</span>개
            {offCount > 0 && (
              <>
                {" "}
                · 이번 근무표에서 꺼짐 <span className="font-mono">{offCount}</span>개
              </>
            )}{" "}
            · 규칙 원본은 병동 설정에서 고쳐요.
          </p>
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={ui.textSm}>
          {open ? "접기" : "병동 규칙 보기"}
        </button>
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-4">
          {rules.map((c) => (
            <ConstraintCard
              key={c.id}
              card={c}
              pending={false}
              readOnly
              off={c.enabled === false}
              onToggleOff={(off) => setDisabled(period.id, c.id, off)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
