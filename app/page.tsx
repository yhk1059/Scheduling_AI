import type { ReactNode } from "react";

import Link from "next/link";

import DemoVideoButton from "@/components/DemoVideo";
import HeroSequence, { ChangeFragment, ReplyCard } from "@/components/HeroSequence";
import { ui } from "@/components/ui";
import { Mark } from "@/components/Wordmark";
import { PRODUCT_NAME } from "@/lib/product";

// 저장소를 옮기면 이 한 줄만 바꾼다.
const REPO_URL = "https://github.com/yhk1059/harness_framework";

const container = "mx-auto w-full max-w-[1360px] px-10";
const section = "border-t border-[#E2E2DC] py-24";
const sectionTitle = "text-[32px] leading-[1.25] font-semibold tracking-[-0.02em] text-[#1B1B18]";
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
    <div className="flex flex-col items-start gap-2 rounded-lg bg-[#EFEFEB] p-5">
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
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 self-center justify-self-center text-[#66665E]" fill="none" stroke="currentColor" strokeWidth={1.8}>
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

function BlockedFragment() {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-[#E8B4AE] bg-white px-[18px] py-4">
      <div className="flex items-center gap-2">
        <span className={`${ui.badge} ${ui.badgeTone.none}`}>근무표 없음</span>
        <h3 className="text-[13px] font-semibold text-[#1B1B18]">이 조건으로는 근무표를 만들 수 없어요</h3>
      </div>
      <p className={body}>토요일 마감에 들어올 수 있는 사람이 필요 인원보다 적어요.</p>
      <div className={`${ui.card} flex flex-col gap-2`}>
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-[13px] font-semibold text-[#1B1B18]">토요일 마감 인원 줄이기</h4>
          <span className={`${ui.badge} ${ui.badgeTone.confirmed}`}>검증됨</span>
        </div>
        <p className="text-sm font-medium text-[#1B1B18]">토요일 마감 인원 3 → 2</p>
        <p className="text-xs text-[#66665E]">이렇게 바꾸면 근무표를 만들 수 있어요</p>
        <div className="flex justify-end gap-1">
          <span className={ui.textSm}>무시</span>
          <span className={ui.primarySm}>수락</span>
        </div>
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
  const item = "flex flex-col gap-1 border-r border-[#E2E2DC] px-5 py-3.5 last:border-r-0";
  const label = "text-xs font-medium text-[#66665E]";
  return (
    <div className="flex items-stretch rounded-lg border border-[#E2E2DC] bg-white">
      <div className={item}>
        <span className={label}>결과</span>
        <span className="flex h-7 items-center">
          <span className={`${ui.badge} ${ui.badgeTone.applied}`}>규칙을 모두 지켰어요</span>
        </span>
      </div>
      <div className={item}>
        <span className={label}>희망 반영</span>
        <span className={`${ui.bigNumber} text-[#1B1B18]`}>9/9</span>
      </div>
      <div className={item}>
        <span className={label}>못 지킨 규칙</span>
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
    title: "근무표 만들기와 막힌 이유",
    body: "버튼 하나로 근무표를 만들어요. 막히면 어떤 규칙끼리 부딪히는지 설명하고, 실제로 근무표가 나오는 해결책만 보여 줘요.",
    fragment: <SummaryFragment />,
  },
  {
    title: "확정과 최소 변경",
    body: "확정하면 직원 링크가 잠겨요. 병가가 생기면 말로 적어 주세요. 바뀌는 칸을 최소로 줄여 다시 만들어요.",
    fragment: <ChangeFragment />,
  },
];

const BUILT = [
  { title: "말은 LLM이", body: "매니저의 말을 규칙 식으로 세우고 막힌 이유를 설명해요. 근무를 직접 배정하지 않아요." },
  { title: "계산은 솔버가", body: "OR-Tools CP-SAT 솔버가 규칙을 모두 지키는 근무표를 찾거나, 없다는 것을 증명해요." },
  { title: "검증은 재풀이로", body: "해결책은 실제로 다시 풀어 근무표가 나오는 것만 보여 줘요. 규칙은 사람이 [적용]해야 반영돼요." },
];

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
        <section className={`${container} grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center gap-14 py-[88px]`}>
          <div className="flex flex-col gap-6">
            <p className={ui.eyebrow}>{PRODUCT_NAME} · 매장 직원 근무표</p>
            <h1 className="text-[30px] leading-[1.15] font-bold tracking-[-0.03em] break-keep text-[#1B1B18] xl:text-[38px]">
              복잡한 근무표,
              <br />
              이제 {PRODUCT_NAME}에게 맡기세요
            </h1>
            <p className="text-base leading-relaxed text-[#3D3D38]">
              직원은 링크로 가능 시간을 칠하고, 매니저는 매장 조건을 말로 적어요. 막히면 이유와 해결책을 알려 드려요.
            </p>
            <div className="flex items-center gap-2">
              <DemoVideoButton className={ui.secondaryXl}>데모 영상</DemoVideoButton>
              <Link href="/app" className={ui.primaryXl}>
                내 매장으로 시작하기
              </Link>
            </div>
            <p className={ui.help}>1분짜리 실제 화면이에요. 로그인 없이 볼 수 있어요.</p>
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
                  <div className="grid grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)]">
                    <Before lines={p.before} />
                    <Arrow />
                    <After>{p.after}</After>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-8">
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
                <li key={s.title} className="grid grid-cols-[96px_minmax(0,5fr)_minmax(0,6fr)] items-start gap-x-8">
                  <span className="font-mono text-[48px] leading-none font-semibold text-[#155E75]">{i + 1}</span>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-[20px] font-semibold text-[#1B1B18]">{s.title}</h3>
                    <p className={body}>{s.body}</p>
                  </div>
                  {s.fragment}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={section}>
          <div className={`${container} flex flex-col gap-8`}>
            <SectionHead eyebrow="03 · 만든 방식" title="말은 LLM이, 계산은 솔버가">
              LLM이 낸 결과는 사람이 확인하거나 서버가 다시 풀어 검증한 것만 근무표에 들어가요.
            </SectionHead>
            <div className="grid grid-cols-3 gap-5">
              {BUILT.map((b) => (
                <div key={b.title} className={`${ui.card} flex flex-col gap-2`}>
                  <h3 className={ui.cardTitle}>{b.title}</h3>
                  <p className={body}>{b.body}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-6">
              <p className="font-mono text-[13px] text-[#3D3D38]">번역 정확도 [__%] · 매니저 말투 문장 [__개]</p>
              <a href={REPO_URL} className={ui.text}>
                GitHub에서 자세히 보기
              </a>
            </div>
          </div>
        </section>

        <section className="bg-[#155E75] py-[72px]">
          <div className={`${container} flex items-center justify-between gap-10`}>
            <div className="flex flex-col gap-3">
              <h2 className="text-[32px] leading-[1.25] font-semibold tracking-[-0.02em] text-white">
                직원 명단만 넣으면
                <br />첫 근무표를 시작할 수 있어요
              </h2>
              <p className="text-base text-[#CFE4EA]">영상은 로그인 없이 볼 수 있어요.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
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
        <div className={`${container} flex items-center justify-between py-8 text-xs font-medium text-[#66665E]`}>
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
