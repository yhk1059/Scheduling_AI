import type { ReactNode } from "react";

import type { Metadata } from "next";
import Link from "next/link";

import { ReplyCard, ScheduleFragment } from "@/components/HeroSequence";
import { LandingFooter, REPO_URL, SectionHead, body, container, section } from "@/components/landing";
import { ui } from "@/components/ui";
import Wordmark from "@/components/Wordmark";

export const metadata: Metadata = {
  title: "만든 방식",
};

const EVAL_URL = `${REPO_URL}/blob/main/eval/results.md`;

type Actor = "사람" | "AI" | "계산 엔진";

/** 행위자 칩. 사람만 강조색 면: 결정하는 자리라는 뜻. */
function ActorChip({ actor }: { actor: Actor }) {
  return <span className={`${ui.badge} shrink-0 whitespace-nowrap ${actor === "사람" ? "bg-[#C4247C] text-white" : ui.badgeTone.draft}`}>{actor}</span>;
}

/** 앱의 근무표 없음 패널과 같은 순서: 검증된 제안 먼저, 이유는 [왜 만들 수 없나요?]를 펼친 모양으로 아래에. */
function BlockedFragment() {
  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-[#FECDCA] bg-white px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${ui.badge} ${ui.badgeTone.none} whitespace-nowrap`}>근무표 없음</span>
        <h3 className="text-[13px] font-semibold text-[#111214]">이 조건으로는 근무표를 만들 수 없어요</h3>
      </div>
      <div className="flex flex-col gap-1.5">
        <h4 className="text-[13px] font-semibold text-[#111214]">이렇게 바꾸면 만들 수 있어요</h4>
        <div className={`${ui.card} flex flex-col gap-2.5`}>
          <div className="flex items-center justify-between gap-3">
            <h5 className="text-[13px] font-semibold text-[#111214]">주말 마감 인원 줄이기</h5>
            <span className={`${ui.badge} ${ui.badgeTone.confirmed} shrink-0`}>검증됨</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-[#111214]">주말 마감 최소 3 → 2</span>
            <span className="text-xs text-[#6B6F78]">“주말 마감은 3명”</span>
          </div>
          <p className="text-xs text-[#6B6F78]">
            이렇게 바꾸면 근무표를 만들 수 있어요 · 희망 반영 <span className="font-mono">9/9</span>
          </p>
          <div className="flex justify-end gap-1">
            <span className={ui.textSm}>무시</span>
            <span className={ui.primarySm}>수락</span>
          </div>
        </div>
      </div>
      <div className="border-t border-[#F5F5F4] pt-3">
        <p className="text-[13px] font-semibold text-[#111214]">왜 만들 수 없나요?</p>
        <p className={`mt-1.5 ${body}`}>토요일 마감에 들어올 수 있는 사람이 2명뿐인데, 주말 마감은 3명이 필요해요.</p>
      </div>
    </div>
  );
}

const WHY = [
  {
    title: "근무표 계산은 솔버가 해요",
    body: "LLM은 조합 문제에서 조건을 자주 어겨요. OR-Tools CP-SAT 솔버는 조건을 모두 지키는 해를 찾거나, 해가 없다는 것을 증명하고 어떤 조건끼리 부딪히는지 찾아내요. 매장마다 규칙이 달라서, 어떤 규칙이든 선언만 하면 푸는 일반 솔버가 필요했어요.",
  },
  {
    title: "AI는 말과 구조 사이의 번역만 해요",
    body: "Claude가 매니저의 말을 규칙 식(닫힌 JSON 스키마)으로 옮기고, 부딪힌 조건을 쉬운 말로 풀어 줘요. 실행 코드는 만들지 않고, 근무표의 칸도 채우지 않아요.",
  },
  {
    title: "AI를 일부러 쓰지 않은 곳도 있어요",
    body: "직원 가능 시간은 이미 구조화된 입력이라 코드가 바로 규칙으로 바꿔요. 카드 문장과 통계도 결정적인 코드로 만들어요.",
  },
];

/** 근무표에 들어가는 길은 세 곳(적용·확정·수락)이고, 셋 다 사람이 연다. */
const SCENES: { title: string; body: string; actors: [Actor, string][]; fragment: ReactNode }[] = [
  {
    title: "말 → 규칙",
    body: "AI가 매니저의 말을 규칙 식으로 바꾸고, 검증을 통과한 것만 “이렇게 읽었어요” 카드로 보여 줘요. 규칙으로 바꿀 수 없으면 카드 대신 다시 물어봐요.",
    actors: [
      ["AI", "읽어요"],
      ["사람", "적용해요"],
    ],
    fragment: <ReplyCard title="연달아 금지" quote="마감 다음 날 오픈은 안 되게" reading="마감 다음 날에는 오픈을 넣지 않아요" pending />,
  },
  {
    title: "계산",
    body: "계산 엔진이 규칙만 받아 모두 지키는 근무표를 찾거나, 그런 근무표가 없다는 것을 확인해요. AI는 근무표의 칸을 하나도 채우지 않아요.",
    actors: [
      ["계산 엔진", "계산하고 확인해요"],
      ["사람", "확정해요"],
    ],
    fragment: <ScheduleFragment />,
  },
  {
    title: "막혔을 때",
    body: "계산 엔진이 부딪히는 조건을 찾으면, AI가 쉬운 말로 풀고 바꿀 곳을 제안해요. 계산 엔진이 제안마다 다시 풀어 실제로 근무표가 나오는 것만 남기고, 그중에서 고르는 건 사람이에요.",
    actors: [
      ["계산 엔진", "충돌 찾기"],
      ["AI", "설명·제안"],
      ["계산 엔진", "다시 풀어 확인"],
      ["사람", "수락해요"],
    ],
    fragment: <BlockedFragment />,
  },
];

const SAFEGUARDS = [
  "AI 출력은 Pydantic 검증, 참조 무결성 검사, 빈 대상 검사를 통과해야 카드가 돼요.",
  "카드 문장은 AI가 아니라 규칙 식에서 결정적으로 만들고, 샘플 근무표에서 찾은 위반 예시를 함께 보여 줘요.",
  "AI를 호출하기 전에 직원 이름을 가명으로 바꿔요.",
  "API 키와 AI 호출은 서버에만 있고, 서버는 상태를 저장하지 않아요. 데이터베이스는 행 단위 보안(RLS)으로 보호해요.",
];

const LIMITS = [
  "정해 둔 근무조 밖의 시간대는 만들지 않아요.",
  "입력 상한을 꽉 채운 최악 조건에서는 충돌 원인을 최소로 줄이기 전에 시간 예산이 끝나요.",
  "완화 제안을 AI 대신 결정적 탐색으로 만드는 방식과 비교해 볼 계획이에요.",
];

const STACK = ["Next.js", "FastAPI", "OR-Tools CP-SAT", "Claude API", "Supabase"];

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex max-w-[760px] flex-col gap-3">
      {items.map((t) => (
        <li key={t} className={`border-l border-[#DCDCD8] pl-5 ${body}`}>
          {t}
        </li>
      ))}
    </ul>
  );
}

export default function HowPage() {
  return (
    <div className="landing flex flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-[#EDEDEA] bg-white/85 backdrop-blur-xl">
        <div className={`${container} flex min-h-16 flex-wrap items-center justify-between gap-3 py-2`}>
          <Wordmark size="bar" href="/" />
          <nav aria-label="주요 메뉴" className="flex items-center gap-2 sm:gap-4">
            <Link href="/#how" className={`${ui.text} max-sm:hidden`}>사용 방법</Link>
            <Link href="/app" className={ui.primary}>로그인</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="py-16 lg:py-24">
          <div className={container}>
            <SectionHead eyebrow="만든 방식" title="말은 AI가, 계산은 솔버가, 결정은 사람이">
              매니저의 말은 AI가 규칙으로 옮기고, 근무표 계산은 최적화 솔버가 하고, 무엇을 반영할지는 사람이 정해요.
            </SectionHead>
          </div>
        </section>

        <section className={section}>
          <div className={`${container} flex flex-col gap-12`}>
            <SectionHead eyebrow="01 · 역할 나누기" title="왜 이렇게 나눴나">
              잘하는 일에만 쓰고, 정확해야 하는 일은 결정적인 코드에 맡겼어요.
            </SectionHead>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
              {WHY.map((w) => (
                <div key={w.title} className="flex flex-col gap-2 border-l border-[#DCDCD8] pl-5">
                  <h3 className="text-[15px] font-semibold text-[#111214]">{w.title}</h3>
                  <p className={body}>{w.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={section}>
          <div className={`${container} flex flex-col gap-12`}>
            <SectionHead eyebrow="02 · 흐름" title="근무표에 들어가는 길은 세 곳뿐">
              적용, 확정, 수락. 셋 다 사람이 버튼을 눌러야 열려요. AI가 낸 것은 사람이 확인하거나 계산 엔진이 다시 풀어 확인한 것만 반영돼요.
            </SectionHead>
            <div className="grid grid-cols-1 gap-10 xl:grid-cols-3 xl:items-start xl:gap-8">
              {SCENES.map((s) => (
                <div key={s.title} className="flex max-w-[560px] flex-col gap-5 xl:max-w-none">
                  {s.fragment}
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.actors.map(([actor, verb], i) => (
                        <span key={i} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-[13px] text-[#9499A2]">→</span>}
                          <ActorChip actor={actor} />
                          <span className="text-[13px] text-[#4B4F57]">{verb}</span>
                        </span>
                      ))}
                    </div>
                    <h3 className="text-[20px] font-semibold text-[#111214]">{s.title}</h3>
                    <p className={body}>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={section}>
          <div className={`${container} flex flex-col gap-12`}>
            <SectionHead eyebrow="03 · 안전장치" title="AI가 틀려도 바로 반영되지 않게">
              AI 출력은 언제나 검증, 사람의 확인, 재풀이 중 하나를 거쳐요.
            </SectionHead>
            <Bullets items={SAFEGUARDS} />
          </div>
        </section>

        <section className={section}>
          <div className={`${container} flex flex-col gap-12`}>
            <SectionHead eyebrow="04 · 측정" title="숫자로 확인한 것">
              번역 정확도와 솔버 성능을 따로 재요.
            </SectionHead>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
              <div className="flex flex-col gap-3 rounded-2xl border border-[#EDEDEA] bg-white p-6">
                <span className="text-[13px] font-semibold text-[#111214]">말 → 규칙 번역</span>
                <span className="font-mono text-[40px] leading-none font-semibold text-[#C4247C]">99.0%</span>
                <p className={body}>
                  매니저 말투 문장 102개를 의미 기준으로 판정했어요(무작위 근무표에서 위반이 같은지 비교). 실행할 때마다 96~99%가 나와요.
                </p>
                <p className={ui.help}>
                  문장을 직접 작성해서, 실제 매니저 말투로 잰 정확도는 아직 없어요 ·{" "}
                  <a href={EVAL_URL} className="underline underline-offset-2 hover:text-[#111214]">
                    평가 자료 보기(GitHub)
                  </a>
                </p>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl border border-[#EDEDEA] bg-white p-6">
                <span className="text-[13px] font-semibold text-[#111214]">솔버 성능(최악 조건)</span>
                <span className="font-mono text-[40px] leading-none font-semibold text-[#111214]">
                  7.5<span className="text-[20px]">초</span>
                </span>
                <p className={body}>입력 상한을 꽉 채운 매장(직원 40명 × 31일, 근무 코드 8개, 규칙 74개)에서 최적해까지 걸린 시간이에요. 시간 예산은 10초예요.</p>
              </div>
            </div>
          </div>
        </section>

        <section className={section}>
          <div className={`${container} flex flex-col gap-12`}>
            <SectionHead eyebrow="05 · 한계" title="아직 못 하는 것과 다음 과제">
              알고 있는 한계를 그대로 적어요.
            </SectionHead>
            <Bullets items={LIMITS} />
          </div>
        </section>

        <section className={section}>
          <div className={`${container} flex flex-col gap-6`}>
            <p className={ui.eyebrow}>06 · 기술 스택</p>
            <div className="flex flex-wrap items-center gap-2">
              {STACK.map((t) => (
                <span key={t} className={ui.chip}>
                  {t}
                </span>
              ))}
              <a href={REPO_URL} className={`${ui.text} ml-2`}>
                GitHub에서 코드 보기
              </a>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
