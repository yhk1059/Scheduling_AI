import { existsSync } from "node:fs";
import path from "node:path";

import Image from "next/image";
import Link from "next/link";

import LandingPreview from "@/components/LandingPreview";

// 저장소를 옮기면 이 한 줄만 바꾼다.
const REPO_URL = "https://github.com/yhk1059/harness_framework";

// 빌드 시점에 public/demo.gif가 있으면 보여주고, 없으면 자리표시를 둔다.
const HAS_DEMO_GIF = existsSync(path.join(process.cwd(), "public", "demo.gif"));

const PAINS = [
  { pain: "규칙이 머릿속에만 있다", fix: "평소 말투로 적은 규칙이 카드로 정리됩니다. 원문과 읽은 내용을 나란히 보고 [적용]을 눌러야 반영돼요." },
  {
    pain: "요청이 다 안 들어가는데 어디서 막히는지 모른다",
    fix: "함께 지킬 수 없는 규칙을 찾아 이유를 알려 줍니다. 해결책은 실제로 근무표가 만들어지는 것만 보여 드려요.",
  },
  { pain: "확정 후 병가가 생기면 전체를 다시 짠다", fix: "확정한 근무표에서 최소한의 칸만 바꿔 다시 만들고, 바뀐 칸을 표시합니다. 이미 지난 날은 건드리지 않아요." },
  { pain: "“왜 나만 주말이 많아요?”에 근거를 대기 어렵다", fix: "간호사마다 데이·이브닝·나이트·휴무 수, 주말·공휴일 근무, 평균보다 많은 근무일을 보여 줍니다." },
  {
    pain: "매번 명단, 규칙, 지난 근무를 다시 옮겨 적는다",
    fix: "병동 명단과 규칙은 그대로 남고, 지난 근무표의 마지막 며칠을 다음 근무표가 이어받습니다.",
  },
  {
    pain: "지난번에 나이트를 많이 한 사람을 배려하기 어렵다",
    fix: "최근 4주 나이트와 주말 근무를 보고, 많이 한 사람은 이번 근무표에서 줄여 줍니다.",
  },
];

const STEPS = [
  {
    title: "말로 규칙 적기",
    body: "“나이트 다음 날은 무조건 쉬게”처럼 평소 말투로 적으면 규칙 카드로 정리됩니다. 애매하면 되묻고, 아직 못 하는 규칙이면 그렇다고 알려 드려요.",
  },
  {
    title: "근무표 만들기",
    body: "적용한 규칙과 요청으로 근무표를 만듭니다. ‘반드시’ 규칙은 꼭 지키고, ‘가능하면’ 규칙은 최대한 지켜요.",
  },
  {
    title: "막히면 이유와 해결책",
    body: "모든 규칙을 지키는 근무표가 없으면 어떤 규칙끼리 부딪히는지 설명하고, 근무표가 만들어지는 해결책만 골라 보여 드립니다. [수락]해야 반영돼요.",
  },
  {
    title: "다음 근무표로 이어짐",
    body: "다음 근무표를 만들면 날짜와 지난 근무 마지막 며칠이 자동으로 채워지고, 최근 4주 나이트를 많이 한 사람을 배려합니다.",
  },
];

const h2 = "text-[26px] leading-[1.35] font-semibold tracking-[-0.01em] text-[#1B1B18]";
const eyebrow = "font-mono text-xs font-semibold text-[#155E75]";
const section = "border-t border-[#E2E2DC] py-[72px]";
const body = "text-sm leading-relaxed text-[#3D3D38]";
const card = "rounded-lg border border-[#E2E2DC] bg-white px-[18px] py-4";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[1360px] px-8">
      <section className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center gap-12 py-[72px]">
        <div className="flex flex-col gap-5">
          <p className={eyebrow}>간호사 근무표</p>
          <h1 className="text-[42px] leading-[1.3] font-semibold tracking-[-0.02em] text-[#1B1B18]">
            말로 설명한 규칙으로
            <br />근무표를 짭니다
          </h1>
          <p className="text-[15px] leading-relaxed text-[#3D3D38]">
            평소 말투로 규칙과 요청을 적으면 3교대 근무표가 나옵니다. 막히면 이유와 해결책을 알려 드리고, 다음 근무표는 지난 근무를
            이어받아 만들어요.
          </p>
          <div className="flex items-center gap-2">
            <Link
              href="/app?start=sample"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-[#155E75] bg-[#155E75] px-[18px] text-[15px] font-medium text-white transition-colors duration-[120ms] hover:bg-[#0E4A5C]"
            >
              샘플로 체험하기
            </Link>
            <Link
              href="/app?start=new"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-[#C9C9C1] bg-white px-[18px] text-[15px] font-medium text-[#1B1B18] transition-colors duration-[120ms] hover:bg-[#EFEFEB]"
            >
              내 병동으로 시작하기
            </Link>
            <a href={REPO_URL} className="px-2 text-sm font-medium text-[#155E75] hover:text-[#0E4A5C]">
              GitHub
            </a>
          </div>
          <p className="text-xs font-medium text-[#66665E]">
            로그인 없이 바로 써 볼 수 있어요. 샘플 병동에는 간호사 15명과 이번 달 근무표가 들어 있어요.
          </p>
        </div>
        <LandingPreview />
      </section>

      <section className={section}>
        <div className="flex flex-col gap-2">
          <p className={eyebrow}>01 · 문제</p>
          <h2 className={h2}>매번 엑셀과 머릿속 규칙으로 며칠씩 걸립니다</h2>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4">
          {PAINS.map((p) => (
            <div key={p.pain} className={`${card} flex flex-col gap-2`}>
              <h3 className="text-[15px] font-semibold text-[#1B1B18]">{p.pain}</h3>
              <p className={body}>{p.fix}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={section}>
        <div className="flex flex-col gap-2">
          <p className={eyebrow}>02 · 동작 방식</p>
          <h2 className={h2}>말로 적으면 근무표가 나옵니다</h2>
        </div>
        <ol className="mt-8 grid grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className={`${card} flex flex-col gap-2`}>
              <span className="font-mono text-[13px] font-medium text-[#66665E]">{i + 1}</span>
              <h3 className="text-[15px] font-semibold text-[#1B1B18]">{s.title}</h3>
              <p className={body}>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={section}>
        <div className="flex flex-col gap-2">
          <p className={eyebrow}>03 · 데모</p>
          <h2 className={h2}>규칙 입력부터 확정 후 변경까지</h2>
        </div>
        <div className="mt-8">
          {HAS_DEMO_GIF ? (
            <Image
              src="/demo.gif"
              alt="규칙 입력, 근무표 만들기, 막힌 근무표 해결, 확정 후 변경 데모"
              width={1280}
              height={720}
              unoptimized
              className="h-auto w-full rounded-lg border border-[#E2E2DC]"
            />
          ) : (
            <div className="flex h-[360px] w-full items-center justify-center rounded-lg border border-dashed border-[#C9C9C1] bg-white">
              <p className="text-sm font-medium text-[#66665E]">데모 영상 준비 중</p>
            </div>
          )}
        </div>
      </section>

      <section className={section}>
        <div className="flex flex-col gap-2">
          <p className={eyebrow}>04 · 만든 방식</p>
          <h2 className={h2}>말은 LLM이, 계산은 솔버가</h2>
        </div>
        <div className={`${card} mt-8 flex max-w-[760px] flex-col gap-3`}>
          <p className={body}>
            말을 규칙 카드로 바꾸고 막힌 이유를 설명하는 일은 LLM(Claude)이, 근무 배정 계산은 OR-Tools CP-SAT 솔버가 합니다. LLM은 근무를
            직접 배정하지 않고, LLM이 낸 결과는 사람이 [적용]하거나 서버가 다시 계산해 확인한 것만 근무표에 들어갑니다.
          </p>
          <p className={body}>
            번역 정확도: 수간호사 말투 문장 <span className="font-mono text-[13px]">44</span>개로 측정한 제약 F1{" "}
            <span className="font-mono text-[13px]">100.0%</span>(3회차 실행).
          </p>
          <a href={REPO_URL} className="self-start text-sm font-medium text-[#155E75] hover:text-[#0E4A5C]">
            GitHub에서 자세히 보기
          </a>
        </div>
      </section>

      <footer className="flex items-center justify-between border-t border-[#E2E2DC] py-8 text-xs font-medium text-[#66665E]">
        <span>간호사 근무표 · 포트폴리오 프로토타입</span>
        <span className="flex items-center gap-4">
          <Link href="/privacy" className="text-[#155E75] hover:text-[#0E4A5C]">
            개인정보처리방침
          </Link>
          <a href={REPO_URL} className="text-[#155E75] hover:text-[#0E4A5C]">
            GitHub 저장소
          </a>
        </span>
      </footer>
    </main>
  );
}
