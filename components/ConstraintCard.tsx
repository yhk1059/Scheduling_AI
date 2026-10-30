"use client";

import { useState } from "react";

import type { Priority } from "@/lib/rules";
import {
  applyShiftChange,
  type CardPatch,
  currentPeriod,
  type Hardness,
  isLeaveRule,
  refNurses,
  type ShiftChangeCard,
  useAppStore,
} from "@/lib/store";
import { dayHeader, isWeekendDay, monthDay, type PeriodRange } from "@/lib/period";
import type { ConstraintSpec, Nurse, RuleExample } from "@/lib/types.gen";
import { describeRule, describeShiftChange, hardnessLabel, presetName } from "@/lib/wording";

import RuleText from "./RuleText";
import { previewRange } from "./RulesStep";
import { codeClass } from "./ScheduleStep";
import { ui } from "./ui";

/** 휴가 모양과 칸 고정은 항상 반드시다(토글을 막는다). */
const alwaysHard = (c: ConstraintSpec) => c.type === "fixed_assignment" || isLeaveRule(c);

// --- 수정 폼: 조정 가능한 값(values)만 고친다(식 구조는 다시 말로 입력, ADR-019) ---

interface Field {
  /** 값 이름(Rule.values의 키) */
  key: string;
  label: string;
}

function fieldsOf(c: ConstraintSpec): Field[] {
  if (c.type === "fixed_assignment" || isLeaveRule(c)) return [];
  return Object.entries(c.values ?? {}).map(([key, v]) => ({ key, label: v.label }));
}

type Draft = Record<string, string>;

function toDraft(c: ConstraintSpec): Draft {
  if (c.type !== "rule") return {};
  return Object.fromEntries(Object.entries(c.values ?? {}).map(([key, v]) => [key, String(v.value)]));
}

/** 폼 값을 숫자로 바꾼다. 잘못된 값이 있으면 오류 문구를 돌려준다. */
function fromDraft(c: ConstraintSpec, draft: Draft): { values: Record<string, number> } | { error: string } {
  const values: Record<string, number> = {};
  for (const { key, label } of fieldsOf(c)) {
    const v = draft[key].trim();
    if (!/^\d+(\.\d+)?$/.test(v)) return { error: `${label}: 0 이상의 숫자를 입력해 주세요` };
    values[key] = Number(v);
  }
  if (values.min != null && values.max != null && values.min > values.max) return { error: "최소가 최대보다 커요" };
  return { values };
}

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={ui.label}>{field.label}</span>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={`${ui.input} h-8 w-20 font-mono`} />
    </label>
  );
}

// --- 예시 판정 띠: 서버가 샘플 근무표에서 찾은 위반 사례(ADR-019). 클라이언트는 그리기만 한다 ---

const STRIP_CELL = "inline-flex w-6 h-6 rounded-xs items-center justify-center font-mono";

function ExampleStrip({
  example,
  nurses,
  range,
  holidays,
}: {
  example: RuleExample;
  nurses: Nurse[];
  range: PeriodRange;
  holidays: number[];
}) {
  const nameOf = (id: string) => nurses.find((n) => n.id === id)?.name ?? "간호사";
  const marked = (id: string, d: number) => example.marks.some(([m, md]) => m === id && md === d);
  return (
    <div className="flex flex-col gap-1">
      <table className="border-separate border-spacing-x-0.5 border-spacing-y-0.5">
        <thead>
          <tr>
            <th scope="col" className="sr-only">
              간호사
            </th>
            {example.days.map((d, i) => (
              <th key={d} scope="col" className="w-6 text-center font-mono text-[11px] font-medium whitespace-nowrap text-[#66665E]">
                {i === 0 ? monthDay(range, d) : dayHeader(range, d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {example.nurse_ids.map((id) => (
            <tr key={id}>
              <th scope="row" className="max-w-[96px] truncate pr-1.5 text-left text-xs font-medium text-[#1B1B18]">
                {nameOf(id)}
              </th>
              {example.days.map((d, i) => {
                const code = example.cells[id]?.[i] ?? "";
                const bad = marked(id, d);
                const [m, dom] = monthDay(range, d).split("/");
                return (
                  <td
                    key={d}
                    aria-label={`${nameOf(id)} ${m}월 ${dom}일 ${code}${bad ? " 어긋남" : ""}`}
                    className="p-0"
                  >
                    <span
                      className={`${STRIP_CELL} ${codeClass(code, isWeekendDay(range, d, holidays))} ${bad ? "ring-1 ring-[#B42318]" : ""}`}
                    >
                      {code}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-[#3D3D38]">{example.detail}</p>
    </div>
  );
}

function Examples({
  examples,
  nurses,
  range,
  holidays,
}: {
  examples: RuleExample[];
  nurses: Nurse[];
  range: PeriodRange;
  holidays: number[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className={ui.help}>이런 근무면 이 규칙에 어긋나요</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2.5">
        {examples.map((ex, i) => (
          <ExampleStrip key={i} example={ex} nurses={nurses} range={range} holidays={holidays} />
        ))}
      </div>
    </div>
  );
}

// --- 아이콘 ---

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M7 1.8 12.8 12H1.2Z" strokeLinejoin="round" />
      <path d="M7 5.6v3M7 10.2v.1" strokeLinecap="round" />
    </svg>
  );
}

// --- 카드 ---

function HardnessToggle({ value, disabled, onChange }: { value: Hardness; disabled: boolean; onChange: (h: Hardness) => void }) {
  return (
    <div
      role="group"
      aria-label="반드시/가능하면"
      title={disabled ? "휴가와 고정 근무는 항상 반드시 지켜요" : undefined}
      className="inline-flex overflow-hidden rounded-md border border-[#C9C9C1]"
    >
      {(["hard", "soft"] as const).map((h) => (
        <button
          key={h}
          type="button"
          disabled={disabled}
          aria-pressed={value === h}
          onClick={() => onChange(h)}
          className="h-7 bg-white px-3 text-xs font-medium text-[#66665E] disabled:cursor-not-allowed aria-pressed:bg-[#1B1B18] aria-pressed:text-white"
        >
          {hardnessLabel(h)}
        </button>
      ))}
    </div>
  );
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "high", label: "높음" },
  { value: "normal", label: "보통" },
  { value: "low", label: "낮음" },
];

/** '가능하면' 규칙의 중요도(높음·보통·낮음). */
function PrioritySelect({ value, disabled, onChange }: { value: Priority; disabled: boolean; onChange: (p: Priority) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className={ui.label}>중요도</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Priority)}
        className={`${ui.input} h-7 px-2 text-xs`}
      >
        {PRIORITIES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 설정 변경 카드(근무 형태). [적용]하면 근무 형태가 바뀌고, 삭제하면 딸린 규칙 카드도 지운다. */
export function ShiftChangeCardView({ card }: { card: ShiftChangeCard }) {
  const config = useAppStore((s) => s.ward?.config);
  if (!config) return null;
  const store = useAppStore.getState();
  return (
    <article className="flex flex-col gap-2.5 rounded-lg border border-[#C9C9C1] bg-white px-[18px] py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-[#1B1B18]">근무 형태</h3>
        <span className={`${ui.badge} bg-[#EFEFEB] text-[#3D3D38]`}>근무 형태</span>
      </div>
      {card.source_text && <p className="text-sm text-[#1B1B18]">“{card.source_text}”</p>}
      <p className="rounded-sm bg-[#F6F6F3] px-2.5 py-2 text-xs text-[#3D3D38]">{describeShiftChange(card.change, config)}</p>
      <div className="flex items-center justify-between gap-3">
        <span className={`${ui.badge} bg-[#FDF0DC] text-[#7A4506]`}>적용 대기</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => store.removeRule(card.id)} className={ui.danger}>
            삭제
          </button>
          <button type="button" onClick={() => store.applyRule(card.id)} className={ui.primarySm}>
            적용
          </button>
        </div>
      </div>
    </article>
  );
}

export default function ConstraintCard({
  card,
  pending,
  replaces,
  onApplied,
  busy = false,
  off = false,
  onToggleOff,
  readOnly = false,
  withConfig,
}: {
  card: ConstraintSpec;
  pending: boolean;
  /** 적용하면 대체될 기존 제약 */
  replaces?: ConstraintSpec;
  /** [적용] 직후 호출(③ 운영 중 변경의 재풀이) */
  onApplied?: () => void;
  /** 요청 중이면 [적용]을 막는다 */
  busy?: boolean;
  /** 이 기간에 꺼져 있는지(disabledIds) */
  off?: boolean;
  /** 주면 [이번 근무표에서만 끄기]/[다시 켜기]를 둔다. 원본은 바꾸지 않는다 */
  onToggleOff?: (off: boolean) => void;
  /** 기간 화면의 병동 규칙: 수정·삭제·hard/soft 변경 없이 끄고 켜기만 한다 */
  readOnly?: boolean;
  /** 딸린 카드: [적용]하면 함께 적용되는 설정 변경 카드의 근무 코드 */
  withConfig?: string;
}) {
  const ward = useAppStore((s) => s.ward);
  const period = useAppStore(currentPeriod);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);

  // 병동 규칙은 병동에, 요청은 지금 기간에 반영한다
  const isRule = card.scope === "ward";
  if (!ward || (!isRule && !period)) return null;
  // 기간이 아직 없으면(병동 설정) 다음 기간 범위로 날짜를 보여 준다
  const range = period ?? previewRange(ward.unit);
  const nurses = ward.nurses.filter((n) => n.active);
  const store = useAppStore.getState();
  const applyCard = (id: string) => (isRule ? store.applyRule(id) : store.applyRequest(period!.id, id));
  const updateCard = (id: string, patch: CardPatch) =>
    isRule ? store.updateRule(id, patch) : store.updateRequest(period!.id, id, patch);
  const setValue = (id: string, name: string, value: number) =>
    isRule ? store.setRuleValue(id, name, value) : store.setRequestValue(period!.id, id, name, value);
  const removeCard = (id: string) => (isRule ? store.removeRule(id) : store.removeRequest(period!.id, id));
  // 기본 규칙(필요 인원·나이트 전담)은 [삭제] 대신 [끄기]다. 병동 규칙 원본에서 끈 것(enabled=false)
  const isDefault = card.type === "rule" && card.default === true;
  const wardOff = isDefault && !pending && !readOnly && card.enabled === false;
  const dim = off || wardOff;

  const orphan = refNurses(card).some((id) => !nurses.some((n) => n.id === id));
  const fields = fieldsOf(card);
  const editable = fields.length > 0;
  // 대기 중인 설정 변경(새 코드)도 이름으로 읽히게 합쳐서 문장을 만든다
  const config = isRule ? ward.pendingConfig.reduce((c, x) => applyShiftChange(c, x.change), ward.config) : ward.config;
  const isBalance = card.type === "rule" && card.body.kind === "balance";
  const examples = (isRule ? ward.examples : period?.examples)?.[card.id] ?? [];
  const holidays = isRule ? [] : (period?.holidays ?? []);
  const hardness: Hardness = alwaysHard(card) ? "hard" : (card.hardness ?? (isBalance ? "soft" : "hard"));

  const save = () => {
    if (!draft) return;
    const out = fromDraft(card, draft);
    if ("error" in out) {
      setError(out.error);
      return;
    }
    for (const [name, value] of Object.entries(out.values)) setValue(card.id, name, value);
    setDraft(null);
    setError(null);
  };

  return (
    <article
      className={`flex flex-col gap-2.5 rounded-lg border bg-white px-[18px] py-4 ${pending ? "border-[#C9C9C1]" : "border-[#E2E2DC]"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-[#1B1B18]">{presetName(card)}</h3>
        {/* 휴가 카드는 항상 반드시라 토글을 두지 않는다 */}
        {!isLeaveRule(card) && (
          <div className="flex items-center gap-2">
            {hardness === "soft" && card.type !== "fixed_assignment" && (
              <PrioritySelect
                value={card.priority ?? (isBalance ? "low" : "normal")}
                disabled={readOnly}
                onChange={(priority) => updateCard(card.id, { priority })}
              />
            )}
            <HardnessToggle
              value={hardness}
              disabled={readOnly || alwaysHard(card)}
              onChange={(hardness) => updateCard(card.id, { hardness })}
            />
          </div>
        )}
      </div>
      <p className={`text-sm ${dim ? "text-[#66665E]" : "text-[#1B1B18]"}`}>“{card.source_text}”</p>

      <p className={`rounded-sm bg-[#F6F6F3] px-2.5 py-2 text-xs ${dim ? "text-[#66665E]" : "text-[#3D3D38]"}`}>
        <RuleText sentence={describeRule(card, config, nurses, range)} />
      </p>

      {draft && (
        <div className="flex flex-col gap-2.5 rounded-sm border border-[#E2E2DC] px-2.5 py-2">
          <div className="flex flex-wrap items-end gap-3">
            {fields.map((f) => (
              <FieldInput key={f.key} field={f} value={draft[f.key]} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />
            ))}
          </div>
          {error && <p className={ui.error}>{error}</p>}
          <p className={ui.help}>바꾸려면 말로 다시 적어 주세요</p>
        </div>
      )}

      {examples.length > 0 &&
        (pending ? (
          <Examples examples={examples} nurses={ward.nurses} range={range} holidays={holidays} />
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={showExamples}
              onClick={() => setShowExamples(!showExamples)}
              className={`${ui.textSm} self-start`}
            >
              예시 보기
            </button>
            {showExamples && <Examples examples={examples} nurses={ward.nurses} range={range} holidays={holidays} />}
          </div>
        ))}

      {orphan && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-[#A15C07]">
          <WarningIcon />
          명단에 없는 간호사를 가리켜요. 삭제하거나 명단을 고쳐 주세요.
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isDefault && <span className={`${ui.badge} bg-[#EFEFEB] text-[#3D3D38]`}>기본</span>}
          {off ? (
            <span className={`${ui.badge} bg-[#FDF0DC] text-[#7A4506]`}>이번 근무표에서 꺼짐</span>
          ) : wardOff ? (
            <span className={`${ui.badge} bg-[#EFEFEB] text-[#66665E]`}>꺼짐</span>
          ) : pending ? (
            <span className={`${ui.badge} bg-[#FDF0DC] text-[#7A4506]`}>적용 대기</span>
          ) : (
            <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>적용됨</span>
          )}
          {pending && replaces && (
            <span className="text-xs font-medium text-[#66665E]" title={`“${replaces.source_text}”`}>
              기존 규칙 대체
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {draft ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
                className={ui.textSm}
              >
                취소
              </button>
              <button type="button" onClick={save} className={ui.primarySm}>
                저장
              </button>
            </>
          ) : pending ? (
            <>
              <button type="button" onClick={() => removeCard(card.id)} className={ui.danger}>
                삭제
              </button>
              {withConfig && (
                <span className="ml-2 text-xs font-medium text-[#66665E]">
                  근무 코드 <span className="font-mono">{withConfig}</span> 추가가 함께 적용돼요
                </span>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  applyCard(card.id);
                  onApplied?.();
                }}
                className={ui.primarySm}
              >
                적용
              </button>
            </>
          ) : readOnly ? (
            onToggleOff && (
              <button type="button" disabled={busy} onClick={() => onToggleOff(!off)} className={ui.textSm}>
                {off ? "다시 켜기" : "이번 근무표에서만 끄기"}
              </button>
            )
          ) : (
            <>
              {off && onToggleOff && (
                <button type="button" disabled={busy} onClick={() => onToggleOff(false)} className={ui.textSm}>
                  다시 켜기
                </button>
              )}
              {editable && (
                <button type="button" onClick={() => setDraft(toDraft(card))} className={ui.textSm}>
                  수정
                </button>
              )}
              {isDefault ? (
                <button
                  type="button"
                  onClick={() => (wardOff ? store.enableRule(card.id) : removeCard(card.id))}
                  className={ui.textSm}
                >
                  {wardOff ? "다시 켜기" : "끄기"}
                </button>
              ) : (
                <button type="button" onClick={() => removeCard(card.id)} className={ui.danger}>
                  삭제
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
