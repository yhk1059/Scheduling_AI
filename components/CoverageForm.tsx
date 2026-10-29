"use client";

import { type Code, coverageCodes, coverageRule, type DayKind, useAppStore } from "@/lib/store";

import { ui } from "./ui";

type Shift = Code;
const DAY_KINDS: { kind: DayKind; label: string }[] = [
  { kind: "weekday", label: "평일" },
  { kind: "weekend", label: "주말·공휴일" },
];

/** 입력 중이거나 잘못된 칸만 담는다. 키는 `${shift}|${day_kind}`. */
export type CoverageDrafts = Record<string, string>;
const keyOf = (shift: Shift, kind: DayKind) => `${shift}|${kind}`;

/** 필요 인원 폼. 행은 활성 기본 근무 코드. 칸마다 숫자 하나(정확히 그 인원)를 받아 필요 인원 블록의 최소·최대에 같은 값으로 저장한다. */
export default function CoverageForm({
  drafts,
  setDrafts,
}: {
  drafts: CoverageDrafts;
  setDrafts: (update: (d: CoverageDrafts) => CoverageDrafts) => void;
}) {
  const ward = useAppStore((s) => s.ward);
  const constraints = ward?.rules ?? [];
  const active = ward?.nurses.filter((n) => n.active).length ?? 0;
  const setCoverage = useAppStore((s) => s.setCoverage);
  const SHIFTS = coverageCodes(ward?.config ?? { shifts: [{ code: "O", name: "휴무", hours: 0 }] }).map((s) => ({
    shift: s.code,
    label: s.name,
  }));

  const stored = (shift: Shift, kind: DayKind) => {
    const p = coverageRule(constraints, shift, kind)?.params;
    return p ? { min: p.min ?? 0, max: p.max ?? p.min ?? 0 } : null;
  };
  // 예전에 범위(최소~최대)로 저장한 값은 그대로 보여 주고, 고치면 숫자 하나로 바뀐다
  const shown = (shift: Shift, kind: DayKind) => {
    const draft = drafts[keyOf(shift, kind)];
    if (draft !== undefined) return draft;
    const p = stored(shift, kind);
    return p === null ? "" : p.min === p.max ? String(p.min) : `${p.min}~${p.max}`;
  };

  const change = (shift: Shift, kind: DayKind, value: string) => {
    const key = keyOf(shift, kind);
    const valid = /^\d+$/.test(value);
    if (valid) setCoverage(shift, kind, Number(value), Number(value));
    setDrafts((d) => {
      const rest = { ...d };
      if (valid) delete rest[key];
      else rest[key] = value;
      return rest;
    });
  };

  // 하루에 일하는 사람 수(최소 기준). 모든 근무조가 있을 때만 센다
  const dailyTotal = (kind: DayKind) => {
    const ps = SHIFTS.map(({ shift }) => stored(shift, kind));
    return ps.every((p) => p !== null) ? ps.reduce((sum, p) => sum + p!.min, 0) : null;
  };

  return (
    <div className="flex flex-col gap-2">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th />
            {DAY_KINDS.map(({ kind, label }) => (
              <th key={kind} className="px-2 pb-1 text-left text-xs font-medium text-[#3D3D38]">
                {label}
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
                const value = shown(shift, kind);
                const bad = drafts[keyOf(shift, kind)] !== undefined && drafts[keyOf(shift, kind)] !== "";
                return (
                  <td key={kind} className="px-2 py-1">
                    <span className="flex items-center gap-1.5">
                      <input
                        inputMode="numeric"
                        value={value}
                        onChange={(e) => change(shift, kind, e.target.value.trim())}
                        aria-label={`${kindLabel} ${label} 인원`}
                        aria-invalid={bad || undefined}
                        className={`${ui.input} w-16 font-mono ${bad ? "border-[#B42318] text-[#9F1F14]" : ""}`}
                      />
                      <span className="text-[13px] text-[#66665E]">명</span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="border-t border-[#EFEFEB]">
            <th className="pt-2 pr-3 text-left text-xs font-medium text-[#66665E]">하루</th>
            {DAY_KINDS.map(({ kind }) => {
              const total = dailyTotal(kind);
              return (
                <td key={kind} className="px-2 pt-2 text-xs text-[#3D3D38]">
                  {total === null ? "–" : `${total}명 근무 · ${Math.max(active - total, 0)}명 쉼`}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      {Object.values(drafts).some((v) => v !== "") && <p className={ui.error}>인원은 숫자로 적어 주세요.</p>}
      {DAY_KINDS.map(({ kind, label }) => {
        const total = dailyTotal(kind);
        return total !== null && total >= active ? (
          <p key={kind} className={ui.error}>
            {label}에 하루 {total}명이 일해야 해서 쉴 사람이 없어요. 명단은 {active}명이에요.
          </p>
        ) : null;
      })}
    </div>
  );
}
