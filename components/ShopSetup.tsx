"use client";

import { isShopReady, useAppStore } from "@/lib/store";

import { today } from "./RulesStep";
import { BasicSection, RosterSection } from "./ShopSettings";
import { ui } from "./ui";

/** 매장 준비: 근무표가 없는 매장에서 한 번 보인다. 규칙 입력은 근무표 작성과 매장 설정에 있다. */
export default function ShopSetup() {
  const shop = useAppStore((s) => s.shop);
  const createPeriod = useAppStore((s) => s.createPeriod);

  if (!shop) return null;
  const ready = isShopReady(shop);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">매장 준비</h1>
        {!ready && <p className="text-sm leading-relaxed text-[#3D3D38]">아직 명단이 없어요.</p>}
      </div>
      <BasicSection />
      <RosterSection />
      <div className="flex items-center justify-end gap-3">
        {!ready && <p className={ui.help}>명단에 직원을 1명 이상 넣으면 시작할 수 있어요</p>}
        <button type="button" disabled={!ready} onClick={() => createPeriod(today())} className={ui.primary}>
          첫 근무표 시작하기
        </button>
      </div>
    </div>
  );
}
