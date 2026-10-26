"use client";

import { useState } from "react";

import { type Hardness, useAppStore } from "@/lib/store";
import type { ConstraintSpec, Nurse, Period } from "@/lib/types.gen";

import { ui } from "./ui";

export const TEMPLATE_NAMES: Record<ConstraintSpec["type"], string> = {
  daily_coverage: "일일 최소/최대 인원",
  forbidden_sequence: "금지 순서",
  max_consecutive_work: "최대 연속 근무",
  max_consecutive_nights: "최대 연속 나이트",
  min_days_off: "최소 오프 일수",
  off_after_night_block: "나이트 후 오프 (N-OFF)",
  skill_mix: "숙련도 믹스",
  leave: "휴가",
  fixed_assignment: "고정 배정",
  shift_preference: "희망/기피 근무",
  night_fairness: "나이트 공정성",
  weekend_fairness: "주말·공휴일 공정성",
};

const ALWAYS_HARD: ConstraintSpec["type"][] = ["leave", "fixed_assignment"];

// --- 해석 결과 한 줄 ---

/** [15,16,17,20] → [[15,17],[20,20]] */
function dayRanges(days: number[]): [number, number][] {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const d of sorted) {
    const last = out.at(-1);
    if (last && last[1] === d - 1) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

/** [15,16,17,20] → "11/15~11/17, 11/20" */
function formatDays(days: number[], month: number): string {
  return dayRanges(days)
    .map(([a, b]) => (a === b ? `${month}/${a}` : `${month}/${a}~${month}/${b}`))
    .join(", ");
}

function nurseLabel(id: string, nurses: Nurse[]): string {
  const n = nurses.find((n) => n.id === id);
  return n ? `${id} ${n.name}` : `${id} (명단에 없음)`;
}

export function describeParams(c: ConstraintSpec, nurses: Nurse[], period: Period): string {
  const m = period.month;
  switch (c.type) {
    case "daily_coverage":
      return `${c.params.shift} · ${c.params.day_kind === "weekday" ? "평일" : "주말·공휴일"} · ${c.params.min}~${c.params.max}명`;
    case "forbidden_sequence":
      return `${c.params.first} → ${c.params.second} 금지`;
    case "max_consecutive_work":
      return `연속 근무 ≤ ${c.params.days}일`;
    case "max_consecutive_nights":
      return `연속 N ≤ ${c.params.days}일`;
    case "min_days_off":
      return `오프 ≥ ${c.params.days}일`;
    case "off_after_night_block":
      return `N 뒤 O ${c.params.days}일`;
    case "skill_mix":
      return `${c.params.shift} · ${c.params.min_years}년차 이상 ≥ ${c.params.min_count}명`;
    case "leave":
      return `${nurseLabel(c.params.nurse_id, nurses)} · ${formatDays(c.params.days, m)} · O`;
    case "fixed_assignment":
      return `${nurseLabel(c.params.nurse_id, nurses)} · ${m}/${c.params.day} · ${c.params.shift}`;
    case "shift_preference": {
      const p = c.params;
      const when = p.days?.length ? formatDays(p.days, m) : p.weekends_only ? "주말·공휴일" : "한 달 전체";
      const scope = p.days?.length && p.weekends_only ? `${when} 중 주말·공휴일` : when;
      return `${nurseLabel(p.nurse_id, nurses)} · ${scope} · ${p.shift} ${p.prefer ? "희망" : "기피"}`;
    }
    case "night_fairness":
      return "나이트 개수 편차 최소화";
    case "weekend_fairness":
      return "주말·공휴일 근무 편차 최소화";
  }
}

// --- 수정 폼 ---

type FieldKind = "int" | "shift" | "shiftDEN" | "dayKind" | "days" | "daysOptional" | "prefer" | "bool";
interface Field {
  key: string;
  label: string;
  kind: FieldKind;
}

const FIELDS: Record<ConstraintSpec["type"], Field[]> = {
  daily_coverage: [
    { key: "shift", label: "근무", kind: "shiftDEN" },
    { key: "day_kind", label: "요일 종류", kind: "dayKind" },
    { key: "min", label: "최소", kind: "int" },
    { key: "max", label: "최대", kind: "int" },
  ],
  forbidden_sequence: [
    { key: "first", label: "앞 근무", kind: "shift" },
    { key: "second", label: "다음 날 근무", kind: "shift" },
  ],
  max_consecutive_work: [{ key: "days", label: "일수", kind: "int" }],
  max_consecutive_nights: [{ key: "days", label: "일수", kind: "int" }],
  min_days_off: [{ key: "days", label: "일수", kind: "int" }],
  off_after_night_block: [{ key: "days", label: "일수", kind: "int" }],
  skill_mix: [
    { key: "shift", label: "근무", kind: "shiftDEN" },
    { key: "min_years", label: "최소 연차", kind: "int" },
    { key: "min_count", label: "최소 인원", kind: "int" },
  ],
  leave: [{ key: "days", label: "날짜 (예: 15-17, 20)", kind: "days" }],
  fixed_assignment: [
    { key: "day", label: "날짜", kind: "int" },
    { key: "shift", label: "근무", kind: "shift" },
  ],
  shift_preference: [
    { key: "shift", label: "근무", kind: "shift" },
    { key: "prefer", label: "희망/기피", kind: "prefer" },
    { key: "days", label: "날짜 (비우면 한 달 전체)", kind: "daysOptional" },
    { key: "weekends_only", label: "주말·공휴일만", kind: "bool" },
  ],
  night_fairness: [],
  weekend_fairness: [],
};

type Draft = Record<string, string>;

function toDraft(c: ConstraintSpec): Draft {
  const p = (c.params ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    FIELDS[c.type].map(({ key, kind }) => {
      const v = p[key];
      if (kind === "days" || kind === "daysOptional") return [key, Array.isArray(v) ? dayRanges(v).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ") : ""];
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
function fromDraft(c: ConstraintSpec, draft: Draft, last: number): { params: ConstraintSpec["params"] } | { error: string } {
  const params: Record<string, unknown> = { ...(c.params ?? {}) };
  for (const { key, label, kind } of FIELDS[c.type]) {
    const v = draft[key].trim();
    if (kind === "int") {
      if (!/^\d+$/.test(v)) return { error: `${label}: 0 이상의 정수를 입력해 주세요` };
      if (key === "day" && (Number(v) < 1 || Number(v) > last)) return { error: `${label}: 1~${last}일 사이로 입력해 주세요` };
      params[key] = Number(v);
    } else if (kind === "days" || kind === "daysOptional") {
      if (v === "" && kind === "daysOptional") {
        params[key] = null;
        continue;
      }
      const days = parseDays(v, last);
      if (!days || days.length === 0) return { error: `${label}: 1~${last} 사이 날짜를 쉼표로 구분해 주세요` };
      params[key] = days;
    } else if (kind === "prefer" || kind === "bool") {
      params[key] = v === "true";
    } else {
      params[key] = v;
    }
  }
  if (c.type === "daily_coverage" && (params.min as number) > (params.max as number)) {
    return { error: "최소 인원이 최대 인원보다 많아요" };
  }
  return { params: params as ConstraintSpec["params"] };
}

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const select = (options: [string, string][]) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${ui.input} h-8 font-mono`}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
  const control = (() => {
    switch (field.kind) {
      case "shift":
        return select(["D", "E", "N", "O"].map((s) => [s, s]));
      case "shiftDEN":
        return select(["D", "E", "N"].map((s) => [s, s]));
      case "dayKind":
        return select([
          ["weekday", "평일"],
          ["weekend", "주말·공휴일"],
        ]);
      case "prefer":
        return select([
          ["true", "희망"],
          ["false", "기피"],
        ]);
      case "bool":
        return (
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(String(e.target.checked))}
            className="size-4 accent-[#155E75]"
          />
        );
      case "int":
        return (
          <input
            inputMode="numeric"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${ui.input} h-8 w-20 font-mono`}
          />
        );
      default:
        return (
          <input value={value} onChange={(e) => onChange(e.target.value)} className={`${ui.input} h-8 w-48 font-mono`} />
        );
    }
  })();
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
      aria-label="hard/soft"
      title={disabled ? "휴가와 고정 배정은 항상 hard예요" : undefined}
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
          {h}
        </button>
      ))}
    </div>
  );
}

export default function ConstraintCard({
  card,
  pending,
  replaces,
  onApplied,
  busy = false,
}: {
  card: ConstraintSpec;
  pending: boolean;
  /** 적용하면 대체될 기존 제약 */
  replaces?: ConstraintSpec;
  /** [적용] 직후 호출(④ 월중 변경의 재풀이) */
  onApplied?: () => void;
  /** 요청 중이면 [적용]을 막는다 */
  busy?: boolean;
}) {
  const nurses = useAppStore((s) => s.nurses);
  const period = useAppStore((s) => s.period);
  const applyCard = useAppStore((s) => s.applyCard);
  const updateCard = useAppStore((s) => s.updateCard);
  const removeCard = useAppStore((s) => s.removeCard);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nurseId = (card.params as { nurse_id?: string } | undefined)?.nurse_id;
  const orphan = nurseId !== undefined && !nurses.some((n) => n.id === nurseId);
  const editable = FIELDS[card.type].length > 0;
  const lastDay = new Date(period.year, period.month, 0).getDate();

  const save = () => {
    if (!draft) return;
    const out = fromDraft(card, draft, lastDay);
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
        <h3 className="text-[13px] font-semibold text-[#1B1B18]">{TEMPLATE_NAMES[card.type]}</h3>
        <HardnessToggle
          value={ALWAYS_HARD.includes(card.type) ? "hard" : (card.hardness ?? "hard")}
          disabled={ALWAYS_HARD.includes(card.type)}
          onChange={(hardness) => updateCard(card.id, { hardness })}
        />
      </div>
      <p className="text-sm text-[#1B1B18]">“{card.source_text}”</p>

      {draft ? (
        <div className="flex flex-col gap-2.5 rounded-sm bg-[#F6F6F3] px-2.5 py-2">
          <div className="flex flex-wrap items-end gap-3">
            {FIELDS[card.type].map((f) => (
              <FieldInput key={f.key} field={f} value={draft[f.key]} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />
            ))}
          </div>
          {error && <p className={ui.error}>{error}</p>}
        </div>
      ) : (
        <p className="rounded-sm bg-[#F6F6F3] px-2.5 py-2 font-mono text-xs text-[#66665E]">
          {describeParams(card, nurses, period)}
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
          {pending ? (
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
          ) : (
            <>
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
