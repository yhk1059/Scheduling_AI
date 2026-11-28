// 화면 전반에서 공유하는 디자인 규격.
const btnBase =
  "inline-flex items-center gap-2 px-4 rounded-full font-semibold transition-colors duration-[120ms] disabled:bg-soft disabled:text-disabled disabled:border-line disabled:cursor-not-allowed";
const btn = `${btnBase} h-10 text-sm`;
const btnSm = `${btnBase} h-8 text-[13px]`;
// 새 크기 버튼. px가 겹치지 않게 btnBase를 쓰지 않는다. 포커스와 비활성 규격은 UI_GUIDE "상호작용 상태".
const btnCore =
  "inline-flex items-center gap-2 rounded-full font-semibold transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:bg-soft disabled:text-disabled disabled:border-line disabled:cursor-not-allowed";
const btnLg = `${btnCore} h-11 px-5 text-[15px]`;
const btnXl = `${btnCore} h-[52px] px-[26px] text-[15px]`;

export const ui = {
  workLayout: "grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]",
  workAside: "flex min-w-0 flex-col gap-3 lg:sticky lg:top-28",
  card: "rounded-3xl bg-white border border-line px-6 py-5",
  cardTitle: "text-[16px] font-bold tracking-[-0.02em] text-ink",
  primary: `${btn} bg-accent text-white border border-accent hover:bg-accent-hover`,
  secondary: `${btn} bg-soft text-ink border border-transparent hover:bg-pressed`,
  text: "inline-flex items-center gap-2 h-10 px-2 rounded-md text-sm font-medium text-body transition-colors duration-[120ms] hover:bg-soft hover:text-ink",
  primarySm: `${btnSm} bg-accent text-white border border-accent hover:bg-accent-hover`,
  secondarySm: `${btnSm} bg-soft text-ink border border-transparent hover:bg-pressed`,
  textSm: "inline-flex items-center gap-2 h-8 px-2 rounded-md text-[13px] font-medium text-body transition-colors duration-[120ms] hover:bg-soft hover:text-ink",
  badge: "inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap",
  danger: "inline-flex items-center h-8 px-2 rounded-md text-[13px] font-medium text-error hover:bg-soft",
  /** Primary 자리에 두는 Danger(데이터 삭제 확인). */
  dangerMd: `${btn} bg-white text-error border border-line-strong hover:bg-error-soft`,
  /** 화면의 Primary(근무표 만들기·확정·다시 확정·이어서 하기·제출). */
  primaryLg: `${btnLg} bg-accent text-white border border-accent hover:bg-accent-hover active:bg-accent`,
  secondaryLg: `${btnLg} bg-soft text-ink border border-transparent hover:bg-pressed active:bg-pressed`,
  /** 랜딩·로그인 버튼. */
  primaryXl: `${btnXl} bg-accent text-white border border-accent hover:bg-accent-hover active:bg-accent`,
  secondaryXl: `${btnXl} bg-soft text-ink border border-transparent hover:bg-pressed active:bg-pressed`,
  /** 자연어 입력 바 안의 Primary. */
  primaryBar: `${btnCore} h-9 px-3.5 text-sm bg-accent text-white border border-accent hover:bg-accent-hover active:bg-accent`,
  /** 예시 칩. */
  chip: "inline-flex items-center h-7 px-3 rounded-full border border-line-strong bg-white text-xs font-normal text-body transition-colors duration-[120ms] hover:bg-soft active:bg-pressed focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
  /** 강조 바탕 패널. 한 화면에 하나. */
  panel: "rounded-3xl bg-soft px-6 py-6",
  /** 자연어 입력 바 껍데기와 그 안의 입력. */
  bar: "flex items-center h-14 bg-white border border-field rounded-full pl-5 pr-1.5 gap-2.5 focus-within:border-accent focus-within:outline-2 focus-within:outline-accent focus-within:-outline-offset-1",
  barInput: "flex-1 border-0 outline-0 text-[15px] bg-transparent min-w-0 text-ink placeholder:text-muted",
  /** 큰 면 카드(로그인, 대화상자). */
  cardXl: "rounded-3xl bg-white border border-line",
  /** 떠 있는 것(메뉴, 대화상자, 드래그 중인 요소)에만 쓴다. */
  shadow: "shadow-[0_24px_56px_-24px_rgba(31,30,27,.18),0_1px_3px_rgba(31,30,27,.05)]",
  pageTitle: "text-[40px] leading-[1.15] font-bold tracking-[-0.04em] text-ink",
  sectionTitle: "text-[20px] leading-[1.35] font-bold tracking-[-0.025em] text-ink",
  eyebrow: "font-mono text-xs font-semibold text-accent tracking-[0.02em]",
  bigNumber: "font-mono font-semibold text-[22px]",
  /** 배지 색. ui.badge와 함께 쓴다. */
  badgeTone: {
    applied: "bg-ok-soft text-ok",
    draft: "bg-white text-body border border-line-strong",
    confirmed: "bg-ok-soft text-ok",
    operating: "bg-info-soft text-info",
    none: "bg-error-soft text-error",
    excluded: "bg-soft text-muted",
    base: "bg-soft text-body",
  },
  input:
    "h-11 rounded-xl bg-white border border-field px-3.5 text-sm text-ink placeholder:text-muted focus:outline-2 focus:outline-accent focus:-outline-offset-1 focus:border-accent",
  /** 표 안 입력 칸(명단·근무 형태). 테두리 색은 상태에 따라 붙인다. */
  cell: "h-8 rounded-lg border bg-white px-2 text-[13px] text-ink focus:outline-2 focus:outline-accent focus:-outline-offset-1",
  cellOk: "border-field",
  cellErr: "border-error bg-error-soft text-error",
  label: "text-xs font-medium text-body",
  help: "text-xs font-medium text-muted",
  error: "text-xs font-medium text-error",
  /** 주의 배너(이월 변경, 저장 안내, 기간 단위 변경 등 공통). 버튼은 최대 하나. */
  banner: "flex items-center justify-between gap-3 rounded-2xl bg-warn-soft px-5 py-3 text-sm font-medium text-warn",
};
