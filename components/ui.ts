// 화면 전반에서 공유하는 디자인 규격.
const btnBase =
  "inline-flex items-center gap-2 px-4 rounded-full font-semibold transition-colors duration-[120ms] disabled:bg-[#F5F5F4] disabled:text-[#9499A2] disabled:border-[#EDEDEA] disabled:cursor-not-allowed";
const btn = `${btnBase} h-10 text-sm`;
const btnSm = `${btnBase} h-8 text-[13px]`;
// 새 크기 버튼. px가 겹치지 않게 btnBase를 쓰지 않는다. 포커스와 비활성 규격은 UI_GUIDE "상호작용 상태".
const btnCore =
  "inline-flex items-center gap-2 rounded-full font-semibold transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-[#C4247C] focus-visible:outline-offset-2 disabled:bg-[#F5F5F4] disabled:text-[#9499A2] disabled:border-[#EDEDEA] disabled:cursor-not-allowed";
const btnLg = `${btnCore} h-11 px-5 text-[15px]`;
const btnXl = `${btnCore} h-[52px] px-[26px] text-[15px]`;

export const ui = {
  card: "rounded-3xl bg-white border border-[#EDEDEA] px-6 py-5",
  cardTitle: "text-[16px] font-bold tracking-[-0.02em] text-[#111214]",
  primary: `${btn} bg-[#111214] text-white border border-[#111214] hover:bg-[#2C2F35]`,
  secondary: `${btn} bg-[#F5F5F4] text-[#111214] border border-transparent hover:bg-[#EDEDEA]`,
  text: "inline-flex items-center gap-2 h-10 px-2 rounded-md text-sm font-medium text-[#4B4F57] transition-colors duration-[120ms] hover:bg-[#F5F5F4] hover:text-[#111214]",
  primarySm: `${btnSm} bg-[#111214] text-white border border-[#111214] hover:bg-[#2C2F35]`,
  secondarySm: `${btnSm} bg-[#F5F5F4] text-[#111214] border border-transparent hover:bg-[#EDEDEA]`,
  textSm: "inline-flex items-center gap-2 h-8 px-2 rounded-md text-[13px] font-medium text-[#4B4F57] transition-colors duration-[120ms] hover:bg-[#F5F5F4] hover:text-[#111214]",
  badge: "inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap",
  danger: "inline-flex items-center h-8 px-2 rounded-md text-[13px] font-medium text-[#B42318] hover:bg-[#F5F5F4]",
  /** Primary 자리에 두는 Danger(데이터 삭제 확인). */
  dangerMd: `${btn} bg-white text-[#B42318] border border-[#DCDCD8] hover:bg-[#FEE4E2]`,
  /** 화면의 Primary(근무표 만들기·확정·다시 확정·이어서 하기·제출). */
  primaryLg: `${btnLg} bg-[#111214] text-white border border-[#111214] hover:bg-[#2C2F35] active:bg-[#111214]`,
  secondaryLg: `${btnLg} bg-[#F5F5F4] text-[#111214] border border-transparent hover:bg-[#EDEDEA] active:bg-[#EDEDEA]`,
  /** 랜딩·로그인 버튼. */
  primaryXl: `${btnXl} bg-[#111214] text-white border border-[#111214] hover:bg-[#2C2F35] active:bg-[#111214]`,
  secondaryXl: `${btnXl} bg-[#F5F5F4] text-[#111214] border border-transparent hover:bg-[#EDEDEA] active:bg-[#EDEDEA]`,
  /** 자연어 입력 바 안의 Primary. */
  primaryBar: `${btnCore} h-9 px-3.5 text-sm bg-[#111214] text-white border border-[#111214] hover:bg-[#2C2F35] active:bg-[#111214]`,
  /** 예시 칩. */
  chip: "inline-flex items-center h-7 px-3 rounded-full border border-[#DCDCD8] bg-white text-xs font-normal text-[#4B4F57] transition-colors duration-[120ms] hover:bg-[#F5F5F4] active:bg-[#EDEDEA] focus-visible:outline-2 focus-visible:outline-[#C4247C] focus-visible:outline-offset-2",
  /** 강조 바탕 패널. 한 화면에 하나. */
  panel: "rounded-3xl bg-[#F5F5F4] px-6 py-6",
  /** 자연어 입력 바 껍데기와 그 안의 입력. */
  bar: "flex items-center h-14 bg-white border border-[#DCDCD8] rounded-full pl-5 pr-1.5 gap-2.5 focus-within:border-[#C4247C] focus-within:outline-2 focus-within:outline-[#C4247C] focus-within:-outline-offset-1",
  barInput: "flex-1 border-0 outline-0 text-[15px] bg-transparent min-w-0 text-[#111214] placeholder:text-[#6B6F78]",
  /** 큰 면 카드(로그인, 대화상자). */
  cardXl: "rounded-3xl bg-white border border-[#EDEDEA]",
  /** 떠 있는 것(메뉴, 대화상자, 드래그 중인 요소)에만 쓴다. */
  shadow: "shadow-[0_24px_56px_-24px_rgba(17,18,20,.22),0_1px_3px_rgba(17,18,20,.06)]",
  pageTitle: "text-[40px] leading-[1.15] font-bold tracking-[-0.04em] text-[#111214]",
  sectionTitle: "text-[20px] leading-[1.35] font-bold tracking-[-0.025em] text-[#111214]",
  eyebrow: "font-mono text-xs font-semibold text-[#C4247C] tracking-[0.02em]",
  bigNumber: "font-mono font-semibold text-[22px]",
  /** 배지 색. ui.badge와 함께 쓴다. */
  badgeTone: {
    applied: "bg-[#DDF7E9] text-[#067647]",
    draft: "bg-white text-[#4B4F57] border border-[#DCDCD8]",
    confirmed: "bg-[#DDF7E9] text-[#067647]",
    operating: "bg-[#E5EDFF] text-[#1E4FD8]",
    none: "bg-[#FEE4E2] text-[#B42318]",
    excluded: "bg-[#F5F5F4] text-[#6B6F78]",
    base: "bg-[#F5F5F4] text-[#4B4F57]",
  },
  input:
    "h-11 rounded-xl bg-white border border-[#9499A2] px-3.5 text-sm text-[#111214] placeholder:text-[#6B6F78] focus:outline-2 focus:outline-[#C4247C] focus:-outline-offset-1 focus:border-[#C4247C]",
  /** 표 안 입력 칸(명단·근무 형태). 테두리 색은 상태에 따라 붙인다. */
  cell: "h-8 rounded-lg border bg-white px-2 text-[13px] text-[#111214] focus:outline-2 focus:outline-[#C4247C] focus:-outline-offset-1",
  cellOk: "border-[#9499A2]",
  cellErr: "border-[#B42318] bg-[#FEE4E2] text-[#B42318]",
  label: "text-xs font-medium text-[#4B4F57]",
  help: "text-xs font-medium text-[#6B6F78]",
  error: "text-xs font-medium text-[#B42318]",
  /** 주의 배너(이월 변경, 저장 안내, 기간 단위 변경 등 공통). 버튼은 최대 하나. */
  banner: "flex items-center justify-between gap-3 rounded-2xl bg-[#FFEBDB] px-5 py-3 text-sm font-medium text-[#B93815]",
};
