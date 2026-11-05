import type { ReactNode } from "react";

import Link from "next/link";

import DemoVideoButton from "@/components/DemoVideo";
import HeroSequence, { ChangeFragment, ReplyCard, ScheduleFragment } from "@/components/HeroSequence";
import { ui } from "@/components/ui";
import { Mark } from "@/components/Wordmark";
import { PRODUCT_NAME } from "@/lib/product";

// 저장소를 옮기면 이 한 줄만 바꾼다.
const REPO_URL = "https://github.com/yhk1059/Scheduling_AI";

const container = "mx-auto w-full max-w-[1360px] px-5 lg:px-10";
const section = "border-t border-[#E2E2DC] py-16 lg:py-24";
const sectionTitle = "text-[26px] leading-[1.25] lg:text-[32px] font-semibold tracking-[-0.02em] text-[#1B1B18]";
const lead = "max-w-[640px] text-base leading-relaxed text-[#3D3D38]";
const body = "text-sm leading-relaxed text-[#3D3D38]";

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className={ui.eyebrow}>{eyebrow}</p>
      <h2 className={sectionTitle}>{title}</h2>
      <p className={lead}>{children}</p>
    </div>
  );
}

/** "지금" 쪽: 메신저 말풍선과 메모. 글자만 둔다. */
function Before({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col items-start gap-2 self-start rounded-lg bg-[#EFEFEB] p-5">
      <span className="text-xs font-medium text-[#66665E]">지금</span>
      {lines.map((line) => (
        <p key={line} className="rounded-lg bg-white px-3 py-2 text-sm text-[#3D3D38]">
          {line}
        </p>
      ))}
    </div>
  );
}

function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 self-center justify-self-center text-[#66665E] max-lg:rotate-90" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M4 12h16M14 6l6 6-6 6" />
    </svg>
  );
}

function After({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-[#155E75]">{PRODUCT_NAME}에서는</span>
      {children}
    </div>
  );
}

function LinkFragment() {
  return (
    <div className={`${ui.card} flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-mono text-[13px] text-[#1B1B18]">/a/k7Qm2xPz</span>
        <span className={ui.secondarySm}>링크 복사</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-xs bg-[#EFEFEB]">
        <div className="h-full w-3/4 bg-[#155E75]" />
      </div>
      <p className="text-[13px] text-[#3D3D38]">12명 중 9명 제출</p>
      <p className={ui.help}>미제출: 박민수, 서예린, 신도윤</p>
    </div>
  );
}

/** 앱의 근무표 없음 패널과 같은 순서: 검증된 제안 먼저, 이유는 [왜 만들 수 없나요?]를 펼친 모양으로 아래에. */
function BlockedFragment() {
  return (
    <div className="flex flex-col gap-3.5 rounded-lg border border-[#E8B4AE] bg-white px-[18px] py-4">
      <div className="flex items-center gap-2">
        <span className={`${ui.badge} ${ui.badgeTone.none}`}>근무표 없음</span>
        <h3 className="text-[13px] font-semibold text-[#1B1B18]">이 조건으로는 근무표를 만들 수 없어요</h3>
      </div>
      <div className="flex flex-col gap-1.5">
        <h4 className="text-[13px] font-semibold text-[#1B1B18]">이렇게 바꾸면 만들 수 있어요</h4>
        <div className={`${ui.card} flex flex-col gap-2.5`}>
          <div className="flex items-center justify-between gap-3">
            <h5 className="text-[13px] font-semibold text-[#1B1B18]">주말 마감 인원 줄이기</h5>
            <span className={`${ui.badge} ${ui.badgeTone.confirmed}`}>검증됨</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-[#1B1B18]">주말 마감 최소 3 → 2</span>
            <span className="text-xs text-[#66665E]">“주말 마감은 3명”</span>
          </div>
          <p className="text-xs text-[#66665E]">
            이렇게 바꾸면 근무표를 만들 수 있어요 · 희망 반영 <span className="font-mono">9/9</span>
          </p>
          <div className="flex justify-end gap-1">
            <span className={ui.textSm}>무시</span>
            <span className={ui.primarySm}>수락</span>
          </div>
        </div>
      </div>
      <div className="border-t border-[#EFEFEB] pt-3">
        <p className="text-[13px] font-semibold text-[#1B1B18]">왜 만들 수 없나요?</p>
        <p className={`mt-1.5 ${body}`}>토요일 마감에 들어올 수 있는 사람이 2명뿐인데, 주말 마감은 3명이 필요해요.</p>
      </div>
    </div>
  );
}

const PAIRS = [
  {
    title: "가능 시간 모으기",
    before: ["저 화·목 오후만 돼요", "이번 주는 토요일 빼 주세요", "아까 말한 시간 바뀌었어요!"],
    after: <LinkFragment />,
  },
  {
    title: "머릿속 규칙",
    before: ["마감 다음 날 오픈은 안 됨", "5일 넘게 연속은 힘들다고 했지", "오픈엔 리더 한 명… 또 뭐였더라"],
    after: <ReplyCard title="최대 연속 근무" quote="5일 넘게 연속으로 일하지 않게" reading="연속 근무 5일까지" />,
  },
  {
    title: "막힘",
    before: ["토요일 마감이 또 안 채워져요", "어디부터 바꿔야 하지?"],
    after: <BlockedFragment />,
  },
];

const MORE_PAINS = [
  { title: "“왜 나만 주말이 많아요?”", body: "직원마다 근무 수, 주말·공휴일 근무, 최근 4주 마감을 보여 줘요. 근거를 대기 쉬워요." },
  { title: "확정 뒤에 생긴 병가", body: "확정한 근무표에서 최소한의 칸만 바꾸고 바뀐 칸을 표시해요. 이미 지난 날은 건드리지 않아요." },
  { title: "다음 근무표로 이어받기", body: "명단과 매장 조건은 그대로 남아요. 지난 근무 마지막 며칠도 다음 근무표가 이어받아요." },
];

// 미니 캘린더에 칠한 시간(칸 번호). 요일마다 [시작, 끝)
const PAINTED = [[0, 6], [3, 10], [0, 0], [2, 8], [4, 10], [0, 10], [0, 0]];

function CalendarFragment() {
  return (
    <div className={`${ui.card} grid grid-cols-7 gap-1`}>
      {["월", "화", "수", "목", "금", "토", "일"].map((w, i) => (
        <div key={w} className="flex flex-col gap-px">
          <span className="pb-1 text-center font-mono text-[11px] text-[#66665E]">{w}</span>
          {Array.from({ length: 10 }, (_, slot) => (
            <span key={slot} className={`h-3 ${slot >= PAINTED[i][0] && slot < PAINTED[i][1] ? "bg-[#155E75]" : "bg-[#EFEFEB]"}`} />
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
        <span className="min-w-0 flex-1 truncate text-[15px] text-[#1B1B18]">평일 오픈 2명, 주말은 3명</span>
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
  const item = "flex flex-col gap-1 border-[#E2E2DC] px-5 py-3.5 max-lg:border-b max-lg:last:border-b-0 lg:border-r lg:last:border-r-0";
  const label = "text-xs font-medium text-[#66665E]";
  return (
    <div className="flex flex-col rounded-lg border border-[#E2E2DC] bg-white lg:flex-row lg:items-stretch">
      <div className={item}>
        <span className={label}>결과</span>
        <span className="flex h-7 items-center">
          <span className={`${ui.badge} ${ui.badgeTone.applied}`}>반드시 규칙을 모두 지켰어요</span>
        </span>
      </div>
      <div className={item}>
        <span className={label}>희망 반영</span>
        <span className={`${ui.bigNumber} text-[#1B1B18]`}>9/9</span>
      </div>
      <div className={item}>
        <span className={label}>못 지킨 가능하면 규칙</span>
        <span className={`${ui.bigNumber} text-[#A15C07]`}>0</span>
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: "가능 시간 링크",
    body: "단체 대화방에 링크 하나만 올리면, 직원이 자기 이름을 골라 일할 수 있는 시간을 칠해요.",
    fragment: <CalendarFragment />,
  },
  {
    title: "말로 매장 조건",
    body: "필요 인원과 규칙을 평소 말투로 적으면 카드로 정리돼요. [적용]을 눌러야 반영돼요.",
    fragment: <BarFragment />,
  },
  {
    title: "근무표 만들기",
    body: "버튼 하나로 근무표를 만들어요. 막히면 어떤 규칙끼리 부딪히는지 설명하고, 실제로 근무표가 나오는 해결책만 보여 줘요.",
    fragment: <SummaryFragment />,
  },
  {
    title: "확정과 최소 변경",
    body: "확정하면 직원 링크가 잠겨요. 병가가 생기면 말로 적어 주세요. 바뀌는 칸을 최소로 줄여 다시 만들어요.",
    fragment: <ChangeFragment />,
  },
];

type Actor = "사람" | "LLM" | "솔버";

/** 만든 방식의 세 장면. 근무표에 들어가는 길은 세 곳(적용·확정·수락)이고, 셋 다 사람이 연다. */
const SCENES: { title: string; body: string; actors: [Actor, string][]; fragment: ReactNode }[] = [
  {
    title: "말은 LLM이 읽어요",
    body: "매니저의 말을 규칙 식으로 세우고 “이렇게 읽었어요”로 되돌려 줘요. 식이 검증을 통과하지 못하면 카드 대신 되물어요. [적용]을 누르기 전에는 아무것도 반영되지 않아요.",
    actors: [
      ["LLM", "읽어요"],
      ["사람", "적용해요"],
    ],
    fragment: <ReplyCard title="금지 순서" quote="마감 다음 날 오픈은 안 되게" reading="모든 사람 · 매일 · 마감 다음 날 오픈 금지" pending />,
  },
  {
    title: "계산은 솔버가 해요",
    body: "OR-Tools CP-SAT 솔버가 규칙 식만 받아, 모두 지키는 근무표를 찾거나 없다는 것을 증명해요. LLM은 근무표의 칸을 하나도 채우지 않아요. 확정하면 직원 링크가 잠겨요.",
    actors: [
      ["솔버", "계산하고 증명해요"],
      ["사람", "확정해요"],
    ],
    fragment: <ScheduleFragment />,
  },
  {
    title: "막히면 셋이 함께 풀어요",
    body: "솔버가 “없다”고 증명하면, LLM이 어떤 규칙끼리 부딪히는지 설명하고 바꿀 곳을 제안해요. 제안은 솔버가 다시 풀어 실제로 근무표가 나오는 것만 남겨요. 그중에서 고르는 건 사람이에요.",
    actors: [
      ["LLM", "설명·제안"],
      ["솔버", "다시 풀어 검증"],
      ["사람", "수락해요"],
    ],
    fragment: <BlockedFragment />,
  },
];

/** 행위자 칩. 사람만 강조색 면: 결정하는 자리라는 뜻. */
function ActorChip({ actor }: { actor: Actor }) {
  return <span className={`${ui.badge} ${actor === "사람" ? "bg-[#155E75] text-white" : ui.badgeTone.draft}`}>{actor}</span>;
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[#E2E2DC]">
        <div className={`${container} flex h-[60px] items-center justify-between`}>
          <Link href="/" aria-label={`${PRODUCT_NAME} 홈`} className="inline-flex items-center gap-2 text-[19px] font-bold tracking-[-0.02em] text-[#1B1B18]">
            <Mark size={24} />
            {PRODUCT_NAME}
          </Link>
          <nav className="flex items-center gap-1">
            <a href={REPO_URL} className={ui.text}>
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className={`${container} grid grid-cols-1 gap-10 py-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14 lg:py-[88px]`}>
          <div className="flex flex-col gap-6">
            <p className={ui.eyebrow}>카페·음식점 매니저를 위한 근무표</p>
            <h1 className="text-[34px] leading-[1.15] font-bold tracking-[-0.03em] break-keep text-[#1B1B18] lg:text-[42px] xl:text-[48px]">
              매장 조건은 말로,
              <br />
              근무표는 버튼 하나로
            </h1>
            <p className="text-[17px] leading-relaxed text-[#3D3D38]">
              직원은 링크로 가능 시간을 칠하고, 매니저는 매장 조건을 말로 적어요. 막히면 이유와 해결책을 알려 드려요.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/app" className={ui.primaryXl}>
                내 매장으로 시작하기
              </Link>
              <DemoVideoButton className={ui.secondaryXl}>데모 영상</DemoVideoButton>
            </div>
            <p className={ui.help}>내 매장은 Google 로그인으로 시작해요. 데모 영상은 2분, 로그인 없이 볼 수 있어요.</p>
          </div>
          <HeroSequence />
        </section>

        <section className={section}>
          <div className={`${container} flex flex-col gap-12`}>
            <SectionHead eyebrow="01 · 문제" title="메신저와 엑셀, 머릿속 규칙으로 짜고 있어요">
              가능 시간을 옮겨 적고, 규칙을 떠올리고, 어디서 막히는지 찾느라 시간이 가요.
            </SectionHead>
            <div className="flex flex-col gap-10">
              {PAIRS.map((p) => (
                <div key={p.title} className="flex flex-col gap-3">
                  <h3 className="text-[15px] font-semibold text-[#1B1B18]">{p.title}</h3>
                  <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)] lg:gap-0">
                    <Before lines={p.before} />
                    <Arrow />
                    <After>{p.after}</After>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
              {MORE_PAINS.map((p) => (
                <div key={p.title} className="flex flex-col gap-2 border-l border-[#C9C9C1] pl-5">
                  <h3 className="text-[15px] font-semibold text-[#1B1B18]">{p.title}</h3>
                  <p className={body}>{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={section}>
          <div className={`${container} flex flex-col gap-12`}>
            <SectionHead eyebrow="02 · 동작 방식" title="링크 하나, 말 한 줄, 버튼 하나">
              근무표마다 같은 순서예요. 한 번 적은 매장 조건은 다음 근무표에도 그대로 써요.
            </SectionHead>
            <ol className="flex flex-col gap-12">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-x-4 gap-y-5 lg:grid-cols-[96px_minmax(0,5fr)_minmax(0,6fr)] lg:gap-x-8 lg:gap-y-0">
                  <span className="font-mono text-[36px] leading-none font-semibold text-[#155E75] lg:text-[48px]">{i + 1}</span>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-[20px] font-semibold text-[#1B1B18]">{s.title}</h3>
                    <p className={body}>{s.body}</p>
                  </div>
                  <div className="col-span-2 lg:col-span-1">{s.fragment}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={section}>
          <div className={`${container} flex flex-col gap-8`}>
            <SectionHead eyebrow="03 · 만든 방식" title="말은 LLM이, 계산은 솔버가, 결정은 사람이">
              근무표에 들어가는 길은 세 곳뿐이고, 셋 다 사람이 버튼을 눌러야 열려요. LLM이 낸 것은 사람이 확인하거나 서버가 다시 풀어 검증한 것만 반영돼요.
            </SectionHead>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-3 lg:items-start lg:gap-8">
              {SCENES.map((s) => (
                <div key={s.title} className="flex flex-col gap-5">
                  {s.fragment}
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.actors.map(([actor, verb], i) => (
                        <span key={actor} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-[13px] text-[#8A8A80]">→</span>}
                          <ActorChip actor={actor} />
                          <span className="text-[13px] text-[#3D3D38]">{verb}</span>
                        </span>
                      ))}
                    </div>
                    <h3 className="text-[20px] font-semibold text-[#1B1B18]">{s.title}</h3>
                    <p className={body}>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className={`${ui.card} flex items-center gap-5`}>
                <span className="font-mono text-[40px] leading-none font-semibold text-[#155E75]">99%</span>
                <div className="flex flex-col gap-0.5">
                  <span className={ui.cardTitle}>번역 정확도</span>
                  <span className={ui.help}>매니저 말투 문장 100개 기준</span>
                </div>
              </div>
              <a href={REPO_URL} className={ui.text}>
                GitHub에서 자세히 보기
              </a>
            </div>
          </div>
        </section>

        <section className="bg-[#155E75] py-14 lg:py-[72px]">
          <div className={`${container} flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-10`}>
            <div className="flex flex-col gap-3">
              <h2 className="text-[26px] leading-[1.25] font-semibold tracking-[-0.02em] text-white lg:text-[32px]">
                직원 명단만 넣으면
                <br />첫 근무표를 시작할 수 있어요
              </h2>
              <p className="text-base text-[#CFE4EA]">Google 로그인으로 시작해요. 영상은 로그인 없이 볼 수 있어요.</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href="/app"
                className="inline-flex h-12 items-center rounded-md border border-white bg-white px-[22px] text-[15px] font-medium text-[#155E75] transition-colors duration-[120ms] hover:bg-[#E3F0F3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                내 매장으로 시작하기
              </Link>
              <DemoVideoButton className="inline-flex h-12 items-center rounded-md border border-white px-[22px] text-[15px] font-medium text-white transition-colors duration-[120ms] hover:bg-[#0E4A5C] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                데모 영상
              </DemoVideoButton>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className={`${container} flex flex-col gap-3 py-8 text-xs font-medium text-[#66665E] lg:flex-row lg:items-center lg:justify-between`}>
          <span className="flex items-center gap-2">
            <Mark size={18} tone="muted" />
            {PRODUCT_NAME} · 포트폴리오 프로토타입
          </span>
          <span className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-[#1B1B18]">
              개인정보처리방침
            </Link>
            <a href={REPO_URL} className="hover:text-[#1B1B18]">
              GitHub
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
