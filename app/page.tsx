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
  { pain: "규칙이 머릿속에만 있다", fix: "말로 적은 규칙이 규칙 카드가 됩니다. 원문과 해석 결과를 나란히 보고 [적용]합니다." },
  {
    pain: "요청이 다 안 들어가는데 어디서 막히는지 모른다",
    fix: "충돌하는 규칙을 찾아 설명하고, 재풀이로 해가 나오는 것이 확인된 완화 제안만 보여줍니다.",
  },
  { pain: "확정 후 병가가 생기면 전체를 다시 짠다", fix: "확정본과 최소한으로 달라지게 다시 짜고, 바뀐 칸을 표시합니다." },
  { pain: "“왜 나만 주말이 많아요?”에 근거를 대기 어렵다", fix: "개인별 D/E/N/O, 주말·공휴일 근무, 최대 연속 근무, 평균 대비 편차를 보여줍니다." },
];

const STEPS = [
  {
    title: "말로 규칙 입력",
    body: "“나이트 다음 날은 무조건 쉬게”처럼 평소 말투로 적으면, LLM이 정해진 템플릿 12개 중 하나로 번역해 카드로 제안합니다. 모호하면 되묻고, 지원하지 않는 규칙이면 그렇다고 알려줍니다.",
  },
  {
    title: "솔버가 생성",
    body: "적용된 규칙과 이달 요청으로 CP-SAT 솔버가 한 달 근무표를 풉니다. hard 규칙은 반드시 지키고, soft 규칙은 위반을 최소화합니다.",
  },
  {
    title: "막히면 이유와 검증된 해결책",
    body: "해가 없으면 충돌하는 규칙을 찾아 원인을 설명합니다. 완화 제안은 서버가 다시 풀어 해가 나오는 것만 보여주고, [수락]해야 반영됩니다.",
  },
];

const DESIGN = [
  {
    title: "LLM은 번역과 설명만",
    body: "자연어를 제약 스펙(템플릿 type + params)으로 번역하고 충돌 원인을 설명합니다. 코드를 만들거나 근무를 직접 배정하지 않습니다.",
  },
  {
    title: "계산은 CP-SAT",
    body: "OR-Tools CP-SAT가 근무표를 풀고, 해가 없음을 증명하고, 충돌하는 제약 집합을 찾습니다. 모든 풀이에 시간 제한을 겁니다.",
  },
  {
    title: "LLM 출력 검증 장치",
    body: "Pydantic 스키마와 참조 무결성 검사를 통과해야 쓰고(실패 시 최대 2회 재시도), 사람이 [적용]하거나 서버가 재풀이로 검증한 것만 근무표에 반영됩니다. 이름은 가명으로 바꿔 보냅니다.",
  },
];

// eval/results.md 최종 실행(3회차) 값 그대로.
const EVAL_ROWS = [
  ["케이스 수", "44"],
  ["스키마 유효율", "100.0%"],
  ["status 정확도", "100.0%"],
  ["제약 F1", "100.0%"],
  ["케이스 완전 일치율", "100.0%"],
  ["평균 재시도 횟수", "0.00"],
  ["평균 지연(초)", "1.95"],
  ["p95 지연(초)", "2.76"],
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
          <p className={eyebrow}>간호사 근무표 · LLM + CP-SAT</p>
          <h1 className="text-[42px] leading-[1.3] font-semibold tracking-[-0.02em] text-[#1B1B18]">
            말로 설명한 규칙으로
            <br />한 달 근무표를 짭니다
          </h1>
          <p className="text-[15px] leading-relaxed text-[#3D3D38]">
            수간호사가 평소 말투로 규칙과 요청을 적으면 LLM이 규칙 카드로 번역하고, CP-SAT 솔버가 3교대 근무표를 풉니다. 막히면 이유와
            검증된 해결책을 보여줍니다.
          </p>
          <div className="flex items-center gap-2">
            <Link
              href="/app"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-[#155E75] bg-[#155E75] px-[18px] text-[15px] font-medium text-white transition-colors duration-[120ms] hover:bg-[#0E4A5C]"
            >
              데모 시작
            </Link>
            <a
              href={REPO_URL}
              className="inline-flex h-11 items-center gap-2 rounded-md border border-[#C9C9C1] bg-white px-[18px] text-[15px] font-medium text-[#1B1B18] transition-colors duration-[120ms] hover:bg-[#EFEFEB]"
            >
              GitHub
            </a>
          </div>
          <p className="text-xs font-medium text-[#66665E]">로그인 없이 샘플 병동(15명)으로 바로 써 볼 수 있습니다.</p>
        </div>
        <LandingPreview />
      </section>

      <section className={section}>
        <div className="flex flex-col gap-2">
          <p className={eyebrow}>01 · 문제</p>
          <h2 className={h2}>매달 엑셀과 머릿속 규칙으로 며칠씩 걸립니다</h2>
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
          <h2 className={h2}>입력은 말로, 계산은 솔버가</h2>
        </div>
        <ol className="mt-8 grid grid-cols-3 gap-4">
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
          <h2 className={h2}>규칙 입력부터 월중 재스케줄까지</h2>
        </div>
        <div className="mt-8">
          {HAS_DEMO_GIF ? (
            <Image
              src="/demo.gif"
              alt="규칙 입력, 근무표 생성, 충돌 해결, 재스케줄 데모"
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
          <p className={eyebrow}>04 · 설계 요약</p>
          <h2 className={h2}>LLM이 잘하는 일에만 LLM을 씁니다</h2>
        </div>
        <div className="mt-8 grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-4">
          <div className="flex flex-col gap-4">
            {DESIGN.map((d) => (
              <div key={d.title} className={`${card} flex flex-col gap-2`}>
                <h3 className="text-[15px] font-semibold text-[#1B1B18]">{d.title}</h3>
                <p className={body}>{d.body}</p>
              </div>
            ))}
          </div>
          <div className={`${card} flex flex-col gap-3`}>
            <h3 className="text-[15px] font-semibold text-[#1B1B18]">번역 정확도 eval</h3>
            <p className={body}>
              수간호사 말투 문장 44개(규칙, 이달 요청, 되묻기, 미지원)를 실제 API로 번역해 기대 제약과 비교했습니다. 모델{" "}
              <span className="font-mono text-[13px]">claude-sonnet-5-5</span>, 3회차 실행 결과입니다.
            </p>
            <table className="w-full text-sm">
              <tbody>
                {EVAL_ROWS.map(([k, v]) => (
                  <tr key={k} className="border-t border-[#EFEFEB]">
                    <td className="py-2 text-xs font-medium text-[#66665E]">{k}</td>
                    <td className="py-2 text-right font-mono text-[13px] font-medium text-[#1B1B18]">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs font-medium text-[#66665E]">
              1회차 0%(API가 강제 tool_choice 거절) → 2회차 F1 97.9% → 프롬프트 지시 1줄 추가 후 3회차 100%. 데이터셋 기대값은 고치지 않았습니다.
            </p>
          </div>
        </div>
      </section>

      <footer className="flex items-center justify-between border-t border-[#E2E2DC] py-8 text-xs font-medium text-[#66665E]">
        <span>간호사 근무표 · 포트폴리오 프로토타입</span>
        <a href={REPO_URL} className="text-[#155E75] hover:text-[#0E4A5C]">
          GitHub 저장소
        </a>
      </footer>
    </main>
  );
}
