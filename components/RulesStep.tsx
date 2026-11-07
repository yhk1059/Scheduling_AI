"use client";

import { useState, type ReactNode } from "react";

import { ApiError, errorMessage, translate } from "@/lib/api";
import { findCoverageConflict } from "@/lib/coverage-conflict";
import { firstPeriodStart, periodFrom, type PeriodRange, type PeriodUnit } from "@/lib/period";
import {
  cardsInOrder,
  currentPeriod,
  findReplaced,
  liveShopRules,
  summarizedCoverageIds,
  toScheduleRequest,
  useAppStore,
} from "@/lib/store";
import type { ConstraintSpec } from "@/lib/types.gen";

import { LOGIN_ERROR } from "./Account";
import ConstraintCard, { ShiftChangeCardView } from "./ConstraintCard";
import { useStartOwnShop } from "./Demo";
import { ui } from "./ui";
import { Mark } from "./Wordmark";

const MAX_TEXT_CHARS = 1000; // backend/domain/constants.py MAX_TEXT_CHARS

const COPY = {
  shop: {
    title: "매장 조건",
    noun: "규칙",
    prompt: "매장 조건을 말로 적어 주세요",
    description: "근무 형태, 필요 인원, 지켜야 할 규칙 모두 한 곳에서요.",
    placeholder: "예: 마감 다음 날 오픈은 안 되게",
    submit: "규칙 만들기",
    empty: "아직 규칙이 없어요.",
    examples: ["평일 오픈 2명, 주말은 3명", "12시부터 15시까지는 최소 3명", "마감 다음 날 오픈은 안 되게"],
  },
  period: {
    title: "예외",
    noun: "요청",
    prompt: "이번 근무표에만 적용할 예외가 있나요?",
    description: "휴가, 희망, 기피를 말로 적어요. 가능 시간에 이미 있는 내용은 다시 적지 않아도 돼요.",
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

/** 기간이 아직 없을 때 매장 규칙 해석·표시에 쓰는 다음 기간 범위. */
export function previewRange(unit: PeriodUnit): PeriodRange {
  return periodFrom(unit, firstPeriodStart(unit, today()));
}

type Notice = { kind: "clarify" | "unsupported"; text: string } | null;

/**
 * 말로 적는 입력 바와 카드 목록. scope shop은 매장 조건(작성 ②, 매장 설정), scope period는 이번 근무표 예외(작성 ② 아래, 패널 안 두 열).
 * pendingNote=false: 화면이 대기 카드 안내를 버튼 옆에 따로 둘 때.
 * step: 단계 화면. 제목을 두고, 요약표에 든 필요 인원은 카드에서 빼고, 이 근무표의 꺼짐과 수정본을 보여 준다.
 * summary, afterInput: 입력 바 위·아래에 놓을 영역.
 */
export default function RulesStep({
  scope,
  pendingNote = true,
  step = false,
  summary,
  afterInput,
}: {
  scope: "shop" | "period";
  pendingNote?: boolean;
  step?: boolean;
  summary?: ReactNode;
  afterInput?: ReactNode;
}) {
  const copy = COPY[scope];
  const shop = useAppStore((s) => s.shop);
  const period = useAppStore(currentPeriod);
  const addPendingRules = useAppStore((s) => s.addPendingRules);
  const addPendingRequests = useAppStore((s) => s.addPendingRequests);
  const setDisabled = useAppStore((s) => s.setDisabled);
  const demo = useAppStore((s) => s.demo);

  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [failure, setFailure] = useState<{ message: string; text: string } | null>(null);

  if (!shop || (scope === "period" && !period)) return null;
  const pending = scope === "shop" ? shop.pendingRules : period!.pendingRequests;
  // 작성 ②의 매장 조건: 이 근무표의 꺼짐과 수정본을 반영해 보여 준다
  const stepPeriod = step && scope === "shop" ? period : null;
  const summarized = stepPeriod ? summarizedCoverageIds(shop, stepPeriod) : [];
  const applied =
    scope === "period"
      ? period!.requests
      : shop.rules.filter((c) => !summarized.includes(c.id)).map((c) => stepPeriod?.ruleOverrides[c.id] ?? c);
  const cards = cardsInOrder(pending, applied, scope === "shop" ? shop.cardOrder : period!.cardOrder);
  const tooLong = text.length > MAX_TEXT_CHARS;

  // 설정 변경 카드와 딸린 카드(매장 규칙에만 있다). 딸린 카드는 설정 카드 바로 아래에 둔다
  const configCards = scope === "shop" ? shop.pendingConfig : [];
  const attached = new Map(configCards.flatMap((cfg) => cfg.ruleIds.map((id) => [id, cfg.change.shift.code] as const)));
  const pendingCount = pending.length + configCards.length;
  const order = shop.cardOrder ?? [];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  // 기본 규칙(필요 인원)은 맨 위에 둔다
  const isDefault = (c: ConstraintSpec | null) => c?.type === "rule" && c.default === true;
  const items = [
    ...configCards.map((cfg) => ({ id: cfg.id, cfg, entry: null })),
    ...cards.filter(({ card }) => !attached.has(card.id)).map((entry) => ({ id: entry.card.id, cfg: null, entry })),
  ]
    .map((x, i) => ({ x, i }))
    .sort(
      (a, b) =>
        Number(isDefault(b.x.entry?.card ?? null)) - Number(isDefault(a.x.entry?.card ?? null)) ||
        rank(a.x.id) - rank(b.x.id) ||
        a.i - b.i,
    )
    .map(({ x }) => x);

  // 대기 매장 규칙 카드가 적용되면 함께 지킬 수 없는 기존 필요 인원 규칙. 대체될 규칙은 [기존 규칙 대체]로 안내하므로 뺀다
  const conflictOf = (c: ConstraintSpec) => {
    if (scope !== "shop") return undefined;
    const replaced = findReplaced(shop.rules, c);
    const live = stepPeriod ? liveShopRules(shop, stepPeriod) : shop.rules.filter((r) => r.enabled !== false);
    return (
      findCoverageConflict(
        live.filter((r) => r.id !== replaced?.id),
        c,
        stepPeriod ?? previewRange(shop.unit),
        stepPeriod?.holidays ?? [],
      ) ?? undefined
    );
  };

  const renderCard = (c: ConstraintSpec, isPending: boolean) =>
    isPending ? (
      <ConstraintCard
        key={c.id}
        card={c}
        pending
        replaces={findReplaced(scope === "shop" ? shop.rules : period!.requests, c)}
        conflict={conflictOf(c)}
        compact={scope === "period"}
      />
    ) : scope === "period" ? (
      <ConstraintCard
        key={c.id}
        card={c}
        pending={false}
        off={period!.disabledIds.includes(c.id)}
        onToggleOff={(off) => setDisabled(period!.id, c.id, off)}
        compact
      />
    ) : stepPeriod ? (
      <ConstraintCard
        key={c.id}
        card={c}
        pending={false}
        // 이 근무표에서 바꾼 규칙은 원본을 고쳐도 반영되지 않아 끄고 켜기만 한다
        readOnly={c.id in stepPeriod.ruleOverrides}
        off={stepPeriod.disabledIds.includes(c.id)}
        onToggleOff={(off) => setDisabled(stepPeriod.id, c.id, off)}
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
      if (scope === "shop") store.applyRule(card.id);
      else store.applyRequest(period!.id, card.id);
    }
  };

  const run = async (input: string) => {
    setLoading(true);
    setNotice(null);
    setFailure(null);
    try {
      // 기간이 없으면(매장 설정) 활성 명단과 다음 기간 범위로 해석한다
      const { employees, period: range, holidays } = period
        ? toScheduleRequest(shop, period, useAppStore.getState().periods, today())
        : {
            employees: shop.employees.filter((n) => n.active).map(({ id, name, tags }) => ({ id, name, tags })),
            period: previewRange(shop.unit),
            holidays: [],
          };
      const res = await translate({
        text: input,
        scope,
        context: { config: shop.config, employees, period: range, holidays, today: today() },
      });
      if (res.status === "ok") {
        if (scope === "shop") addPendingRules(res.constraints, res.config_changes ?? [], res.examples);
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

  // 체험에서는 LLM을 부르지 않으므로 입력 바 대신 안내를 둔다
  const input = demo ? (
    <DemoInputNote />
  ) : (
    <>
      <div className="flex flex-col gap-1">
        <p className={ui.cardTitle}>{copy.prompt}</p>
        <p className="text-[13px] text-[#3D3D38]">{copy.description}</p>
      </div>
      <form
        className={`${ui.bar} ${tooLong ? "border-[#B42318]!" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!loading && !tooLong && text.trim() !== "") void run(text.trim());
        }}
      >
        <Mark size={18} />
        <label className="flex min-w-0 flex-1">
          <span className="sr-only">{copy.title} 입력</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={copy.placeholder}
            aria-invalid={tooLong || undefined}
            className={ui.barInput}
          />
        </label>
        <button type="submit" disabled={loading || tooLong || text.trim() === ""} className={ui.primaryBar}>
          {loading && <Spinner />}
          {loading ? "읽는 중…" : copy.submit}
        </button>
      </form>
      {copy.examples.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={ui.help}>예시</span>
          {copy.examples.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className={ui.chip}>
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
    </>
  );

  const list =
    items.length === 0 ? (
      copy.empty && <p className="text-sm text-[#66665E]">{copy.empty}</p>
    ) : (
      <div className="flex flex-col gap-3">
        {pendingCount >= 2 && (
          <div className="flex justify-end">
            <button type="button" onClick={applyAll} className={ui.secondary}>
              모두 적용
            </button>
          </div>
        )}
        <div className={scope === "period" ? "flex flex-col gap-3" : "grid grid-cols-2 gap-4"}>
          {items.map(({ id, cfg, entry }) =>
            cfg ? (
              <div key={id} className="flex flex-col gap-3">
                <ShiftChangeCardView card={cfg} />
                {shop.pendingRules
                  .filter((c) => cfg.ruleIds.includes(c.id))
                  .map((c) => (
                    <div key={c.id} className="pl-4">
                      <ConstraintCard
                        card={c}
                        pending
                        replaces={findReplaced(shop.rules, c)}
                        conflict={conflictOf(c)}
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
    );

  const note = pendingNote && pendingCount > 0 && (
    <p className={ui.help}>
      적용하지 않은 {copy.noun} {pendingCount}개는 빠져요
    </p>
  );

  // ② 아래 예외 입력: 왼쪽 입력, 오른쪽 요청 카드를 패널 하나에 둔다
  if (scope === "period") {
    return (
      <section className={`${ui.panel} grid grid-cols-[7fr_5fr] gap-6`}>
        <div className="flex min-w-0 flex-col gap-3">{input}</div>
        <div className="flex min-w-0 flex-col gap-3">
          {list}
          {note}
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 매장 설정의 탭 안에는 페이지 제목을 두지 않는다 */}
      {step && (
        <h2 tabIndex={-1} data-step-title className={`${ui.cardTitle} outline-none`}>
          {copy.title}
        </h2>
      )}

      {summary}

      <section className={`${ui.panel} flex flex-col gap-3`}>{input}</section>

      {afterInput}

      {list}

      {note}
    </div>
  );
}

/** 체험의 입력 바 자리. 카드와 숫자 폼은 그대로 쓴다. */
function DemoInputNote() {
  const { busy, error, start, label } = useStartOwnShop();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <p className={ui.cardTitle}>체험에서는 말로 적을 수 없어요</p>
        <p className="text-[13px] text-[#3D3D38]">
          카드를 끄고 켜거나 숫자를 바꾸고, ③에서 근무표를 만들어 보세요. 내 매장에서는 문장을 적으면 카드가 돼요.
        </p>
        {error && (
          <p role="alert" className={ui.error}>
            {LOGIN_ERROR}
          </p>
        )}
      </div>
      <button type="button" onClick={() => void start()} disabled={busy} className={`${ui.textSm} shrink-0`}>
        {label}
      </button>
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
