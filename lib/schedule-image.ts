// 확정 근무표를 이미지·인쇄용 SVG 한 장으로 그린다. 브라우저 밖 폰트에 기대지 않도록 시스템 한글 글꼴만 쓴다.
import { isWeekendDay, monthDay, periodDays, type PeriodRange } from "./period";
import { OFF_CODE } from "./rules";
import type { ShopConfig } from "./types.gen";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const FONT = "'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif";
const RED = "#B42318";
const INK = "#1F1E1B";
const MUTED = "#6A675F";
const LINE = "#E4E2DC";

const PAD = 24;
const TITLE_H = 40;
const HEAD_H = 44;
const ROW_H = 30;
const NAME_W = 96;
const CELL_W = 44;
const LEGEND_H = 24;

export interface ScheduleImageInput {
  title: string;
  employees: { id: string; name: string }[];
  period: PeriodRange;
  holidays: number[];
  assignments: Record<string, string[]>;
  config: ShopConfig;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function text(x: number, y: number, content: string, attrs: { fill?: string; size?: number; weight?: number; anchor?: "start" | "middle" } = {}): string {
  const { fill = INK, size = 13, weight = 400, anchor = "middle" } = attrs;
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="middle">${esc(content)}</text>`;
}

/** 머리글(요일·날짜), 직원 행(근무 코드, 휴무는 '휴'), 아래 근무 코드 설명. 주말·공휴일 머리글은 빨간 글씨. */
export function scheduleSvg({ title, employees, period, holidays, assignments, config }: ScheduleImageInput): string {
  const days = periodDays(period);
  const listed = employees.filter((n) => assignments[n.id]);
  const legend = config.shifts.filter((s) => s.code !== OFF_CODE && s.active !== false);
  const tableW = NAME_W + days.length * CELL_W;
  const tableTop = PAD + TITLE_H;
  const rowsTop = tableTop + HEAD_H;
  const legendTop = rowsTop + listed.length * ROW_H + 16;
  const width = PAD * 2 + tableW;
  const height = legendTop + legend.length * LEGEND_H + PAD;
  const colX = (i: number) => PAD + NAME_W + i * CELL_W;

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`,
    text(PAD, PAD + TITLE_H / 2 - 4, title, { size: 18, weight: 700, anchor: "start" }),
  ];

  days.forEach(({ day, weekday }, i) => {
    const off = isWeekendDay(period, day, holidays);
    if (off) out.push(`<rect x="${colX(i)}" y="${tableTop}" width="${CELL_W}" height="${HEAD_H + listed.length * ROW_H}" fill="#FEF3F2"/>`);
    const fill = off ? RED : MUTED;
    out.push(text(colX(i) + CELL_W / 2, tableTop + 13, WEEKDAYS[weekday], { fill, size: 12 }));
    out.push(text(colX(i) + CELL_W / 2, tableTop + 31, monthDay(period, day), { fill: off ? RED : INK, size: 12 }));
  });

  listed.forEach((n, r) => {
    const y = rowsTop + r * ROW_H;
    out.push(`<line x1="${PAD}" y1="${y}" x2="${PAD + tableW}" y2="${y}" stroke="${LINE}"/>`);
    out.push(text(PAD + 4, y + ROW_H / 2, n.name, { anchor: "start", weight: 600 }));
    assignments[n.id].forEach((code, i) => {
      const off = code === OFF_CODE;
      out.push(text(colX(i) + CELL_W / 2, y + ROW_H / 2, off ? "휴" : code, { fill: off ? MUTED : INK, weight: off ? 400 : 600 }));
    });
  });
  out.push(`<line x1="${PAD}" y1="${rowsTop + listed.length * ROW_H}" x2="${PAD + tableW}" y2="${rowsTop + listed.length * ROW_H}" stroke="${LINE}"/>`);

  legend.forEach((s, i) => {
    const time = s.start && s.end ? ` ${s.start}~${s.end}` : "";
    out.push(text(PAD, legendTop + i * LEGEND_H + LEGEND_H / 2, `${s.code} ${s.name}${time}`, { fill: MUTED, size: 12, anchor: "start" }));
  });

  out.push("</svg>");
  return out.join("");
}
