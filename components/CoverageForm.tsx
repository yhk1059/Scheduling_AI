"use client";

import { type Code, coverageCodes, coverageRange, type DayKind, useAppStore } from "@/lib/store";

import { ui } from "./ui";

type Shift = Code;
type Side = "min" | "max";
const DAY_KINDS: { kind: DayKind; label: string }[] = [
  { kind: "weekday", label: "평일" },
  { kind: "weekend", label: "주말·공휴일" },
];

/** 입력 중이거나 잘못된 칸만 담는다. 키는 `${shift}|${day_kind}|${min|max}`. */
export type CoverageDrafts = Record<string, string>;
const keyOf = (shift: Shift, kind: DayKind, side: Side) => `${shift}|${kind}|${side}`;

const NUMBER_MSG = "인원은 숫자로 적어 주세요.";
const ORDER_MSG = "최소가 최대보다 커요.";

/**
 * 필요 인원 폼. 행은 활성 기본 근무 코드. 칸마다 최소·최대를 받아 필요 인원 기본 규칙을 고친다.
 * 최대를 비우면 그 이상, 둘이 같으면 정확히 그 인원이다. 근무조 합계로 막지 않는다(가능 여부는 솔버가 판정, ADR-019).
 */
export default function CoverageForm({
  drafts,
  setDrafts,
}: {
  drafts: CoverageDrafts;
  setDrafts: (update: (d: CoverageDrafts) => CoverageDrafts) => void;
}) {
  const shop = useAppStore((s) => s.shop);
  const constraints = shop?.rules ?? [];
  const setCoverage = useAppStore((s) => s.setCoverage);
  const SHIFTS = coverageCodes(shop?.config ?? { shifts: [{ code: "O", name: "휴무", hours: 0 }] }).map((s) => ({
    shift: s.code,
    label: s.name,
  }));

  const shown = (shift: Shift, kind: DayKind, side: Side) => {
    const draft = drafts[keyOf(shift, kind, side)];
    if (draft !== undefined) return draft;
    const r = coverageRange(constraints, shift, kind);
    const v = r === null ? null : r[side];
    return v === null ? "" : String(v);
  };

  /** 칸의 오류(없으면 null). 최소를 비운 칸은 아직 입력 중이라 오류가 아니다. */
  const errorOf = (shift: Shift, kind: DayKind): string | null => {
    const min = shown(shift, kind, "min");
    const max = shown(shift, kind, "max");
    if ((min !== "" && !/^\d+$/.test(min)) || (max !== "" && !/^\d+$/.test(max))) return NUMBER_MSG;
    if (min !== "" && max !== "" && Number(min) > Number(max)) return ORDER_MSG;
    return null;
  };

  const change = (shift: Shift, kind: DayKind, side: Side, value: string) => {
    const other: Side = side === "min" ? "max" : "min";
    const next = { [side]: value, [other]: shown(shift, kind, other) } as Record<Side, string>;
    const valid =
      /^\d+$/.test(next.min) && (next.max === "" || (/^\d+$/.test(next.max) && Number(next.max) >= Number(next.min)));
    if (valid) setCoverage(shift, kind, Number(next.min), next.max === "" ? null : Number(next.max));
    setDrafts((d) => {
      const rest = { ...d };
      if (valid) {
        delete rest[keyOf(shift, kind, "min")];
        delete rest[keyOf(shift, kind, "max")];
      } else {
        rest[keyOf(shift, kind, side)] = value;
      }
      return rest;
    });
  };

  const errors = [...new Set(SHIFTS.flatMap(({ shift }) => DAY_KINDS.map(({ kind }) => errorOf(shift, kind))))].filter(
    (e): e is string => e !== null,
  );

  return (
    <div className="flex flex-col gap-2">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th />
            {DAY_KINDS.map(({ kind, label }) => (
              <th key={kind} className={`${ui.label} px-2 pb-1 text-left`}>
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
                const error = errorOf(shift, kind);
                const min = shown(shift, kind, "min");
                const max = shown(shift, kind, "max");
                const input = (side: Side, value: string) => {
                  const bad =
                    error === ORDER_MSG || (error === NUMBER_MSG && value !== "" && !/^\d+$/.test(value));
                  return (
                    <input
                      inputMode="numeric"
                      value={value}
                      onChange={(e) => change(shift, kind, side, e.target.value.trim())}
                      aria-label={`${kindLabel} ${label} ${side === "min" ? "최소" : "최대"} 인원`}
                      aria-invalid={bad || undefined}
                      className={`${ui.cell} w-14 font-mono ${bad ? ui.cellErr : ui.cellOk}`}
                    />
                  );
                };
                return (
                  <td key={kind} className="px-2 py-1">
                    <span className="flex items-center gap-1.5">
                      {input("min", min)}
                      <span className="text-[13px] text-[#66665E]">~</span>
                      {input("max", max)}
                      <span className="w-12 text-[13px] text-[#66665E]">
                        명{min !== "" && max === "" ? " 이상" : ""}
                      </span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {errors.map((e) => (
        <p key={e} className={ui.error}>
          {e}
        </p>
      ))}
    </div>
  );
}
