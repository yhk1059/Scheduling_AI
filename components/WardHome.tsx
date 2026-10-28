"use client";

import { formatRange } from "@/lib/period";
import { useAppStore, type Ward } from "@/lib/store";

import { today } from "./RulesStep";
import { ui } from "./ui";

const COVERAGE_COUNT = 6; // D/E/N × 평일/주말·공휴일

export function hasCoverage(ward: Ward): boolean {
  return ward.rules.filter((r) => r.type === "daily_coverage" && r.scope === "ward").length >= COVERAGE_COUNT;
}

/** 활성 명단과 필요 인원이 모두 있어야 기간을 만들 수 있다. */
export function isWardReady(ward: Ward): boolean {
  return ward.nurses.some((n) => n.active) && hasCoverage(ward);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function WardHome() {
  const ward = useAppStore((s) => s.ward);
  const periods = useAppStore((s) => s.periods);
  const createPeriod = useAppStore((s) => s.createPeriod);
  const go = useAppStore((s) => s.go);
  if (!ward) return null;

  const ready = isWardReady(ward);
  const active = ward.nurses.filter((n) => n.active).length;
  const inactive = ward.nurses.length - active;
  const ruleCount = ward.rules.filter((r) => r.type !== "daily_coverage").length;
  const recent = [...periods].reverse();
  const create = () => createPeriod(today());

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">{ward.name || "이름 없는 병동"}</h1>
        {ready && periods.length > 0 && (
          <button type="button" onClick={create} className={ui.primary}>
            다음 기간 만들기
          </button>
        )}
      </div>

      {!ready ? (
        <section className={`${ui.card} flex items-center justify-between gap-4`}>
          <p className="text-sm leading-relaxed text-[#3D3D38]">
            명단과 필요 인원을 입력하면 첫 기간을 만들 수 있어요.
          </p>
          <button type="button" onClick={() => go({ screen: "settings", tab: "roster" })} className={ui.primary}>
            병동 설정
          </button>
        </section>
      ) : (
        <section className={`${ui.card} flex flex-col gap-3`}>
          <h2 className={ui.cardTitle}>최근 기간</h2>
          {recent.length === 0 ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-[#3D3D38]">아직 확정한 기간이 없어요.</p>
              <button type="button" onClick={create} className={ui.primary}>
                첫 기간 만들기
              </button>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#E2E2DC] text-left text-xs font-medium text-[#66665E]">
                  <th className="py-2 pr-4 font-medium">기간</th>
                  <th className="py-2 pr-4 font-medium">상태</th>
                  <th className="py-2 font-medium">확정 시각</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => {
                  const confirmedAt = p.versions.at(-1)?.confirmed_at;
                  return (
                    <tr key={p.id} className="border-b border-[#EFEFEB] last:border-b-0">
                      <td className="py-1.5 pr-4">
                        <button
                          type="button"
                          onClick={() => go({ screen: "period", periodId: p.id, step: p.result ? 3 : 1 })}
                          className="rounded-md px-1 font-mono text-[13px] font-medium text-[#1B1B18] underline-offset-2 hover:bg-[#EFEFEB] hover:underline"
                        >
                          {formatRange(p)}
                        </button>
                      </td>
                      <td className="py-1.5 pr-4">
                        {p.status === "confirmed" ? (
                          <span className={`${ui.badge} bg-[#E6F2EA] text-[#1E6B3F]`}>확정</span>
                        ) : (
                          <span className={`${ui.badge} border border-[#C9C9C1] bg-white text-[#3D3D38]`}>초안</span>
                        )}
                      </td>
                      <td className="py-1.5 font-mono text-[13px] text-[#3D3D38]">
                        {confirmedAt ? formatTime(confirmedAt) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      <div className="flex items-center gap-2 text-sm text-[#3D3D38]">
        <span>
          활성 <span className="font-mono">{active}</span>명
          {inactive > 0 && (
            <>
              {" "}
              (비활성 <span className="font-mono">{inactive}</span>명)
            </>
          )}{" "}
          · 병동 규칙 <span className="font-mono">{ruleCount}</span>개
        </span>
        <button type="button" onClick={() => go({ screen: "settings", tab: "roster" })} className={ui.text}>
          병동 설정
        </button>
      </div>
    </div>
  );
}
