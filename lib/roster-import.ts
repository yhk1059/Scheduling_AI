// 엑셀 명단·이월 근무 붙여넣기 파싱 (순수 함수).
import type { CarryOverRow, Nurse } from "./types.gen";

export const MAX_NURSES = 40; // backend/domain/constants.py MAX_NURSES
export const CARRY_OVER_DAYS = 7; // backend/domain/constants.py CARRY_OVER_DAYS

export type RosterField = "name" | "years" | "night_only";
export type ColumnMapping = Partial<Record<RosterField, number>>;
type Shift = CarryOverRow["shifts"][number];

/** row·col은 입력 rows 기준 인덱스. row가 null이면 표 전체, col이 null이면 행 전체 오류. */
export interface CellError {
  row: number | null;
  col: number | null;
  message: string;
}

/** 탭이 있으면 탭, 없으면 쉼표로 나눈다. RFC 4180 따옴표(구분자·줄바꿈·"" 이스케이프)를 지원한다. */
export function parseDelimited(text: string): string[][] {
  const sep = text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += ch;
    }
  }
  endRow();

  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

/** CSV 파일 바이트를 글자로 바꾼다. UTF-8(BOM 제거)이 아니면 엑셀 기본 저장 형식인 CP949로 읽는다. */
export function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("euc-kr").decode(buffer);
  }
}

const HEADER_SYNONYMS: Record<RosterField, string[]> = {
  name: ["이름", "성명", "간호사"],
  years: ["연차", "경력", "년차"],
  night_only: ["나이트전담", "n전담", "나이트"],
};

const normalizeHeader = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function mapHeaders(header: string[]): { mapping: ColumnMapping; unmatched: string[] } {
  const mapping: ColumnMapping = {};
  const unmatched: string[] = [];
  header.forEach((h, col) => {
    const key = normalizeHeader(h);
    const field = (Object.keys(HEADER_SYNONYMS) as RosterField[]).find(
      (f) => mapping[f] === undefined && HEADER_SYNONYMS[f].includes(key),
    );
    if (field) mapping[field] = col;
    else unmatched.push(h);
  });
  return { mapping, unmatched };
}

const NIGHT_TRUE = ["y", "o", "예", "true"];
const NIGHT_FALSE = ["n", "x", "아니오", "false", ""];

export function buildRoster(
  rows: string[][],
  mapping: ColumnMapping,
  firstRowIsData: boolean,
): { nurses: Nurse[]; errors: CellError[] } {
  if (mapping.name === undefined || mapping.years === undefined) {
    return { nurses: [], errors: [{ row: null, col: null, message: "이름과 연차 열을 지정해 주세요" }] };
  }
  const { name: nameCol, years: yearsCol, night_only: nightCol } = mapping;
  const errors: CellError[] = [];
  const start = firstRowIsData ? 0 : 1;

  const parsed: { row: number; name: string; years: number; night_only: boolean }[] = [];
  for (let r = start; r < rows.length; r++) {
    const cells = rows[r];
    const before = errors.length;

    const name = (cells[nameCol] ?? "").trim();
    if (name === "") errors.push({ row: r, col: nameCol, message: "이름이 비어 있어요" });

    const digits = (cells[yearsCol] ?? "").match(/\d+/);
    if (!digits) errors.push({ row: r, col: yearsCol, message: "연차는 숫자여야 해요" });

    let night = false;
    if (nightCol !== undefined) {
      const v = (cells[nightCol] ?? "").trim().toLowerCase();
      if (NIGHT_TRUE.includes(v)) night = true;
      else if (!NIGHT_FALSE.includes(v)) {
        errors.push({ row: r, col: nightCol, message: "나이트 전담은 Y/N으로 적어 주세요" });
      }
    }

    if (errors.length === before) {
      parsed.push({ row: r, name, years: Number(digits![0]), night_only: night });
    }
  }

  const counts = new Map<string, number>();
  for (const p of parsed) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  const valid = parsed.filter((p) => {
    if (counts.get(p.name)! < 2) return true;
    errors.push({ row: p.row, col: null, message: `동명이인: ${p.name}` });
    return false;
  });
  errors.sort((a, b) => (a.row ?? -1) - (b.row ?? -1));

  const total = rows.length - start;
  if (total === 0) errors.push({ row: null, col: null, message: "명단이 비어 있어요" });
  if (total > MAX_NURSES) {
    errors.push({ row: null, col: null, message: `간호사는 최대 ${MAX_NURSES}명까지예요` });
  }

  const nurses = valid.map((p, i) => ({
    id: `n${String(i + 1).padStart(2, "0")}`,
    name: p.name,
    years: p.years,
    night_only: p.night_only,
  }));
  return { nurses, errors };
}

const SHIFT_SYNONYMS: Record<string, Shift> = {
  d: "D", 데이: "D",
  e: "E", 이브: "E", 이브닝: "E",
  n: "N", 나: "N", 나이트: "N",
  o: "O", off: "O", 휴: "O", 오프: "O",
};

/** 전월 마지막 근무 붙여넣기. 첫 열은 이름, 나머지는 오래된 날부터 근무 코드. */
export function parseCarryOver(
  text: string,
  nurses: Nurse[],
): { rows: CarryOverRow[]; warnings: string[]; errors: CellError[] } {
  const byName = new Map(nurses.map((n) => [n.name, n.id]));
  const rows: CarryOverRow[] = [];
  const warnings: string[] = [];
  const errors: CellError[] = [];

  parseDelimited(text).forEach((cells, r) => {
    const [name, ...codes] = cells;
    if (HEADER_SYNONYMS.name.includes(normalizeHeader(name))) return;
    const nurseId = byName.get(name);
    if (nurseId === undefined) {
      warnings.push(`명단에 없는 이름이라 무시했어요: ${name}`);
      return;
    }
    while (codes.length > 0 && codes.at(-1) === "") codes.pop();

    const shifts: Shift[] = [];
    let ok = true;
    codes.forEach((code, i) => {
      const shift = SHIFT_SYNONYMS[code.toLowerCase()];
      if (shift) shifts.push(shift);
      else {
        errors.push({ row: r, col: i + 1, message: `알 수 없는 근무 코드: ${code || "(빈칸)"}` });
        ok = false;
      }
    });
    if (ok) rows.push({ nurse_id: nurseId, shifts: shifts.slice(-CARRY_OVER_DAYS) });
  });

  return { rows, warnings, errors };
}
