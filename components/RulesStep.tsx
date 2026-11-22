"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";

import { ApiError, errorMessage, translate } from "@/lib/api";
import { findCoverageConflict } from "@/lib/coverage-conflict";
import { DEMO_SENTENCES, demoCards } from "@/lib/demo";
import { DEMO_DOC } from "@/lib/demo-doc";
import { describeRule, describeShiftChange, hardnessLabel, presetName } from "@/lib/wording";
import { firstPeriodStart, periodFrom, type PeriodRange, type PeriodUnit } from "@/lib/period";
import {
  applyShiftChange,
  cardsInOrder,
  COVERAGE_SOURCE_TEXT,
  currentPeriod,
  findReplaced,
  isLeaveRule,
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
    description: "근무조, 필요 인원, 지켜야 할 규칙 모두 한 곳에서요.",
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
 * summary, afterInput, afterList: 작업 영역에 함께 놓을 요약과 폼.
 */
export default function RulesStep({
  scope,
  pendingNote = true,
  step = false,
  summary,
  afterInput,
  afterList,
}: {
  scope: "shop" | "period";
  pendingNote?: boolean;
  step?: boolean;
  summary?: ReactNode;
  afterInput?: ReactNode;
  afterList?: ReactNode;
}) {
  const copy = COPY[scope];
  const shop = useAppStore((s) => s.shop);
  const period = useAppStore(currentPeriod);
  const addPendingRules = useAppStore((s) => s.addPendingRules);
  const addPendingRequests = useAppStore((s) => s.addPendingRequests);
  const setDisabled = useAppStore((s) => s.setDisabled);
  const demo = useAppStore((s) => s.demo);

  const detailId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wide = useWide();
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

  // 체험: 예시 문장이면 저장된 카드를 꺼내고 LLM은 부르지 않는다(ADR-025)
  const runDemo = (input: string) => {
    setNotice(null);
    const cards = demoCards(DEMO_DOC, input);
    if (!cards) {
      setNotice({ kind: "unsupported", text: "체험에서는 아래 예시 문장만 카드로 바꿔 볼 수 있어요. 내 매장에서는 어떤 문장이든 돼요." });
      return;
    }
    const known = new Set([...shop.pendingRules, ...shop.rules].map((c) => c.id));
    const fresh = cards.filter((c) => !known.has(c.id));
    if (!fresh.length) {
      setNotice({ kind: "unsupported", text: "이 문장은 이미 카드로 만들었어요." });
      return;
    }
    addPendingRules(fresh);
    setSelectedId(fresh[0].id);
    setText("");
  };

  const run = async (input: string) => {
    if (demo) return runDemo(input);
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
        if (scope === "shop") {
          addPendingRules(res.constraints, res.config_changes ?? [], res.examples);
          setSelectedId(useAppStore.getState().shop?.cardOrder?.[0] ?? null);
        } else addPendingRequests(period!.id, res.constraints, res.examples);
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

  // 체험의 예외 입력은 저장된 카드가 없어 입력 바 대신 안내를 둔다. 매장 조건은 예시 문장만 카드로 바꾼다(LLM을 부르지 않는다)
  const demoShop = demo && scope === "shop";
  const examples: readonly string[] = demoShop ? DEMO_SENTENCES : copy.examples;
  const input =
    demo && !demoShop ? (
      <DemoInputNote />
    ) : (
    <>
      <div className="flex flex-col gap-1">
        <p className={ui.cardTitle}>{copy.prompt}</p>
        <p className="text-[13px] text-[#4B4F57]">
          {demoShop ? "체험에서는 아래 예시 문장을 눌러 [규칙 만들기]를 해 보세요. 카드는 [적용]을 눌러야 반영돼요." : copy.description}
        </p>
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
      {examples.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={ui.help}>예시</span>
          {examples.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className={ui.chip}>
              {ex}
            </button>
          ))}
        </div>
      )}
      {failure && (
        <div role="alert" className="flex items-center gap-2 text-sm text-[#B42318]">
          {failure.message}
          <button type="button" disabled={loading} onClick={() => void run(failure.text)} className={ui.textSm}>
            다시 시도
          </button>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          {notice?.kind === "clarify" && (
            <p className="text-[#111214]">
              {notice.text} <span className="text-xs font-medium text-[#6B6F78]">내용을 보완해서 다시 입력해 주세요.</span>
            </p>
          )}
          {notice?.kind === "unsupported" && <p className="text-[#B93815]">{notice.text}</p>}
        </div>
        <span className={`shrink-0 font-mono text-xs ${tooLong ? "text-[#B42318]" : "text-[#9499A2]"}`}>
          {text.length}/{MAX_TEXT_CHARS}
        </span>
      </div>
    </>
  );

  const renderItem = ({ id, cfg, entry }: (typeof items)[number]) =>
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
    );

  const groups = [
    { title: "확인할 제안", rows: items.filter((item) => item.cfg || item.entry?.pending) },
    { title: "적용됨", rows: items.filter((item) => item.entry && !item.entry.pending) },
  ];
  const selected = items.find((item) => item.id === selectedId) ?? groups[0].rows[0] ?? groups[1].rows[0];
  const draftConfig = configCards.reduce((current, item) => applyShiftChange(current, item.change), shop.config);
  const activeEmployees = shop.employees.filter((n) => n.active);
  const ruleList = step && selected && (
    <div className="flex min-w-0 flex-col gap-5">
      {groups.map(({ title, rows }, group) => (group === 0 && rows.length === 0 ? null : (
        <section key={title} aria-label={title} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <h3 className={ui.cardTitle}>
              {title} <span className={ui.help}>{rows.length}</span>
              {group === 1 && summarized.length > 0 && (
                <span className={`${ui.help} ml-1.5 font-normal`}>· 필요 인원 규칙 {summarized.length}개는 위 표에 있어요</span>
              )}
            </h3>
            {group === 0 && pendingCount >= 2 && (
              <button type="button" onClick={applyAll} className={ui.secondarySm}>모두 적용</button>
            )}
          </div>
          <ul className="flex flex-col gap-1.5">
            {rows.map(({ id, cfg, entry }, i) => {
              const card = entry?.card;
              // 한 문장에서 나온 규칙이 둘 이상이면 원문 아래에 묶어 보인다
              const quote = card?.source_text && card.source_text !== COVERAGE_SOURCE_TEXT ? card.source_text : null;
              const siblings = quote ? rows.filter((r) => r.entry?.card.source_text === quote).length : 0;
              const grouped = siblings > 1;
              const firstOfGroup = grouped && rows[i - 1]?.entry?.card.source_text !== quote;
              const hardness = card && (card.type === "fixed_assignment" || isLeaveRule(card)
                ? "hard"
                : card.hardness ?? (card.body.kind === "balance" ? "soft" : "hard"));
              const name = card ? presetName(card) : "근무조";
              const reading = card
                ? describeRule(card, draftConfig, activeEmployees, stepPeriod ?? previewRange(shop.unit)).text
                : describeShiftChange(cfg!.change, shop.config);
              const off = card && (card.enabled === false || stepPeriod?.disabledIds.includes(id));
              return (
                <li key={id} className={grouped ? "border-l-2 border-[#F4C0D1] pl-2.5" : undefined}>
                  {firstOfGroup && <p className="mb-1 truncate text-xs text-[#6B6F78]" title={quote!}>“{quote}”</p>}
                  <button
                    type="button"
                    aria-controls={detailId}
                    aria-pressed={id === selected.id}
                    onClick={() => setSelectedId((cur) => (!wide && cur === id ? null : id))}
                    className={`grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-[#EDEDEA] px-2 py-2.5 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-[#C4247C] aria-pressed:border-[#C4247C] aria-pressed:bg-[#FDEAF4] sm:px-3 ${group === 0 ? "bg-[#FFF6FA]" : "bg-white"}`}
                  >
                    <span className="max-w-24 truncate rounded-full bg-[#F5F5F4] px-2 py-0.5 text-[11px] font-semibold text-[#4B4F57] sm:max-w-32" title={name}>{name}</span>
                    <span className="truncate font-medium text-[#111214]" title={reading}>{reading}</span>
                    <span className={`${ui.badge} ${hardness === "hard" && !off ? "bg-[#111214] text-white" : ui.badgeTone.base}`}>
                      {off ? "꺼짐 · " : ""}{hardness ? hardnessLabel(hardness) : "설정"}
                    </span>
                  </button>
                  {/* 좁은 화면: 고른 카드 바로 아래에 상세를 펼친다(옆 칸이 없어 목록 끝으로 밀리지 않게) */}
                  {!wide && selectedId === id && (
                    <section id={detailId} aria-label="규칙 상세" className="mt-2">
                      {renderItem(selected)}
                    </section>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )))}
    </div>
  );

  const list =
    items.length === 0 ? (
      copy.empty && <p className="text-sm text-[#6B6F78]">{copy.empty}</p>
    ) : (
      <div className="flex flex-col gap-3">
        {pendingCount >= 2 && (
          <div className="flex justify-end">
            <button type="button" onClick={applyAll} className={ui.secondary}>
              모두 적용
            </button>
          </div>
        )}
        <div className={scope === "period" ? "flex flex-col gap-3" : "grid grid-cols-1 gap-4 md:grid-cols-2"}>
          {items.map(renderItem)}
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
      <section className={`${ui.panel} grid grid-cols-1 gap-6 lg:grid-cols-[7fr_5fr]`}>
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

      <div className={step && selected ? ui.workLayout : "flex min-w-0 flex-col gap-5"}>
        <div className="flex min-w-0 flex-col gap-5">
          {summary}
          <section className={`${ui.panel} flex min-w-0 flex-col gap-3`}>{input}</section>
          {afterInput}
          {step && selected ? ruleList : list}
          {note}
          {afterList}
        </div>
        {step && selected && wide && (
          <aside id={detailId} aria-label="규칙 상세" className={ui.workAside}>
            {renderItem(selected)}
          </aside>
        )}
      </div>
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
        <p className="text-[13px] text-[#4B4F57]">
          카드를 누르면 이번 근무표에서 끄거나 숫자를 바꿀 수 있어요. 그다음 ③에서 근무표를 만들어 보세요. 내 매장에서는 문장을 적으면 카드가 돼요.
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

/** lg(1024px) 이상이면 true. 규칙 상세를 옆 칸(넓음)에 둘지 카드 아래(좁음)에 둘지 정한다. */
const WIDE_QUERY = "(min-width: 1024px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(WIDE_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}
