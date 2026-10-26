"use client";

import type { CellError, ColumnMapping, RosterField } from "@/lib/roster-import";

import { ui } from "./ui";

export interface RosterDraft {
  rows: string[][];
  mapping: ColumnMapping;
  firstRowIsData: boolean;
}

const FIELDS: { field: RosterField; label: string; optional: boolean }[] = [
  { field: "name", label: "이름 열", optional: false },
  { field: "years", label: "연차 열", optional: false },
  { field: "night_only", label: "나이트 전담 열", optional: true },
];

const cellInput =
  "h-8 w-full min-w-24 rounded-md border px-2 text-[13px] focus:outline-2 focus:outline-[#155E75] focus:-outline-offset-1";

export default function RosterEditor({
  draft,
  errors,
  onChange,
}: {
  draft: RosterDraft;
  errors: CellError[];
  onChange: (draft: RosterDraft) => void;
}) {
  const width = Math.max(1, ...draft.rows.map((r) => r.length));
  const cellErrors = new Set(errors.filter((e) => e.col !== null).map((e) => `${e.row}:${e.col}`));
  const rowErrors = new Set(errors.filter((e) => e.col === null && e.row !== null).map((e) => e.row));
  const fieldOf = (col: number) => FIELDS.find((f) => draft.mapping[f.field] === col);

  const setCell = (r: number, c: number, value: string) =>
    onChange({
      ...draft,
      rows: draft.rows.map((row, i) =>
        i === r ? Array.from({ length: Math.max(width, c + 1) }, (_, j) => (j === c ? value : (row[j] ?? ""))) : row,
      ),
    });

  const setMapping = (field: RosterField, value: string) => {
    const mapping = { ...draft.mapping };
    if (value === "") delete mapping[field];
    else mapping[field] = Number(value);
    onChange({ ...draft, mapping });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-4">
        {FIELDS.map(({ field, label, optional }) => (
          <label key={field} className="flex flex-col gap-1">
            <span className={ui.label}>{label}</span>
            <select
              value={draft.mapping[field] ?? ""}
              onChange={(e) => setMapping(field, e.target.value)}
              className={`${ui.input} w-44`}
            >
              <option value="">{optional ? "없음" : "선택"}</option>
              {Array.from({ length: width }, (_, c) => (
                <option key={c} value={c}>
                  {c + 1}열 · {draft.rows[0]?.[c] || "(빈칸)"}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="flex h-10 items-center gap-2 text-sm text-[#3D3D38]">
          <input
            type="checkbox"
            checked={draft.firstRowIsData}
            onChange={(e) => onChange({ ...draft, firstRowIsData: e.target.checked })}
            className="size-4 accent-[#155E75]"
          />
          첫 행도 데이터
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#E2E2DC] bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E2DC] text-left">
              <th className="w-10 px-2 py-2 font-mono text-xs font-medium text-[#66665E]">#</th>
              {Array.from({ length: width }, (_, c) => (
                <th key={c} className="px-2 py-2 text-xs font-medium text-[#66665E]">
                  {c + 1}열{fieldOf(c) && <span className="ml-1 text-[#155E75]">{fieldOf(c)!.label.replace(" 열", "")}</span>}
                </th>
              ))}
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, r) => {
              const isHeader = r === 0 && !draft.firstRowIsData;
              return (
                <tr
                  key={r}
                  className={`border-b border-[#EFEFEB] ${isHeader ? "bg-[#F6F6F3]" : ""} ${rowErrors.has(r) ? "bg-[#FBE9E7]" : ""}`}
                >
                  <td className="px-2 py-1 font-mono text-xs text-[#66665E]">{isHeader ? "헤더" : r + 1}</td>
                  {Array.from({ length: width }, (_, c) => {
                    const bad = cellErrors.has(`${r}:${c}`);
                    return (
                      <td key={c} className="px-1 py-1">
                        <input
                          value={row[c] ?? ""}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          aria-label={`${r + 1}행 ${c + 1}열`}
                          aria-invalid={bad || undefined}
                          className={`${cellInput} ${
                            bad
                              ? "border-[#B42318] bg-[#FBE9E7] text-[#9F1F14]"
                              : "border-[#E2E2DC] bg-white text-[#1B1B18]"
                          }`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-1 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => onChange({ ...draft, rows: draft.rows.filter((_, i) => i !== r) })}
                      className={ui.danger}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-start justify-between gap-4">
        <ul className="flex flex-col gap-1">
          {errors.map((e, i) => (
            <li key={i} className={ui.error}>
              {e.row !== null && <span className="font-mono">{e.row + 1}행 · </span>}
              {e.message}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => onChange({ ...draft, rows: [...draft.rows, Array<string>(width).fill("")] })}
          className={ui.text}
        >
          행 추가
        </button>
      </div>
    </div>
  );
}
