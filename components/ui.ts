// UI_GUIDE 컴포넌트 규격 클래스.
const btnBase =
  "inline-flex items-center gap-2 px-4 rounded-md font-medium transition-colors duration-[120ms] disabled:bg-[#EFEFEB] disabled:text-[#9A9A91] disabled:border-[#E2E2DC] disabled:cursor-not-allowed";
const btn = `${btnBase} h-10 text-sm`;
const btnSm = `${btnBase} h-8 text-[13px]`;

export const ui = {
  card: "rounded-lg bg-white border border-[#E2E2DC] px-[18px] py-4",
  cardTitle: "text-[15px] font-semibold text-[#1B1B18]",
  primary: `${btn} bg-[#155E75] text-white border border-[#155E75] hover:bg-[#0E4A5C]`,
  secondary: `${btn} bg-white text-[#1B1B18] border border-[#C9C9C1] hover:bg-[#EFEFEB]`,
  text: "inline-flex items-center gap-2 h-10 px-2 rounded-md text-sm font-medium text-[#3D3D38] transition-colors duration-[120ms] hover:bg-[#EFEFEB] hover:text-[#1B1B18]",
  primarySm: `${btnSm} bg-[#155E75] text-white border border-[#155E75] hover:bg-[#0E4A5C]`,
  secondarySm: `${btnSm} bg-white text-[#1B1B18] border border-[#C9C9C1] hover:bg-[#EFEFEB]`,
  textSm: "inline-flex items-center gap-2 h-8 px-2 rounded-md text-[13px] font-medium text-[#3D3D38] transition-colors duration-[120ms] hover:bg-[#EFEFEB] hover:text-[#1B1B18]",
  badge: "inline-flex items-center h-[22px] px-2 rounded-sm text-xs font-semibold",
  danger: "inline-flex items-center h-8 px-2 rounded-md text-[13px] font-medium text-[#B42318] hover:bg-[#EFEFEB]",
  /** Primary 자리에 두는 Danger(데이터 삭제 확인). */
  dangerMd: `${btn} bg-white text-[#B42318] border border-[#C9C9C1] hover:bg-[#FBE9E7]`,
  input:
    "h-10 rounded-md bg-white border border-[#C9C9C1] px-3 text-sm text-[#1B1B18] placeholder:text-[#8A8A80] focus:outline-2 focus:outline-[#155E75] focus:-outline-offset-1 focus:border-[#155E75]",
  /** 표 안 입력 칸(명단·근무 형태). 테두리 색은 상태에 따라 붙인다. */
  cell: "h-8 rounded-md border bg-white px-2 text-[13px] text-[#1B1B18] focus:outline-2 focus:outline-[#155E75] focus:-outline-offset-1",
  cellOk: "border-[#8A8A80]",
  cellErr: "border-[#B42318] bg-[#FBE9E7] text-[#9F1F14]",
  label: "text-xs font-medium text-[#3D3D38]",
  help: "text-xs font-medium text-[#66665E]",
  error: "text-xs font-medium text-[#B42318]",
  /** 주의 배너(이월 변경, 저장 안내, 기간 단위 변경 등 공통). 버튼은 최대 하나. */
  banner: "flex items-center justify-between gap-3 rounded-lg border border-[#F1D3A8] bg-[#FDF0DC] px-4 py-2.5 text-sm text-[#7A4506]",
};
