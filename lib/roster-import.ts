// 지난 근무(이월) 붙여넣기 파싱 (순수 함수).
import type { CarryOverRow, Employee, ShopConfig } from "./types.gen";

export const MAX_EMPLOYEES = 40; // backend/domain/constants.py MAX_EMPLOYEES
export const CARRY_OVER_DAYS = 7; // backend/domain/constants.py CARRY_OVER_DAYS

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

const NAME_HEADERS = ["이름", "성명", "간호사"];

/** 기본 코드의 다른 표기. 그 코드가 근무 형태에 있을 때만 쓴다. */
const SHIFT_SYNONYMS: Record<string, string> = {
  이브: "E",
  나: "N",
  off: "O", 휴: "O", 오프: "O",
};

/** 근무 형태의 코드(대소문자 무시)·이름과 기본 코드의 다른 표기 → 코드. */
function codeLookup(config: ShopConfig): Map<string, string> {
  const map = new Map<string, string>();
  for (const [word, code] of Object.entries(SHIFT_SYNONYMS)) {
    if (config.shifts.some((s) => s.code === code)) map.set(word, code);
  }
  for (const s of config.shifts) {
    map.set(s.name.toLowerCase(), s.code);
    map.set(s.code.toLowerCase(), s.code);
  }
  return map;
}

/** 지난 근무 붙여넣기. 첫 열은 이름, 나머지는 오래된 날부터 근무 코드(근무 형태의 코드나 이름). */
export function parseCarryOver(
  text: string,
  employees: Employee[],
  config: ShopConfig,
): { rows: CarryOverRow[]; warnings: string[]; errors: CellError[] } {
  const byName = new Map(employees.map((n) => [n.name, n.id]));
  const codes = codeLookup(config);
  const rows: CarryOverRow[] = [];
  const warnings: string[] = [];
  const errors: CellError[] = [];

  parseDelimited(text).forEach((cells, r) => {
    const [name, ...cellCodes] = cells;
    if (NAME_HEADERS.includes(name.replace(/\s+/g, ""))) return;
    const employeeId = byName.get(name);
    if (employeeId === undefined) {
      warnings.push(`명단에 없는 이름이라 무시했어요: ${name}`);
      return;
    }
    while (cellCodes.length > 0 && cellCodes.at(-1) === "") cellCodes.pop();

    const shifts: string[] = [];
    let ok = true;
    cellCodes.forEach((code, i) => {
      const shift = codes.get(code.toLowerCase());
      if (shift) shifts.push(shift);
      else {
        errors.push({ row: r, col: i + 1, message: `알 수 없는 근무 코드: ${code || "(빈칸)"}` });
        ok = false;
      }
    });
    if (ok) rows.push({ employee_id: employeeId, shifts: shifts.slice(-CARRY_OVER_DAYS) });
  });

  return { rows, warnings, errors };
}
