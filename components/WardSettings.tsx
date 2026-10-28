"use client";

import { useMemo, useState } from "react";

import { PERIOD_UNITS, type PeriodUnit } from "@/lib/period";
import { buildRoster, decodeText, mapHeaders, parseDelimited } from "@/lib/roster-import";
import { isNurseUsed, orphanConstraintIds, useAppStore, type WardNurse } from "@/lib/store";

import CoverageForm, { type CoverageDrafts, hasCoverageError } from "./CoverageForm";
import RosterEditor, { type RosterDraft } from "./RosterEditor";
import RulesStep, { today } from "./RulesStep";
import { ui } from "./ui";
import { hasCoverage, isWardReady } from "./WardHome";

const TABS = [
  { tab: "roster", label: "명단·필요 인원" },
  { tab: "rules", label: "병동 규칙" },
] as const;

function draftFromText(text: string): RosterDraft {
  const rows = parseDelimited(text);
  const { mapping } = mapHeaders(rows[0] ?? []);
  if (mapping.name !== undefined) return { rows, mapping, firstRowIsData: false };
  // 헤더가 없으면 이름·연차·나이트 전담 순서로 가정하고 첫 행도 데이터로 쓴다
  const width = Math.max(0, ...rows.map((r) => r.length));
  return {
    rows,
    mapping: { name: 0, ...(width > 1 && { years: 1 }), ...(width > 2 && { night_only: 2 }) },
    firstRowIsData: true,
  };
}

export default function WardSettings() {
  const tab = useAppStore((s) => (s.view.screen === "settings" ? s.view.tab : "roster"));
  const ward = useAppStore((s) => s.ward);
  const hasPeriods = useAppStore((s) => s.periods.length > 0);
  const createPeriod = useAppStore((s) => s.createPeriod);
  const go = useAppStore((s) => s.go);
  if (!ward) return null;
  const ready = isWardReady(ward);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-[22px] font-semibold text-[#1B1B18]">병동 설정</h1>
        <div role="tablist" className="flex gap-1 border-b border-[#E2E2DC]">
          {TABS.map((t) => (
            <button
              key={t.tab}
              type="button"
              role="tab"
              onClick={() => go({ screen: "settings", tab: t.tab })}
              aria-selected={tab === t.tab}
              className={`-mb-px h-10 border-b-2 px-3 text-sm transition-colors duration-[120ms] hover:text-[#1B1B18] ${
                tab === t.tab ? "border-[#155E75] font-semibold text-[#1B1B18]" : "border-transparent text-[#3D3D38]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "roster" ? <RosterTab /> : <RulesStep key="ward" scope="ward" />}

      {!hasPeriods && (
        <div className="flex items-center justify-end gap-3">
          {!ready && <p className={ui.help}>명단과 필요 인원을 입력하면 첫 기간을 만들 수 있어요.</p>}
          <button type="button" disabled={!ready} onClick={() => createPeriod(today())} className={ui.primary}>
            첫 기간 만들기
          </button>
        </div>
      )}
    </div>
  );
}

function RosterTab() {
  const ward = useAppStore((s) => s.ward)!;
  const setWardName = useAppStore((s) => s.setWardName);
  const setUnit = useAppStore((s) => s.setUnit);
  const replaceRoster = useAppStore((s) => s.replaceRoster);

  const [unitChanged, setUnitChanged] = useState(false);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<RosterDraft | null>(null);
  const [coverageDrafts, setCoverageDrafts] = useState<CoverageDrafts>({});
  const roster = useMemo(() => (draft ? buildRoster(draft.rows, draft.mapping, draft.firstRowIsData) : null), [draft]);
  const orphanCount = orphanConstraintIds(ward, null).length;

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 골라도 반영되게
    if (!file) return;
    const content = decodeText(await file.arrayBuffer());
    setText(content);
    setDraft(draftFromText(content));
  };

  const applyDraft = () => {
    if (!roster || roster.errors.length > 0) return;
    replaceRoster(roster.nurses.map(({ name, years, night_only }) => ({ name, years, night_only })));
    setDraft(null);
    setText("");
  };

  return (
    <>
      <section className={`${ui.card} flex flex-col gap-3`}>
        <h2 className={ui.cardTitle}>기본</h2>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className={ui.label}>병동 이름</span>
            <input
              value={ward.name}
              onChange={(e) => setWardName(e.target.value)}
              placeholder="예: 내과 병동"
              className={`${ui.input} w-64`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>기간 단위</span>
            <select
              value={ward.unit}
              onChange={(e) => {
                setUnit(e.target.value as PeriodUnit);
                setUnitChanged(true);
              }}
              className={`${ui.input} w-40`}
            >
              {PERIOD_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {unitChanged && (
          <p role="status" className={ui.banner}>
            다음에 만드는 기간부터 적용돼요. 최소 오프 일수 같은 규칙 값을 다시 확인하세요.
          </p>
        )}
      </section>

      <section className={`${ui.card} flex flex-col gap-3.5`}>
        <div className="flex flex-col gap-1">
          <h2 className={ui.cardTitle}>명단</h2>
          <p className={ui.help}>이름 입력란에는 이니셜을 써도 됩니다.</p>
        </div>
        <NurseTable nurses={ward.nurses} />
        {orphanCount > 0 && (
          <p className="text-xs font-medium text-[#A15C07]">
            활성 명단에 없는 간호사를 가리키는 병동 규칙이 {orphanCount}개 있어요. [병동 규칙] 탭에서 확인해 주세요.
          </p>
        )}

        <div className="flex flex-col gap-2.5 border-t border-[#EFEFEB] pt-3.5">
          <label className="flex flex-col gap-1">
            <span className={ui.label}>엑셀에서 복사한 명단 붙여넣기 (이름, 연차, 나이트 전담)</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={"이름\t연차\t나이트전담\n이영희\t12년차\t\n문가람\t11\tY"}
              className={`${ui.input} h-auto py-2 font-mono`}
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={text.trim() === ""}
              onClick={() => setDraft(draftFromText(text))}
              className={ui.secondary}
            >
              변환
            </button>
            <label className={`${ui.secondary} cursor-pointer focus-within:outline-2 focus-within:outline-[#155E75]`}>
              CSV 파일 올리기
              <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void onUpload(e)} className="sr-only" />
            </label>
          </div>
          {draft && roster && (
            <>
              <RosterEditor draft={draft} errors={roster.errors} onChange={setDraft} />
              <div className="flex items-center justify-end gap-3">
                <p className={ui.help}>
                  {roster.errors.length > 0
                    ? "오류를 고치면 명단에 반영할 수 있어요."
                    : "같은 이름은 그대로 두고, 붙여넣은 명단에 없는 사람은 비활성으로 바꿔요."}
                </p>
                <button type="button" onClick={() => setDraft(null)} className={ui.text}>
                  취소
                </button>
                <button type="button" disabled={roster.errors.length > 0} onClick={applyDraft} className={ui.secondary}>
                  명단에 반영
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className={`${ui.card} flex flex-col gap-3`}>
        <h2 className={ui.cardTitle}>근무조별 필요 인원</h2>
        <div className="self-start">
          <CoverageForm drafts={coverageDrafts} setDrafts={setCoverageDrafts} />
        </div>
        {hasCoverageError(coverageDrafts) && <p className={ui.error}>최소 인원이 최대 인원보다 많아요.</p>}
        {!hasCoverage(ward) && <p className={ui.help}>필요 인원을 입력하면 기간을 만들 수 있어요.</p>}
      </section>
    </>
  );
}

function NurseTable({ nurses }: { nurses: WardNurse[] }) {
  const [showInactive, setShowInactive] = useState(false);
  const active = nurses.filter((n) => n.active);
  const inactive = nurses.filter((n) => !n.active);

  if (nurses.length === 0) return <p className="text-sm text-[#66665E]">아직 명단이 없어요. 아래에 엑셀 명단을 붙여넣어 주세요.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-[#E2E2DC] bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E2DC] text-left text-xs font-medium text-[#66665E]">
              <th className="w-10 px-2 py-2 font-mono font-medium">#</th>
              <th className="px-2 py-2 font-medium">이름</th>
              <th className="px-2 py-2 font-medium">연차</th>
              <th className="px-2 py-2 font-medium">나이트 전담</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.map((n, i) => (
              <NurseRow key={n.id} nurse={n} index={i} nurses={nurses} />
            ))}
            {showInactive && inactive.map((n, i) => <NurseRow key={n.id} nurse={n} index={active.length + i} nurses={nurses} />)}
          </tbody>
        </table>
      </div>
      {inactive.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowInactive((v) => !v)} className={ui.textSm}>
            {showInactive ? `비활성 ${inactive.length}명 접기` : `비활성 ${inactive.length}명 보기`}
          </button>
        </div>
      )}
    </div>
  );
}

const cellInput =
  "h-8 rounded-md border bg-white px-2 text-[13px] text-[#1B1B18] focus:outline-2 focus:outline-[#155E75] focus:-outline-offset-1";

/** 유효한 값은 바로 저장하고, 아니면 입력 중인 값과 오류를 행에 남긴다(id는 바뀌지 않는다). */
function NurseRow({ nurse, index, nurses }: { nurse: WardNurse; index: number; nurses: WardNurse[] }) {
  const updateNurse = useAppStore((s) => s.updateNurse);
  const setNurseActive = useAppStore((s) => s.setNurseActive);
  const removeNurse = useAppStore((s) => s.removeNurse);
  const deletable = useAppStore((s) => (s.ward ? !isNurseUsed(nurse.id, s.ward, s.periods) : false));
  const [name, setName] = useState<string | null>(null);
  const [years, setYears] = useState<string | null>(null);

  const nameError = (v: string) =>
    v.trim() === ""
      ? "이름이 비어 있어요"
      : nurses.some((o) => o.id !== nurse.id && o.name === v.trim())
        ? "같은 이름이 이미 있어요"
        : null;
  const nameMsg = name === null ? null : nameError(name);
  const yearsMsg = years === null ? null : "연차는 숫자여야 해요";

  const onName = (v: string) => {
    if (nameError(v)) return setName(v);
    updateNurse(nurse.id, { name: v.trim() });
    setName(null);
  };
  const onYears = (v: string) => {
    if (!/^\d+$/.test(v.trim())) return setYears(v);
    updateNurse(nurse.id, { years: Number(v.trim()) });
    setYears(null);
  };

  const row = index + 1;
  const err = "border-[#B42318] bg-[#FBE9E7] text-[#9F1F14]";
  return (
    <tr className="border-b border-[#EFEFEB] last:border-b-0">
      <td className="px-2 py-1 font-mono text-xs text-[#66665E]">{row}</td>
      {nurse.active ? (
        <>
          <td className="px-1 py-1">
            <input
              value={name ?? nurse.name}
              onChange={(e) => onName(e.target.value)}
              aria-label={`${row}행 이름`}
              aria-invalid={nameMsg !== null || undefined}
              className={`${cellInput} w-48 ${nameMsg ? err : "border-[#8A8A80]"}`}
            />
            {nameMsg && <p className={`${ui.error} mt-0.5`}>{nameMsg}</p>}
          </td>
          <td className="px-1 py-1">
            <input
              inputMode="numeric"
              value={years ?? String(nurse.years)}
              onChange={(e) => onYears(e.target.value)}
              aria-label={`${row}행 연차`}
              aria-invalid={yearsMsg !== null || undefined}
              className={`${cellInput} w-20 font-mono ${yearsMsg ? err : "border-[#8A8A80]"}`}
            />
            {yearsMsg && <p className={`${ui.error} mt-0.5`}>{yearsMsg}</p>}
          </td>
          <td className="px-2 py-1">
            <input
              type="checkbox"
              checked={nurse.night_only}
              onChange={(e) => updateNurse(nurse.id, { night_only: e.target.checked })}
              aria-label={`${row}행 나이트 전담`}
              className="size-4 accent-[#155E75]"
            />
          </td>
        </>
      ) : (
        <>
          <td className="px-2 py-1">
            <span className="flex items-center gap-2 text-[#66665E]">
              {nurse.name}
              <span className={`${ui.badge} bg-[#EFEFEB] text-[#66665E]`}>비활성</span>
            </span>
          </td>
          <td className="px-2 py-1 font-mono text-[#66665E]">{nurse.years}</td>
          <td className="px-2 py-1 text-[#66665E]">{nurse.night_only ? "Y" : ""}</td>
        </>
      )}
      <td className="px-1 py-1">
        <div className="flex items-center justify-end gap-1">
          {deletable && (
            <button type="button" onClick={() => removeNurse(nurse.id)} className={ui.danger}>
              삭제
            </button>
          )}
          <button type="button" onClick={() => setNurseActive(nurse.id, !nurse.active)} className={ui.textSm}>
            {nurse.active ? "비활성으로" : "다시 활성으로"}
          </button>
        </div>
      </td>
    </tr>
  );
}
