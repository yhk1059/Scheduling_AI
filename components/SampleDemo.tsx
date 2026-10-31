"use client";

// 샘플 데모(/demo, ADR-016). 모두에게 같은 보기 전용 화면: 샘플 매장과 미리 풀어 둔 근무표를 정적 렌더한다(store·API 없음).
import Link from "next/link";

import { isWeekendDay } from "@/lib/period";
import demo from "@/lib/samples/demo-schedule.json";
import shop from "@/lib/samples/shop-12.json";
import type { ConstraintSpec, Employee, Period, ScheduleResult, ShopConfig } from "@/lib/types.gen";
import { describeRule, hardnessLabel, presetName } from "@/lib/wording";

import RuleText from "./RuleText";
import { ScheduleGrid } from "./ScheduleStep";
import { ui } from "./ui";

const CONFIG = shop.config as unknown as ShopConfig;
const EMPLOYEES: Employee[] = shop.employees;
const RULES = shop.constraints as unknown as ConstraintSpec[];
const COVERAGE = RULES.filter((r) => presetName(r) === "필요 인원");
const SHOP_RULES = RULES.filter((r) => presetName(r) !== "필요 인원");
const PERIOD = demo.period as Period;
const RESULT = demo.result as unknown as ScheduleResult;
const isWeekend = (d: number) => isWeekendDay(PERIOD, d, []);

const h2 = "text-[17px] font-semibold text-[#1B1B18]";
const card = "rounded-lg border border-[#E2E2DC] bg-white px-[18px] py-4";

// ConstraintCard는 store의 매장을 읽어 데모(빈 store)에서는 그려지지 않으므로, 같은 모양의 적용된 카드를 직접 그린다.
function PreviewCard({ card, employees, period }: { card: ConstraintSpec; employees: Employee[]; period: Period }) {
  return (
    <article className="flex flex-col gap-2.5 rounded-lg border border-[#E2E2DC] bg-white px-[18px] py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-[#1B1B18]">{presetName(card)}</h3>
        <div role="group" aria-label="반드시/가능하면" className="inline-flex overflow-hidden rounded-md border border-[#C9C9C1]">
          {(["hard", "soft"] as const).map((h) => (
            <span
              key={h}
              className={`inline-flex h-7 items-center px-3 text-xs font-medium ${card.hardness === h ? "bg-[#1B1B18] text-white" : "bg-white text-[#66665E]"}`}
            >
              {hardnessLabel(h)}
            </span>
          ))}
        </div>
      </div>
      <p className="text-sm text-[#1B1B18]">“{card.source_text}”</p>
      <p className="rounded-sm bg-[#F6F6F3] px-2.5 py-2 text-xs text-[#3D3D38]"><RuleText sentence={describeRule(card, CONFIG, employees, period)} />
      </p>
      <div>
        <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>적용됨</span>
      </div>
    </article>
  );
}

export default function SampleDemo() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[#E2E2DC] bg-white">
        <div className="mx-auto flex h-14 max-w-[1360px] items-center px-8">
          <Link href="/" className="text-[15px] font-semibold text-[#1B1B18]">
            매장 직원 근무표
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 px-8 py-8">
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-xs font-semibold text-[#155E75]">샘플 데모</p>
            <h1 className="text-[22px] font-semibold text-[#1B1B18]">{shop.name}</h1>
            <p className="text-sm leading-relaxed text-[#3D3D38]">
              직원 {EMPLOYEES.length}명과 매장 조건 {SHOP_RULES.length}개로 만든 4주 근무표예요. 모두에게 같은 화면이고, 바꾸거나 저장할
              수 없어요.
            </p>
          </div>
          <Link href="/app" className={ui.primary}>
            내 매장으로 시작하기
          </Link>
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className={h2}>매장 조건</h2>
            <p className="text-sm text-[#3D3D38]">말로 적은 규칙이 카드로 정리돼요.</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {SHOP_RULES.map((r) => (
              <PreviewCard key={r.id} card={r} employees={EMPLOYEES} period={PERIOD} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={h2}>필요 인원</h2>
          <ul className={`${card} grid grid-cols-3 gap-x-6 gap-y-1.5 text-sm text-[#3D3D38]`}>
            {COVERAGE.map((r) => (
              <li key={r.id}>{describeRule(r, CONFIG, EMPLOYEES, PERIOD).text}</li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className={h2}>근무표</h2>
            <p className="text-sm text-[#3D3D38]">위 규칙과 필요 인원을 모두 지켜요.</p>
          </div>
          <div className={card}>
            <ScheduleGrid
              rows={EMPLOYEES}
              result={RESULT}
              period={PERIOD}
              holidays={[]}
              isWeekend={isWeekend}
              fixed={new Map()}
              selected={null}
              disabled={false}
              onSelect={() => {}}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
