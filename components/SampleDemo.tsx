"use client";

// 샘플 데모(/demo, ADR-016). 모두에게 같은 보기 전용 화면: 샘플 매장과 미리 풀어 둔 근무표를 정적 렌더한다(store·API 없음).
import Link from "next/link";

import { isWeekendDay } from "@/lib/period";
import demo from "@/lib/samples/demo-schedule.json";
import shop from "@/lib/samples/shop-12.json";
import type { ConstraintSpec, Employee, Period, ScheduleResult, ShopConfig } from "@/lib/types.gen";
import { describeRule, presetName } from "@/lib/wording";

import { PreviewCard } from "./LandingPreview";
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

export default function SampleDemo() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[#E2E2DC] bg-white">
        <div className="mx-auto flex h-14 max-w-[1360px] items-center px-8">
          <Link href="/" className="text-[15px] font-semibold text-[#1B1B18]">
            간호사 근무표
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 px-8 py-8">
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-xs font-semibold text-[#155E75]">샘플 데모</p>
            <h1 className="text-[22px] font-semibold text-[#1B1B18]">샘플 병동</h1>
            <p className="text-sm leading-relaxed text-[#3D3D38]">
              간호사 {EMPLOYEES.length}명과 병동 규칙 {SHOP_RULES.length}개로 만든 한 달 근무표예요. 모두에게 같은 화면이고, 바꾸거나 저장할
              수 없어요.
            </p>
          </div>
          <Link href="/app?start=new" className={ui.primary}>
            내 병동으로 시작하기
          </Link>
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className={h2}>병동 규칙</h2>
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
