"use client";

import { type DayKind, type Shift, useAppStore } from "@/lib/store";

import { ui } from "./ui";

const SHIFTS: { shift: Shift; label: string }[] = [
  { shift: "D", label: "데이" },
  { shift: "E", label: "이브닝" },
  { shift: "N", label: "나이트" },
];
const DAY_KINDS: { kind: DayKind; label: string }[] = [
  { kind: "weekday", label: "평일" },
  { kind: "weekend", label: "주말·공휴일" },
];

type Bound = "min" | "max";
/** 입력 중이거나 잘못된 칸만 담는다. 키는 `${shift}|${day_kind}`. */
export type CoverageDrafts = Record<string, Record<Bound, string>>;
const keyOf = (shift: Shift, kind: DayKind) => `${shift}|${kind}`;
const minOverMax = (v: Record<Bound, string>) =>
  /^\d+$/.test(v.min) && /^\d+$/.test(v.max) && Number(v.min) > Number(v.max);

export function hasCoverageError(drafts: CoverageDrafts): boolean {
  return Object.values(drafts).some(minOverMax);
}

/** 필요 인원 폼. 유효한 값은 바로 daily_coverage 제약으로 저장하고, 아니면 drafts에 남긴다. */
export default function CoverageForm({
  drafts,
  setDrafts,
}: {
  drafts: CoverageDrafts;
  setDrafts: (update: (d: CoverageDrafts) => CoverageDrafts) => void;
}) {
  const constraints = useAppStore((s) => s.constraints);
  const setCoverage = useAppStore((s) => s.setCoverage);

  const stored = (shift: Shift, kind: DayKind) => {
    const c = constraints.find(
      (c) => c.type === "daily_coverage" && c.scope === "ward" && c.params.shift === shift && c.params.day_kind === kind,
    );
    return c?.type === "daily_coverage" ? { min: String(c.params.min), max: String(c.params.max) } : { min: "", max: "" };
  };

  const change = (shift: Shift, kind: DayKind, bound: Bound, value: string) => {
    const key = keyOf(shift, kind);
    const next = { ...stored(shift, kind), ...drafts[key], [bound]: value };
    const min = Number(next.min);
    const max = Number(next.max);
    const valid = /^\d+$/.test(next.min) && /^\d+$/.test(next.max) && min <= max;
    if (valid) setCoverage(shift, kind, min, max);
    setDrafts((d) => {
      const rest = { ...d };
      if (valid) delete rest[key];
      else rest[key] = next;
      return rest;
    });
  };

  return (
    <table className="border-collapse text-sm">
      <thead>
        <tr>
          <th />
          {DAY_KINDS.map(({ kind, label }) => (
            <th key={kind} colSpan={2} className="px-2 pb-1 text-left text-xs font-medium text-[#3D3D38]">
              {label} <span className="text-[#66665E]">최소 ~ 최대</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {SHIFTS.map(({ shift, label }) => (
          <tr key={shift}>
            <th className="py-1 pr-3 text-left text-[13px] font-medium text-[#1B1B18]">
              <span className="font-mono">{shift}</span> {label}
            </th>
            {DAY_KINDS.map(({ kind, label: kindLabel }) => {
              const value = { ...stored(shift, kind), ...drafts[keyOf(shift, kind)] };
              const bad = minOverMax(value);
              return (["min", "max"] as const).map((bound) => (
                <td key={`${kind}-${bound}`} className="px-1 py-1">
                  <input
                    inputMode="numeric"
                    value={value[bound]}
                    onChange={(e) => change(shift, kind, bound, e.target.value.trim())}
                    aria-label={`${kindLabel} ${label} ${bound === "min" ? "최소" : "최대"}`}
                    aria-invalid={bad || undefined}
                    className={`${ui.input} w-16 font-mono ${bad ? "border-[#B42318] text-[#9F1F14]" : ""}`}
                  />
                </td>
              ));
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

