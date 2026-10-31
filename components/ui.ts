// UI_GUIDE 컴포넌트 규격 클래스.
const btnBase =
  "inline-flex items-center gap-2 px-4 rounded-md font-medium transition-colors duration-[120ms] disabled:bg-[#EFEFEB] disabled:text-[#9A9A91] disabled:border-[#E2E2DC] disabled:cursor-not-allowed";
const btn = `${btnBase} h-10 text-sm`;
const btnSm = `${btnBase} h-8 text-[13px]`;
// 새 크기 버튼. px가 겹치지 않게 btnBase를 쓰지 않는다. 포커스와 비활성 규격은 UI_GUIDE "상호작용 상태".
const btnCore =
  "inline-flex items-center gap-2 rounded-md font-medium transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-[#155E75] focus-visible:outline-offset-2 disabled:bg-[#EFEFEB] disabled:text-[#9A9A91] disabled:border-[#E2E2DC] disabled:cursor-not-allowed";
const btnLg = `${btnCore} h-11 px-5 text-[15px]`;
const btnXl = `${btnCore} h-12 px-[22px] text-[15px]`;

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
  /** 화면의 Primary(근무표 만들기·확정·다시 확정·이어서 하기·제출). */
  primaryLg: `${btnLg} bg-[#155E75] text-white border border-[#155E75] hover:bg-[#0E4A5C] active:bg-[#0B3F4E]`,
  secondaryLg: `${btnLg} bg-white text-[#1B1B18] border border-[#C9C9C1] hover:bg-[#EFEFEB] active:bg-[#E2E2DC]`,
  /** 랜딩·로그인 버튼. */
  primaryXl: `${btnXl} bg-[#155E75] text-white border border-[#155E75] hover:bg-[#0E4A5C] active:bg-[#0B3F4E]`,
  secondaryXl: `${btnXl} bg-white text-[#1B1B18] border border-[#C9C9C1] hover:bg-[#EFEFEB] active:bg-[#E2E2DC]`,
  /** 자연어 입력 바 안의 Primary. */
  primaryBar: `${btnCore} h-9 px-3.5 text-sm bg-[#155E75] text-white border border-[#155E75] hover:bg-[#0E4A5C] active:bg-[#0B3F4E]`,
  /** 예시 칩. */
  chip: "inline-flex items-center h-7 px-3 rounded-full border border-[#C9C9C1] bg-white text-xs font-normal text-[#3D3D38] transition-colors duration-[120ms] hover:bg-[#EFEFEB] active:bg-[#E2E2DC] focus-visible:outline-2 focus-visible:outline-[#155E75] focus-visible:outline-offset-2",
  /** 강조 바탕 패널. 한 화면에 하나. */
  panel: "rounded-xl bg-[#F0F6F8] border border-[#CFE4EA] px-6 py-5",
  /** 자연어 입력 바 껍데기와 그 안의 입력. */
  bar: "flex items-center h-12 bg-white border border-[#8A8A80] rounded-lg pl-4 pr-1.5 gap-2.5 focus-within:border-[#155E75] focus-within:outline-2 focus-within:outline-[#155E75] focus-within:-outline-offset-1",
  barInput: "flex-1 border-0 outline-0 text-[15px] bg-transparent min-w-0 text-[#1B1B18] placeholder:text-[#707068]",
  /** 큰 면 카드(로그인, 대화상자). */
  cardXl: "rounded-xl bg-white border border-[#E2E2DC]",
  /** 떠 있는 것(메뉴, 대화상자, 드래그 중인 요소)에만 쓴다. */
  shadow: "shadow-[0_8px_24px_rgba(27,27,24,.12),0_1px_2px_rgba(27,27,24,.08)]",
  pageTitle: "text-[28px] leading-[1.3] font-semibold tracking-[-0.01em] text-[#1B1B18]",
  sectionTitle: "text-[18px] leading-[1.35] font-semibold text-[#1B1B18]",
  eyebrow: "font-mono text-xs font-semibold text-[#155E75] tracking-[0.02em]",
  bigNumber: "font-mono font-semibold text-[22px]",
  /** 배지 색. ui.badge와 함께 쓴다. */
  badgeTone: {
    applied: "bg-[#E6F2EA] text-[#1E6B3F]",
    pending: "bg-[#FDF0DC] text-[#7A4506]",
    draft: "bg-white text-[#3D3D38] border border-[#C9C9C1]",
    confirmed: "bg-[#E6F2EA] text-[#1E6B3F]",
    operating: "bg-[#E3F0F3] text-[#155E75]",
    none: "bg-[#FBE9E7] text-[#9F1F14]",
    excluded: "bg-[#EFEFEB] text-[#66665E]",
    base: "bg-[#EFEFEB] text-[#3D3D38]",
  },
  input:
    "h-10 rounded-md bg-white border border-[#8A8A80] px-3 text-sm text-[#1B1B18] placeholder:text-[#707068] focus:outline-2 focus:outline-[#155E75] focus:-outline-offset-1 focus:border-[#155E75]",
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
