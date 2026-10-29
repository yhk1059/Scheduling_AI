"use client";

import { useState } from "react";

import type { Priority } from "@/lib/migrate";
import { applyShiftChange, type CardPatch, currentPeriod, type Hardness, isLeaveRule, type ShiftChangeCard, useAppStore } from "@/lib/store";
import type { ConstraintSpec, WardConfig } from "@/lib/types.gen";
import { dayRanges, describeBlock, describeShiftChange, hardnessLabel, presetName } from "@/lib/wording";

import { previewRange } from "./RulesStep";
import { ui } from "./ui";

/** 휴가 모양과 칸 고정은 항상 반드시다(토글을 막는다). */
const alwaysHard = (c: ConstraintSpec) => c.type === "fixed_assignment" || isLeaveRule(c);

// --- 수정 폼: 블록의 수와 날짜만 고친다(셀렉터는 다시 말로 입력) ---

type FieldKind = "int" | "intOptional" | "days" | "code";
interface Field {
  /** params 안의 경로. "days.days"처럼 점으로 잇는다 */
  key: string;
  label: string;
  kind: FieldKind;
}

function fieldsOf(c: ConstraintSpec): Field[] {
  switch (c.type) {
    case "fixed_assignment":
      return [
        { key: "day", label: "날짜", kind: "int" },
        { key: "shift", label: "근무", kind: "code" },
      ];
    case "count":
      return [
        ...(c.params.days?.days ? [{ key: "days.days", label: "날짜 (예: 15-17, 20)", kind: "days" as const }] : []),
        ...(isLeaveRule(c)
          ? []
          : [
              { key: "min", label: "최소", kind: "intOptional" as const },
              { key: "max", label: "최대", kind: "intOptional" as const },
            ]),
      ];
    case "sequence":
      if (c.params.after) return [{ key: "then_off", label: "휴무 일수", kind: "int" }];
      if (!c.params.run) return [];
      return [
        ...(c.params.min_len != null ? [{ key: "min_len", label: "최소 일수", kind: "intOptional" as const }] : []),
        ...(c.params.max_len != null ? [{ key: "max_len", label: "일수", kind: "intOptional" as const }] : []),
      ];
    case "balance":
      return [];
  }
}

type Draft = Record<string, string>;

function getPath(params: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], params);
}

function setPath(params: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = key.split(".");
  if (rest.length === 0) return { ...params, [head]: value };
  return { ...params, [head]: setPath({ ...((params[head] as Record<string, unknown>) ?? {}) }, rest.join("."), value) };
}

function toDraft(c: ConstraintSpec): Draft {
  return Object.fromEntries(
    fieldsOf(c).map(({ key, kind }) => {
      const v = getPath(c.params, key);
      if (kind === "days") return [key, Array.isArray(v) ? dayRanges(v).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ") : ""];
      return [key, v === undefined || v === null ? "" : String(v)];
    }),
  );
}

/** "15-17, 20" → [15,16,17,20]. 범위 밖이거나 형식이 틀리면 null. */
function parseDays(text: string, last: number): number[] | null {
  const days: number[] = [];
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:[-~](\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > last || a > b) return null;
    for (let d = a; d <= b; d++) days.push(d);
  }
  return [...new Set(days)];
}

/** 폼 값을 params로 바꾼다. 잘못된 값이 있으면 오류 문구를 돌려준다. */
function fromDraft(
  c: ConstraintSpec,
  draft: Draft,
  last: number,
  config: WardConfig,
): { params: ConstraintSpec["params"] } | { error: string } {
  let params = { ...(c.params as unknown as Record<string, unknown>) };
  for (const { key, label, kind } of fieldsOf(c)) {
    const v = draft[key].trim();
    if (kind === "int" || kind === "intOptional") {
      if (v === "" && kind === "intOptional") {
        params = setPath(params, key, null);
        continue;
      }
      if (!/^\d+$/.test(v)) return { error: `${label}: 0 이상의 정수를 입력해 주세요` };
      if (key === "day" && (Number(v) < 1 || Number(v) > last)) return { error: `${label}: 1~${last}일 사이로 입력해 주세요` };
      params = setPath(params, key, Number(v));
    } else if (kind === "days") {
      const days = parseDays(v, last);
      if (!days || days.length === 0) return { error: `${label}: 1~${last} 사이 날짜를 쉼표로 구분해 주세요` };
      params = setPath(params, key, days);
    } else {
      if (!config.shifts.some((s) => s.code === v)) return { error: `${label}: 근무를 골라 주세요` };
      params = setPath(params, key, v);
    }
  }
  const pairs: [string, string][] = c.type === "count" ? [["min", "max"]] : c.type === "sequence" && c.params.run ? [["min_len", "max_len"]] : [];
  for (const [lo, hi] of pairs) {
    const a = params[lo] as number | null | undefined;
    const b = params[hi] as number | null | undefined;
    if (a == null && b == null) return { error: "숫자를 하나 이상 입력해 주세요" };
    if (a != null && b != null && a > b) return { error: "최소가 최대보다 커요" };
  }
  return { params: params as unknown as ConstraintSpec["params"] };
}

function FieldInput({
  field,
  value,
  config,
  onChange,
}: {
  field: Field;
  value: string;
  config: WardConfig;
  onChange: (v: string) => void;
}) {
  const control =
    field.kind === "code" ? (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${ui.input} h-8`}>
        {config.shifts.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
    ) : field.kind === "days" ? (
      <input value={value} onChange={(e) => onChange(e.target.value)} className={`${ui.input} h-8 w-48 font-mono`} />
    ) : (
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${ui.input} h-8 w-20 font-mono`}
      />
    );
  return (
    <label className="flex flex-col gap-1">
      <span className={ui.label}>{field.label}</span>
      {control}
    </label>
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
  const removeCard = (id: string) => (isRule ? store.removeRule(id) : store.removeRequest(period!.id, id));

  const refs = card.type === "fixed_assignment" ? [card.params.nurse_id] : (card.params.people?.ids ?? []);
  const orphan = refs.some((id) => !nurses.some((n) => n.id === id));
  const fields = fieldsOf(card);
  const editable = fields.length > 0;
  const lastDay = range.length;
  // 대기 중인 설정 변경(새 코드)도 이름으로 읽히게 합쳐서 문장을 만든다
  const config = isRule ? ward.pendingConfig.reduce((c, x) => applyShiftChange(c, x.change), ward.config) : ward.config;
  const hardness: Hardness = alwaysHard(card) ? "hard" : (card.hardness ?? (card.type === "balance" ? "soft" : "hard"));

  const save = () => {
    if (!draft) return;
    const out = fromDraft(card, draft, lastDay, ward.config);
    if ("error" in out) {
      setError(out.error);
      return;
    }
    updateCard(card.id, { params: out.params });
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
                value={card.priority ?? (card.type === "balance" ? "low" : "normal")}
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
      <p className={`text-sm ${off ? "text-[#66665E]" : "text-[#1B1B18]"}`}>“{card.source_text}”</p>

      {draft ? (
        <div className="flex flex-col gap-2.5 rounded-sm bg-[#F6F6F3] px-2.5 py-2">
          <div className="flex flex-wrap items-end gap-3">
            {fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={draft[f.key]}
                config={ward.config}
                onChange={(v) => setDraft({ ...draft, [f.key]: v })}
              />
            ))}
          </div>
          {error && <p className={ui.error}>{error}</p>}
        </div>
      ) : (
        <p className={`rounded-sm bg-[#F6F6F3] px-2.5 py-2 text-xs ${off ? "text-[#66665E]" : "text-[#3D3D38]"}`}>
          {describeBlock(card, config, nurses, range)}
        </p>
      )}

      {orphan && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-[#A15C07]">
          <WarningIcon />
          명단에 없는 간호사를 가리켜요. 삭제하거나 명단을 고쳐 주세요.
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {off ? (
            <span className={`${ui.badge} bg-[#FDF0DC] text-[#7A4506]`}>이번 근무표에서 꺼짐</span>
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
              <button type="button" onClick={() => removeCard(card.id)} className={ui.danger}>
                삭제
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
