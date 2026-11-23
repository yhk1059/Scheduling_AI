import { Fragment } from "react";

import Link from "next/link";

import DemoVideoButton from "@/components/DemoVideo";
import HeroSequence, { ChangeFragment } from "@/components/HeroSequence";
import { LandingFooter, SectionHead, body, container, section } from "@/components/landing";
import { ui } from "@/components/ui";
import Wordmark, { Mark } from "@/components/Wordmark";
import { PRODUCT_NAME } from "@/lib/product";

// 문제 장면: 손으로 짠 엑셀 근무표. 토요일 칸을 고치면(주황 1) 다음 날 칸이 깨진다(빨강 2). 색은 앱 근무표와 같다.
type Shift = "오픈" | "미들" | "마감" | "휴";
const SHIFT_CLASS: Record<Shift, string> = {
  오픈: "bg-[#E5EDFF] text-[#1E4FD8]",
  미들: "bg-[#DDF7E9] text-[#067647]",
  마감: "bg-[#EEE9FF] text-[#5925DC]",
  휴: "bg-[#FFEBDB] text-[#B93815]",
};
const SHEET_DAYS = ["2 월", "3 화", "4 수", "5 목", "6 금", "7 토", "8 일"];
const SHEET_ROWS: { name: string; cells: Shift[] }[] = [
  { name: "김서연", cells: ["오픈", "미들", "마감", "휴", "오픈", "마감", "미들"] },
  { name: "박민수", cells: ["미들", "휴", "오픈", "미들", "마감", "휴", "오픈"] },
  { name: "이준호", cells: ["마감", "오픈", "휴", "마감", "미들", "휴", "마감"] },
  { name: "최지훈", cells: ["휴", "마감", "마감", "휴", "오픈", "오픈", "휴"] },
];
// 고치는 칸(박민수 · 토)과 그 때문에 깨지는 칸(박민수 · 일)
const FIX = { row: 1, day: 5 };
const SHEET_CELL = "flex h-10 items-center justify-center border-r border-b border-[#DCDCD8] text-xs lg:h-11 lg:text-sm";

/** 번호 동그라미. 주황은 고친 곳, 빨강은 깨진 곳. */
function Num({ n, className = "" }: { n: 1 | 2; className?: string }) {
  return (
    <span className={`inline-flex size-[22px] items-center justify-center rounded-full font-mono text-xs font-medium ${n === 1 ? "bg-[#FF7A1A] text-[#2B1100]" : "bg-[#B42318] text-white"} ${className}`}>
      {n}
    </span>
  );
}

function HandSheet() {
  return (
    <div
      role="img"
      aria-label="손으로 짠 엑셀 근무표. 토요일 마감 칸을 채우자 다음 날 오픈 칸이 규칙에 어긋난다."
      className="problem-sheet grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-t border-l border-[#DCDCD8] bg-white lg:grid-cols-[80px_repeat(7,minmax(0,1fr))]"
    >
      <span className={`${SHEET_CELL} h-8! justify-start truncate bg-[#F5F5F4] pl-2.5 font-mono text-[11px] text-[#6B6F78] lg:h-9! lg:text-xs`}>11월.xlsx</span>
      {SHEET_DAYS.map((d) => (
        <span key={d} className={`${SHEET_CELL} h-8! bg-[#F5F5F4] font-mono text-[11px] text-[#6B6F78] lg:h-9! lg:text-xs`}>
          {d}
        </span>
      ))}
      {SHEET_ROWS.map((r, ri) => (
        <Fragment key={r.name}>
          <span className={`${SHEET_CELL} justify-start pl-2.5 text-[#111214]`}>{r.name}</span>
          {r.cells.map((c, di) => {
            const fix = ri === FIX.row && di === FIX.day;
            const broken = ri === FIX.row && di === FIX.day + 1;
            return (
              <span key={di} className={`relative ${SHEET_CELL} ${SHIFT_CLASS[c]}`}>
                {c}
                {fix && (
                  <span className={`problem-fix absolute inset-0 flex items-center justify-center gap-1 shadow-[inset_0_0_0_3px_#FF7A1A] ${SHIFT_CLASS.마감}`}>
                    <span className="text-[#8A93A6] line-through max-lg:hidden">휴</span>
                    <span className="font-medium">마감</span>
                    <Num n={1} className="absolute -top-2.5 -right-2.5 ring-2 ring-white" />
                  </span>
                )}
                {broken && (
                  <span className="problem-break absolute inset-0 shadow-[inset_0_0_0_3px_#B42318]">
                    <Num n={2} className="absolute -top-2.5 -right-2.5 ring-2 ring-white" />
                  </span>
                )}
              </span>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

/** 문제 쪽 말풍선. 매니저와 직원의 말, 그 아래 이 서비스에서 달라지는 점 한 줄. */
const CHAT: { who: "매니저" | "직원"; time: string; text: string; answer: string }[] = [
  {
    who: "매니저",
    time: "일요일 23:10",
    text: "토요일 마감 채우니까 이번엔 연속 6일이 됐어요… 다시 처음부터.",
    answer: "조건을 모두 지키는 근무표를 한 번에 찾아 줘요.",
  },
  {
    who: "매니저",
    time: "월요일 00:40",
    text: "이 조건으로 되긴 되는 거예요? 어디부터 바꿔야 하지.",
    answer: "안 되면 안 된다고, 무엇을 바꾸면 되는지 알려 줘요.",
  },
  {
    who: "직원",
    time: "월요일 08:12",
    text: "아까 말한 시간 바뀌었어요! 그리고 마감 다음 날 오픈은 안 되는 거 맞죠?",
    answer: "직원이 링크에서 직접 고쳐요. 규칙은 한 번만 적어 두면 돼요.",
  },
];

function ChatPanel() {
  return (
    <div className="flex flex-col gap-5 rounded-xl bg-[#F5F5F4] p-5 lg:p-6">
      {CHAT.map((m) => (
        <div key={m.time} className="flex flex-col gap-2">
          <span className="flex items-center gap-2 font-mono text-[11px] text-[#6B6F78]">
            <span aria-hidden="true" className={`inline-flex size-6 items-center justify-center rounded-full font-sans text-[11px] font-semibold ${m.who === "매니저" ? "bg-[#C4247C] text-white" : "bg-[#FF7A1A] text-[#2B1100]"}`}>
              {m.who[0]}
            </span>
            {m.who} · {m.time}
          </span>
          <p className="self-start rounded-xl rounded-tl-[3px] border border-[#EDEDEA] bg-white px-3.5 py-2.5 text-[15px] leading-[1.55] text-[#111214]">{m.text}</p>
          <div className="flex flex-col gap-1.5 rounded-lg bg-[#FDEAF4] px-3 py-2.5">
            <span className="font-mono text-[11px] text-[#C4247C]">{PRODUCT_NAME}에서는</span>
            <span className="text-sm leading-[22px] text-[#111214]">{m.answer}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// 03: 근무표가 나간 뒤에도 이어지는 일
const MORE_PAINS = [
  { title: "“왜 나만 주말이 많아요?”", body: "처음부터 공평하게 나눠 짜요. 직원별 근무 수, 주말 근무, 최근 4주 마감 횟수도 보여 드려서 숫자로 바로 답할 수 있어요." },
  { title: "확정 뒤에 생긴 병가", body: "바뀌는 칸은 최소로 줄이고, 바뀐 칸은 표시해 드려요. 이미 지난 날은 건드리지 않아요." },
  { title: "다음 근무표로 이어받기", body: "명단과 조건은 그대로 남아요. 지난 근무표의 마지막 며칠도 이어서 따져요. 일요일에 마감한 사람을 월요일 오픈에 넣지 않는 식이에요." },
];

// 미니 캘린더에 칠한 시간(칸 번호). 요일마다 [시작, 끝)
const PAINTED = [[0, 6], [3, 10], [0, 0], [2, 8], [4, 10], [0, 10], [0, 0]];

function CalendarFragment() {
  return (
    <div className={`${ui.card} grid grid-cols-7 gap-1`}>
      {["월", "화", "수", "목", "금", "토", "일"].map((w, i) => (
        <div key={w} className="flex flex-col gap-px">
          <span className="pb-1 text-center font-mono text-[11px] text-[#6B6F78]">{w}</span>
          {Array.from({ length: 10 }, (_, slot) => (
            <span key={slot} className={`h-3 ${slot >= PAINTED[i][0] && slot < PAINTED[i][1] ? "bg-[#C4247C]" : "bg-[#F5F5F4]"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function BarFragment() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className={ui.bar}>
        <Mark size={18} />
        <span className="min-w-0 flex-1 truncate text-[15px] text-[#111214]">평일 오픈 2명, 주말은 3명</span>
        <span className={ui.primaryBar}>규칙 만들기</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={ui.help}>예시</span>
        <span className={ui.chip}>12시부터 15시까지는 최소 3명</span>
        <span className={ui.chip}>마감 다음 날 오픈은 안 되게</span>
      </div>
    </div>
  );
}

function SummaryFragment() {
  const item = "flex flex-col gap-1 border-[#EDEDEA] px-5 py-3.5 max-lg:border-b max-lg:last:border-b-0 lg:border-r lg:last:border-r-0";
  const label = "text-xs font-medium text-[#6B6F78]";
  return (
    <div className="flex flex-col rounded-lg border border-[#EDEDEA] bg-white lg:flex-row lg:items-stretch">
      <div className={item}>
        <span className={label}>결과</span>
        <span className="flex h-7 items-center">
          <span className={`${ui.badge} ${ui.badgeTone.applied}`}>반드시 규칙을 모두 지켰어요</span>
        </span>
      </div>
      <div className={item}>
        <span className={label}>희망 반영</span>
        <span className={`${ui.bigNumber} text-[#111214]`}>9/9</span>
      </div>
      <div className={item}>
        <span className={label}>못 지킨 가능하면 규칙</span>
        <span className={`${ui.bigNumber} text-[#B93815]`}>0</span>
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: "가능 시간 받기",
    body: "단체 대화방에 링크 하나만 올리세요. 직원이 자기 이름을 고르고 일할 수 있는 시간을 칠해요. 메신저를 보며 옮겨 적을 필요가 없어요.",
    fragment: <CalendarFragment />,
  },
  {
    title: "매장 조건 적기",
    body: "“평일 마감은 3명”, “마감 다음 날 오픈은 안 돼요”처럼 평소 말투로 적으세요. 적은 말이 조건 카드로 정리돼요.",
    fragment: <BarFragment />,
  },
  {
    title: "근무표 만들기",
    body: "버튼을 누르면 조건을 모두 지킨 근무표가 나와요. 안 되는 조건이 있으면 어디가 부딪히는지와 어떻게 바꾸면 되는지 알려 줘요.",
    fragment: <SummaryFragment />,
  },
  {
    title: "확정하고 운영하기",
    body: "확정하면 직원 입력이 마감돼요. 갑자기 병가가 나면 “최지훈 4~6일 병가”라고 적으세요. 다른 사람 근무는 최대한 그대로 두고 필요한 칸만 바꿔요.",
    fragment: <ChangeFragment />,
  },
];

export default function Home() {
  return (
    <div className="landing flex flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-[#EDEDEA] bg-white/85 backdrop-blur-xl">
        <div className={`${container} flex min-h-16 flex-wrap items-center justify-between gap-3 py-2`}>
          <Wordmark size="bar" href="/" />
          <nav aria-label="주요 메뉴" className="flex items-center gap-2 sm:gap-4">
            <a href="#how" className={`${ui.text} max-sm:hidden`}>사용 방법</a>
            <DemoVideoButton className={ui.text}>데모 영상</DemoVideoButton>
            <Link href="/app" className={ui.primary}>로그인</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className={`${container} hero-heading`}>
            <h1>
              Scheduling<span aria-hidden="true" className="hero-sticker calendar-sticker"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg></span><br />
              <span className="text-[#EE46BC]">AI</span><span aria-hidden="true" className="hero-sticker sparkle-sticker">✦</span>
            </h1>
            <div className="flex flex-wrap items-center justify-between gap-6">
              <p className="text-lg leading-relaxed text-[#4B4F57] sm:text-xl">직원은 링크로 가능 시간을 적고, 조건은 평소 말투로 적으세요. 근무표는 버튼 한 번에 나와요.</p>
              <div className="flex flex-wrap gap-2.5">
                <Link href="/app" className={ui.primaryXl}>내 매장으로 시작하기</Link>
                <Link href="/demo" className={ui.secondaryXl}>체험하기</Link>
              </div>
            </div>
          </div>
          <div className="hero-caption"><span className="rounded-full bg-[#111214] px-3 py-1 text-[11px] font-semibold text-white">실제 화면</span>말로 적은 규칙이 근무표가 되는 과정</div>
          <div className={`${container} hero-stage`}>
            <span aria-hidden="true" className="hero-float hero-float-request">일요일은 휴무로 해 주세요</span>
            <div className="hero-window">
              <div className="hero-window-bar"><span aria-hidden="true">● ● ●</span><span>우리 매장 · 근무표 미리보기</span><span aria-hidden="true" /></div>
              <HeroSequence />
            </div>
            <span aria-hidden="true" className="hero-float hero-float-result"><span className="size-2 rounded-full bg-[#12B76A]" />조건을 모두 지킨 근무표가 나와요</span>
          </div>
        </section>

        <section id="problem" className={section}>
          <div className={`${container} flex flex-col gap-12`}>
            <SectionHead eyebrow="01 · 이런 적 있죠?" title="메신저와 엑셀, 머릿속 규칙으로 짜고 있어요">
              직원 말은 메신저에, 규칙은 머릿속에, 근무표는 엑셀에 있어요. 한 칸을 고치면 다른 칸이 깨지고, 다 지키는 표가 있는지는 끝까지 알 수 없어요.
            </SectionHead>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
              <div className="flex flex-col gap-4">
                <HandSheet />
                <p className="text-[15px] leading-[1.7] text-[#4B4F57]">
                  <Num n={1} className="mr-1.5 align-[-5px]" />
                  토요일 마감이 모자라 박민수를 넣었더니
                  <Num n={2} className="mr-1.5 ml-2 align-[-5px]" />
                  다음 날 오픈 규칙이 깨져요. 그걸 고치면 연속 근무가 늘어나요. 칸이 서로 묶여 있어서 끝이 없어요.
                </p>
                <p className={ui.help}>오픈 · 미들 · 마감 색은 앱의 근무표와 같아요.</p>
              </div>
              <ChatPanel />
            </div>
          </div>
        </section>

        <section id="how" className={section}>
          <div className={`${container} flex flex-col gap-12`}>
            <SectionHead eyebrow="02 · 사용 방법" title="이번 주 근무표, 이 순서면 끝나요">
              한 번 적은 직원 명단과 매장 조건은 다음 근무표에도 그대로 써요.
            </SectionHead>
            <ol className="workflow-steps flex flex-col gap-6">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-3xl bg-[#F5F5F4] p-5 lg:p-8 grid grid-cols-[56px_minmax(0,1fr)] items-start gap-x-4 gap-y-5 lg:grid-cols-[64px_minmax(0,5fr)_minmax(0,6fr)] lg:gap-x-8 lg:gap-y-0">
                  <span className="flex size-12 items-center justify-center rounded-full bg-[#111214] font-mono text-lg font-semibold text-white">{i + 1}</span>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-[20px] font-semibold text-[#111214]">{s.title}</h3>
                    <p className={body}>{s.body}</p>
                  </div>
                  <div className="col-span-2 lg:col-span-1">{s.fragment}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="after" className={section}>
          <div className={`${container} flex flex-col gap-12`}>
            <SectionHead eyebrow="03 · 그다음" title="근무표 짠 다음에 생기는 일까지">
              공지하고 끝이 아니에요. 운영하면서 생기는 일도 같이 챙겨요.
            </SectionHead>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
              {MORE_PAINS.map((p) => (
                <div key={p.title} className="flex flex-col gap-2 border-l border-[#DCDCD8] pl-5">
                  <h3 className="text-[15px] font-semibold text-[#111214]">{p.title}</h3>
                  <p className={body}>{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-cta mx-4 my-6 rounded-[32px] bg-[#111214] py-16 lg:mx-auto lg:max-w-[1200px] lg:rounded-[40px] lg:py-28">
          <div className={`${container} flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-10`}>
            <div className="flex flex-col gap-3">
              <h2 className="text-[36px] leading-[1.15] font-bold tracking-[-0.04em] text-white lg:text-[56px]">
                이번 주 근무표,
                <br />지금 만들어 보세요
              </h2>
              <p className="text-base text-[#EDEDEA]">Google 로그인으로 시작해요. 체험은 로그인 없이 할 수 있어요.</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href="/app"
                className="inline-flex h-12 items-center rounded-full border border-white bg-white px-[22px] text-[15px] font-semibold text-[#111214] transition-colors duration-[120ms] hover:bg-[#FDEAF4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                내 매장으로 시작하기
              </Link>
              <Link
                href="/demo"
                className="inline-flex h-12 items-center rounded-full border border-white px-[22px] text-[15px] font-medium text-white transition-colors duration-[120ms] hover:bg-[#2C2F35] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                체험하기
              </Link>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
