"use client";

import { useMemo, useState } from "react";

import { formatRange } from "@/lib/period";
import { buildRoster, decodeText, mapHeaders, parseDelimited } from "@/lib/roster-import";
import { currentPeriod, orphanConstraintIds, useAppStore } from "@/lib/store";
import type { Nurse } from "@/lib/types.gen";

import CoverageForm, { type CoverageDrafts, hasCoverageError } from "./CoverageForm";
import { OVERWRITE_MESSAGE } from "./EntryStep";
import HolidayCalendar from "./HolidayCalendar";
import RosterEditor, { type RosterDraft } from "./RosterEditor";
import { today } from "./RulesStep";
import { ui } from "./ui";

function draftFromNurses(nurses: Nurse[]): RosterDraft {
  return {
    rows: [["이름", "연차", "나이트전담"], ...nurses.map((n) => [n.name, String(n.years), n.night_only ? "Y" : ""])],
    mapping: { name: 0, years: 1, night_only: 2 },
    firstRowIsData: false,
  };
}

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

export default function WardStep() {
  const period = useAppStore(currentPeriod);
  const ward = useAppStore((s) => s.ward);
  const replaceRoster = useAppStore((s) => s.replaceRoster);
  const loadSample = useAppStore((s) => s.loadSample);
  const go = useAppStore((s) => s.go);
  const nurses = useMemo(() => ward?.nurses.filter((n) => n.active) ?? [], [ward]);
  const orphanCount = ward ? orphanConstraintIds(ward, period).length : 0;

  const [text, setText] = useState("");
  const [draft, setDraft] = useState<RosterDraft | null>(() => (nurses.length > 0 ? draftFromNurses(nurses) : null));
  const [coverageDrafts, setCoverageDrafts] = useState<CoverageDrafts>({});

  const roster = useMemo(
    () => (draft ? buildRoster(draft.rows, draft.mapping, draft.firstRowIsData) : null),
    [draft],
  );

  const updateDraft = (next: RosterDraft) => {
    setDraft(next);
    const built = buildRoster(next.rows, next.mapping, next.firstRowIsData);
    const current = nurses.map(({ name, years, night_only }) => ({ name, years, night_only }));
    const rows = built.nurses.map(({ name, years, night_only }) => ({ name, years, night_only }));
    if (built.errors.length === 0 && JSON.stringify(rows) !== JSON.stringify(current)) {
      replaceRoster(rows);
    }
  };

  const onLoadSample = () => {
    if (useAppStore.getState().hasInput() && !window.confirm(OVERWRITE_MESSAGE)) return;
    loadSample(today());
    go({ screen: "settings", tab: "roster" });
    setDraft(draftFromNurses(useAppStore.getState().ward?.nurses ?? []));
    setCoverageDrafts({});
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 골라도 반영되게
    if (!file) return;
    const content = decodeText(await file.arrayBuffer());
    setText(content);
    updateDraft(draftFromText(content));
  };

  const canProceed =
    period !== null && nurses.length > 0 && roster?.errors.length === 0 && !hasCoverageError(coverageDrafts);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold text-[#1B1B18]">병동 준비</h1>
          <p className="text-sm leading-relaxed text-[#3D3D38]">
            대상 월과 명단, 근무조별 필요 인원, 공휴일을 정해 주세요.
          </p>
        </div>
        {period && (
          <div className="flex flex-col gap-1">
            <span className={ui.label}>대상 기간</span>
            <span className="font-mono text-sm text-[#1B1B18]">{formatRange(period)}</span>
          </div>
        )}
      </div>

      <section className={`${ui.card} flex flex-col gap-3.5`}>
        <div className="flex items-center justify-between">
          <h2 className={ui.cardTitle}>명단</h2>
          <button type="button" onClick={onLoadSample} className={ui.secondary}>
            샘플 병동 불러오기
          </button>
        </div>
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
            onClick={() => updateDraft(draftFromText(text))}
            className={ui.secondary}
          >
            변환
          </button>
          <label className={`${ui.secondary} cursor-pointer focus-within:outline-2 focus-within:outline-[#155E75]`}>
            CSV 파일 올리기
            <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void onUpload(e)} className="sr-only" />
          </label>
        </div>
        {draft && roster && <RosterEditor draft={draft} errors={roster.errors} onChange={updateDraft} />}
        {orphanCount > 0 && (
          <p className="text-xs font-medium text-[#A15C07]">
            명단에 없는 간호사를 가리키는 규칙·요청이 {orphanCount}개 있어요. 다음 단계에서 확인해 주세요.
          </p>
        )}
      </section>

      <div className="grid grid-cols-[auto_1fr] gap-5">
        <section className={`${ui.card} flex flex-col gap-3`}>
          <h2 className={ui.cardTitle}>근무조별 필요 인원</h2>
          <CoverageForm drafts={coverageDrafts} setDrafts={setCoverageDrafts} />
          {hasCoverageError(coverageDrafts) && <p className={ui.error}>최소 인원이 최대 인원보다 많아요.</p>}
        </section>
        <section className={`${ui.card} flex flex-col gap-3`}>
          <div className="flex flex-col gap-1">
            <h2 className={ui.cardTitle}>공휴일</h2>
            <p className={ui.help}>날짜를 누르면 공휴일로 체크됩니다. 주말과 같은 인원 기준을 씁니다.</p>
          </div>
          {period && <HolidayCalendar period={period} />}
        </section>
      </div>

      <div className="flex justify-end">
        <button type="button" disabled={!canProceed} onClick={() => go({ screen: "settings", tab: "rules" })} className={ui.primary}>
          다음
        </button>
      </div>
    </div>
  );
}
