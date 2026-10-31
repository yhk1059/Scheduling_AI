"use client";

// 샘플 데모(/demo, ADR-016). 모두에게 같은 보기 전용 화면: 샘플 매장과 미리 풀어 둔 근무표를 정적 렌더한다(store·API 없음).
import Link from "next/link";

import { isWeekendDay, periodEnd } from "@/lib/period";
import demo from "@/lib/samples/demo-schedule.json";
import shop from "@/lib/samples/shop-12.json";
import type { ConstraintSpec, Employee, Period, ScheduleResult, ShopConfig } from "@/lib/types.gen";
import { coverageText, describeRule, presetName, scheduleName, shopRuleCount, unitShort } from "@/lib/wording";

import { ReplyCard } from "./HeroSequence";
import RuleText from "./RuleText";
import { CELL, codeClass, ScheduleGrid } from "./ScheduleStep";
import { ui } from "./ui";
import Wordmark from "./Wordmark";

const CONFIG = shop.config as unknown as ShopConfig;
const EMPLOYEES: Employee[] = shop.employees;
const RULES = shop.constraints as unknown as ConstraintSpec[];
const SHOP_RULES = RULES.filter((r) => presetName(r) !== "필요 인원");
const PERIOD = demo.period as Period;
const RESULT = demo.result as unknown as ScheduleResult;
const isWeekend = (d: number) => isWeekendDay(PERIOD, d, []);
const NO_FIXED = new Map<string, string>();

const HARD_COUNT = SHOP_RULES.filter((r) => r.hardness === "hard").length;
const CLOSINGS = Object.values(RESULT.assignments).map((row) => row.filter((code) => code === "C").length);
const SHIFTS = CONFIG.shifts.filter((s) => !s.parts?.length);
const TEAMS = SHIFTS.filter((s) => s.code !== "O");

/** 샘플의 필요 인원 규칙(cov-{평일|주말}-{코드})에서 표 한 칸을 읽는다. */
function coverageCell(kind: "weekday" | "weekend", code: string): string {
  const rule = shop.constraints.find((r) => r.id === `cov-${kind}-${code}`);
  const values = rule?.values as { min: { value: number }; max?: { value: number } } | undefined;
  return coverageText(values ? { min: values.min.value, max: values.max?.value ?? values.min.value } : null);
}

const metric = "flex flex-col gap-1 border-r border-[#E2E2DC] px-5 py-3.5 last:border-r-0";
const metricLabel = "text-xs font-medium text-[#66665E]";
const metricValue = "font-mono text-xl font-semibold";

export default function SampleDemo() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[#E2E2DC] bg-white">
        <div className="mx-auto flex h-[60px] max-w-[1360px] items-center gap-3 px-10">
          <Wordmark size="bar" href="/" />
          <span aria-hidden="true" className="h-5 w-px bg-[#E2E2DC]" />
          <span className={`${ui.badge} ${ui.badgeTone.base}`}>샘플 데모</span>
          <Link href="/app" className={`${ui.primary} ml-auto`}>
            내 매장으로 시작하기
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 px-10 py-8">
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className={ui.pageTitle}>{shop.name}</h1>
              <span className={`${ui.badge} ${ui.badgeTone.confirmed}`}>확정</span>
            </div>
            <p className="text-sm text-[#3D3D38]">
              직원 {EMPLOYEES.length}명 · 매장 조건 {shopRuleCount(RULES)}개 · {unitShort("4w")} ·{" "}
              <span className="font-mono text-[13px]">
                {PERIOD.start_date} ~ {periodEnd(PERIOD).slice(5)}
              </span>
            </p>
          </div>
          <p className={ui.help}>모두에게 같은 화면이에요. 바꾸거나 저장할 수 없어요.</p>
        </div>

        <section aria-label="요약" className="flex items-stretch rounded-lg border border-[#E2E2DC] bg-white">
          <div className={metric}>
            <span className={metricLabel}>결과</span>
            <span className="flex h-7 items-center">
              <span className={`${ui.badge} ${ui.badgeTone.applied}`}>규칙을 모두 지켰어요</span>
            </span>
          </div>
          <div className={metric}>
            <span className={metricLabel}>반드시 규칙</span>
            <span className={`${metricValue} text-[#1B1B18]`}>
              {HARD_COUNT}/{HARD_COUNT}
            </span>
          </div>
          <div className={metric}>
            <span className={metricLabel}>못 지킨 규칙</span>
            <span className={`${metricValue} text-[#A15C07]`}>{RESULT.summary.soft_violation_count}</span>
          </div>
          <div className={metric}>
            <span className={metricLabel}>마감 횟수 차이</span>
            <span className="flex items-baseline gap-1.5 text-sm text-[#3D3D38]">
              가장 많음 <span className={`${metricValue} text-[#1B1B18]`}>{Math.max(...CLOSINGS)}</span>
              <span aria-hidden="true">·</span>
              가장 적음 <span className={`${metricValue} text-[#1B1B18]`}>{Math.min(...CLOSINGS)}</span>
            </span>
          </div>
        </section>

        <section className={`${ui.card} flex flex-col gap-3`}>
          <div className="flex items-center justify-between gap-6">
            <h2 className={ui.sectionTitle}>{scheduleName(PERIOD, "4w")}</h2>
            <ul className="flex items-center gap-3 text-xs text-[#3D3D38]">
              {SHIFTS.map((s) => (
                <li key={s.code} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={`${CELL} ${codeClass(s.code, false)} h-5! w-[22px]! text-[11px]!`}>
                    {s.code}
                  </span>
                  {s.name}
                  {s.start && s.end && (
                    <span className="font-mono">
                      {s.start.slice(0, 2)}~{s.end.slice(0, 2)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {/* 칸은 readOnly라 눌리지 않는다. inert를 걸면 좁은 화면에서 표 상자를 가로로 스크롤할 수 없다 */}
          <ScheduleGrid
            config={CONFIG}
            rows={EMPLOYEES}
            result={RESULT}
            period={PERIOD}
            holidays={[]}
            isWeekend={isWeekend}
            fixed={NO_FIXED}
            selected={null}
            disabled={false}
            readOnly
            onSelect={() => {}}
          />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className={ui.sectionTitle}>매장 조건 {shopRuleCount(RULES)}개</h2>
            <p className="text-sm text-[#3D3D38]">말로 적은 규칙이 카드로 정리돼요.</p>
          </div>
          <div className="grid grid-cols-3 gap-5">
            {SHOP_RULES.map((r) => (
              <ReplyCard
                key={r.id}
                title={presetName(r)}
                quote={r.source_text ?? ""}
                hardness={r.hardness}
                reading={<RuleText sentence={describeRule(r, CONFIG, EMPLOYEES, PERIOD)} />}
              />
            ))}
            <article className="flex flex-col gap-2.5 rounded-lg border border-[#E2E2DC] bg-white px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[#1B1B18]">필요 인원</h3>
                <span className={`${ui.badge} ${ui.badgeTone.base}`}>기본</span>
              </div>
              <table className="w-full text-[13px] text-[#3D3D38]">
                <thead>
                  <tr className="border-b border-[#EFEFEB] text-left text-xs font-medium text-[#66665E]">
                    <th className="py-1.5 font-medium">근무</th>
                    <th className="py-1.5 font-medium">평일</th>
                    <th className="py-1.5 font-medium">주말·공휴일</th>
                  </tr>
                </thead>
                <tbody>
                  {TEAMS.map((s) => (
                    <tr key={s.code} className="border-b border-[#EFEFEB] last:border-b-0">
                      <td className="py-1.5 text-[#1B1B18]">{s.name}</td>
                      <td className="py-1.5 font-mono">{coverageCell("weekday", s.code)}</td>
                      <td className="py-1.5 font-mono">{coverageCell("weekend", s.code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>
        </section>

        <div className="flex items-center justify-between gap-6 border-t border-[#E2E2DC] pt-6">
          <p className="text-sm text-[#3D3D38]">내 매장 명단으로 같은 흐름을 바로 시작할 수 있어요.</p>
          <Link href="/app" className={ui.primary}>
            내 매장으로 시작하기
          </Link>
        </div>
      </main>
    </div>
  );
}
