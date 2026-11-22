"use client";

import { useId, useRef, useState } from "react";

import { OFF_CODE, shiftTimesError } from "@/lib/rules";
import { coverageCodes, coverageRange, isShiftUsed, liveShopRules, MAX_SHIFT_CODES, tagCoverage, useAppStore, type Shop } from "@/lib/store";
import { coverageText } from "@/lib/wording";
import type { ShiftDef, ShopConfig } from "@/lib/types.gen";

import { codeClass } from "./ScheduleStep";
import { ui } from "./ui";

const CODE_RE = /^[A-Z0-9]{1,3}$/; // backend/domain/models.py ShiftCode

/** 0.5시간 단위, 0 초과 24 이하. 맞지 않으면 null. */
function parseHours(v: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(v.trim())) return null;
  const h = Number(v.trim());
  return h > 0 && h <= 24 && Number.isInteger(h * 2) ? h : null;
}
const HOURS_MSG = "시간은 0.5~24 사이로 0.5 단위로 적어 주세요";

/** 더블이 세는 근무조: "오픈 + 마감". */
function partsText(s: ShiftDef, shifts: ShiftDef[]): string {
  return (s.parts ?? []).map((code) => shifts.find((b) => b.code === code)?.name ?? code).join(" + ");
}

/** 근무 형태(근무 코드 표). 휴무는 고칠 수 없어 보여 주지 않는다. 맨 아래 줄에 적어 하나씩 더한다. 매장 설정 [근무 형태] 탭과 근무표 작성 ②에서 쓴다. */
export default function ShiftTable({ showTimeline = false }: { showTimeline?: boolean } = {}) {
  const shop = useAppStore((s) => s.shop);
  const tableId = useId();
  if (!shop) return null;
  const { config } = shop;
  const { shifts } = config;

  return (
    <div className={showTimeline ? ui.workLayout : undefined}>
      <div className="flex min-w-0 flex-col gap-2">
        <p className={ui.help}>말로 &lsquo;피크 근무 11시~14시 추가&rsquo;라고 적어도 돼요.</p>
        <div className="overflow-x-auto rounded-lg border border-[#EDEDEA] bg-white">
          <table className={`w-full border-collapse text-[13px] ${showTimeline ? "[&_input]:px-1.5 [&_input]:max-w-20 [&_input[type=time]]:max-w-none [&_td]:px-0.5 [&_th]:px-1 [&_th]:leading-tight" : ""}`}>
            <thead>
              <tr className="border-b border-[#EDEDEA] text-left text-xs font-medium text-[#6B6F78]">
                <th className="px-2 py-2 font-medium">약자</th>
                <th className="px-2 py-2 font-medium">이름</th>
                <th className="px-2 py-2 font-medium">시작 시각</th>
                <th className="px-2 py-2 font-medium">끝 시각</th>
                <th className="px-2 py-2 font-medium">실근무 시간</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shifts
                .filter((s) => s.code !== OFF_CODE)
                .map((s) => (
                  <ShiftRow key={s.code} shift={s} config={config} nameId={`${tableId}-${s.code}`} compact={showTimeline} />
                ))}
              <NewShiftRow shifts={shifts} />
            </tbody>
          </table>
        </div>
      </div>
      {showTimeline && (
        <ShiftTimeline shop={shop} focusShift={(code) => document.getElementById(`${tableId}-${code}`)?.focus()} />
      )}
    </div>
  );
}

function ShiftTimeline({ shop, focusShift }: { shop: Shop; focusShift: (code: string) => void }) {
  const shifts = coverageCodes(shop.config).filter((shift) => shift.start && shift.end);
  const rules = liveShopRules(shop, null);
  const hours = [6, 9, 12, 15, 18, 21, 24];
  const position = (time: string) => {
    const [hour, minute] = time.split(":").map(Number);
    return Math.max(0, (hour + minute / 60 - 6) / 18 * 100);
  };
  return (
    <aside aria-label="하루 타임라인" className={`${ui.workAside} rounded-2xl bg-[#F5F5F4] px-4 py-4`}>
      <h3 className={ui.cardTitle}>하루 타임라인</h3>
      <p className={ui.help}>근무조마다 필요 인원</p>
      {shifts.length ? (
        <div className="relative space-y-3 px-2 pt-6">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 inset-y-0 flex justify-between">
            {hours.map((hour) => (
              <div key={hour} className="relative w-0">
                <span className="absolute -translate-x-1/2 font-mono text-[11px] text-[#4B4F57]">{String(hour).padStart(2, "0")}</span>
                <span className="absolute inset-y-5 border-l border-dashed border-[#DCDCD8]" />
              </div>
            ))}
          </div>
          {shifts.map((shift) => {
            const start = shift.start!;
            const end = shift.end!;
            // 전체 필요 인원 뒤에 직급별 필요 인원("홀 2명 이상 · 주방 2명 이상")을 잇는다
            const need = (kind: "weekday" | "weekend") =>
              [coverageText(coverageRange(rules, shift.code, kind)), ...tagCoverage(rules, shift.code, kind).map((t) => `${t.tag} ${coverageText(t)}`)]
                .filter(Boolean)
                .join(" · ") || "—";
            const weekday = need("weekday");
            const weekend = need("weekend");
            const lines = weekday === weekend ? [["매일", weekday]] : [["평일", weekday], ["주말·공휴일", weekend]];
            return (
              <div key={shift.code} className="relative">
                <button
                  type="button"
                  onClick={() => focusShift(shift.code)}
                  className="w-full rounded text-left focus-visible:outline-2 focus-visible:outline-[#C4247C]"
                >
                  <span className="block text-xs font-semibold text-[#111214] wrap-anywhere">{shift.code} {shift.name}</span>
                  {lines.map(([label, text]) => (
                    <span key={label} className="mt-0.5 flex gap-2 text-xs text-[#111214]">
                      <span className="shrink-0 text-[#6B6F78]">{label}</span>
                      <span>{text}</span>
                    </span>
                  ))}
                  <span className="relative mt-1 block h-4">
                    <span aria-hidden="true" className={`absolute inset-y-0 min-w-px overflow-hidden rounded-md ${codeClass(shift.code, shop.config)}`} style={{ left: `${position(start)}%`, width: `${position(end) - position(start)}%` }}>
                      <span className="block h-full bg-current opacity-80" />
                    </span>
                  </span>
                  <span className="font-mono text-[11px] text-[#4B4F57]">{start}~{end}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : <p className={ui.help}>시각을 설정한 근무조가 없어요.</p>}
    </aside>
  );
}

/** 유효한 값은 바로 저장하고, 아니면 입력 중인 값과 오류를 행에 남긴다. 코드와 세는 근무조는 고치지 않는다. */
function ShiftRow({ shift, config, nameId, compact }: { shift: ShiftDef; config: ShopConfig; nameId: string; compact: boolean }) {
  const { shifts } = config;
  const setShift = useAppStore((s) => s.setShift);
  const setShiftActive = useAppStore((s) => s.setShiftActive);
  const removeShift = useAppStore((s) => s.removeShift);
  const used = useAppStore((s) => (s.shop ? isShiftUsed(shift.code, s.shop, s.periods) : true));
  const [name, setName] = useState<string | null>(null);
  const [hours, setHours] = useState<string | null>(null);
  const [times, setTimes] = useState<{ start: string; end: string } | null>(null);

  const active = shift.active !== false;
  const partOff = (shift.parts ?? []).some((p) => shifts.find((s) => s.code === p)?.active === false);
  const timed = active && !shift.parts?.length;
  const shownTimes = times ?? { start: shift.start ?? "", end: shift.end ?? "" };
  const timesMsg = times && shiftTimesError(times.start, times.end);

  const onName = (v: string) => {
    if (v.trim() === "") return setName(v);
    setShift(shift.code, { name: v.trim() });
    setName(null);
  };
  const onHours = (v: string) => {
    const h = parseHours(v);
    if (h === null) return setHours(v);
    setShift(shift.code, { hours: h });
    setHours(null);
  };
  // 시작과 끝은 함께 맞아야 하므로 둘 다 유효할 때만 저장한다
  const onTimes = (next: { start: string; end: string }) => {
    if (shiftTimesError(next.start, next.end)) return setTimes(next);
    setShift(shift.code, next);
    setTimes(null);
  };

  const muted = active ? "" : "text-[#6B6F78]";
  return (
    <tr className="border-b border-[#F5F5F4]">
      <td className={`px-2 py-1 font-mono font-semibold ${muted}`}>
        <span className="flex items-center gap-2">
          <span className={compact && active ? `rounded-md px-1.5 py-1 ${codeClass(shift.code, config)}` : undefined}>{shift.code}</span>
          {!active && <span className={`${ui.badge} ${ui.badgeTone.excluded} font-sans`}>꺼짐</span>}
        </span>
      </td>
      {active ? (
        <>
          <td className="px-1 py-1">
            <input
              value={name ?? shift.name}
              onChange={(e) => onName(e.target.value)}
              id={nameId}
              aria-label={`${shift.code} 이름`}
              aria-invalid={name !== null || undefined}
              className={`${ui.cell} w-32 ${name !== null ? ui.cellErr : ui.cellOk}`}
            />
            {name !== null && <p className={`${ui.error} mt-0.5`}>이름을 적어 주세요</p>}
          </td>
          {timed ? (
            <>
              <td className="px-1 py-1 align-top">
                <input
                  value={shownTimes.start}
                  onChange={(e) => onTimes({ ...shownTimes, start: e.target.value.trim() })}
                  aria-label={`${shift.code} 시작 시각`}
                  aria-invalid={timesMsg ? true : undefined}
                  className={`${ui.cell} w-20 font-mono ${timesMsg ? ui.cellErr : ui.cellOk}`}
                />
                {timesMsg && <p className={`${ui.error} mt-0.5 max-w-40`}>{timesMsg}</p>}
              </td>
              <td className="px-1 py-1 align-top">
                <input
                  value={shownTimes.end}
                  onChange={(e) => onTimes({ ...shownTimes, end: e.target.value.trim() })}
                  aria-label={`${shift.code} 끝 시각`}
                  aria-invalid={timesMsg ? true : undefined}
                  className={`${ui.cell} w-20 font-mono ${timesMsg ? ui.cellErr : ui.cellOk}`}
                />
              </td>
            </>
          ) : (
            <td colSpan={2} className="px-2 py-1">
              {partsText(shift, shifts)}
            </td>
          )}
          <td className="px-1 py-1">
            <input
              inputMode="decimal"
              value={hours ?? String(shift.hours)}
              onChange={(e) => onHours(e.target.value)}
              aria-label={`${shift.code} 실근무 시간`}
              aria-invalid={hours !== null || undefined}
              className={`${ui.cell} w-16 font-mono ${hours !== null ? ui.cellErr : ui.cellOk}`}
            />
            {hours !== null && <p className={`${ui.error} mt-0.5`}>{HOURS_MSG}</p>}
          </td>
        </>
      ) : (
        <>
          <td className={`px-2 py-1 ${muted}`}>{shift.name}</td>
          {shift.parts?.length ? (
            <td colSpan={2} className={`px-2 py-1 ${muted}`}>
              {partsText(shift, shifts)}
            </td>
          ) : (
            <>
              <td className={`px-2 py-1 font-mono ${muted}`}>{shift.start}</td>
              <td className={`px-2 py-1 font-mono ${muted}`}>{shift.end}</td>
            </>
          )}
          <td className={`px-2 py-1 font-mono ${muted}`}>{shift.hours}</td>
        </>
      )}
      <td className="px-1 py-1">
        <div className="flex items-center justify-end gap-1">
          {!active ? (
            <button
              type="button"
              disabled={partOff}
              onClick={() => setShiftActive(shift.code, true)}
              className={`${ui.textSm} disabled:cursor-not-allowed disabled:text-[#9499A2] disabled:hover:bg-transparent`}
            >
              다시 켜기
            </button>
          ) : used ? (
            <button type="button" onClick={() => setShiftActive(shift.code, false)} className={ui.textSm}>
              끄기
            </button>
          ) : (
            <button type="button" onClick={() => removeShift(shift.code)} className={ui.danger}>
              삭제
            </button>
          )}
        </div>
        {!active && partOff && <p className={`${ui.help} text-right`}>세는 근무조를 먼저 켜야 해요</p>}
      </td>
    </tr>
  );
}

/** 표 맨 아래 입력 줄. Enter나 [추가]로 코드 하나를 더하고 다시 코드 칸으로 돌아간다. 더블은 말로만 더한다. */
function NewShiftRow({ shifts }: { shifts: ShiftDef[] }) {
  const addShift = useAppStore((s) => s.addShift);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [hours, setHours] = useState("");
  const [tried, setTried] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const full = shifts.length >= MAX_SHIFT_CODES;
  const codeMsg =
    code === ""
      ? "코드를 적어 주세요"
      : !CODE_RE.test(code)
        ? "코드는 영문 대문자·숫자 3자까지예요"
        : code === OFF_CODE
          ? "O는 쉬는 날을 나타내는 코드라 쓸 수 없어요"
          : shifts.some((s) => s.code === code)
            ? "같은 코드가 이미 있어요"
            : null;
  const nameMsg = name.trim() === "" ? "이름을 적어 주세요" : null;
  const hoursMsg = parseHours(hours) === null ? HOURS_MSG : null;
  const timesMsg = shiftTimesError(start, end);

  const add = () => {
    if (full) return;
    if (codeMsg || nameMsg || timesMsg || hoursMsg) return setTried(true);
    addShift({ code, name: name.trim(), hours: parseHours(hours)!, start, end });
    setCode("");
    setName("");
    setStart("");
    setEnd("");
    setHours("");
    setTried(false);
    codeRef.current?.focus();
  };
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    add();
  };

  if (full) {
    return (
      <tr>
        <td colSpan={6} className={`${ui.help} px-2 py-2`}>
          근무 코드는 휴무를 포함해 최대 {MAX_SHIFT_CODES}개까지 넣을 수 있어요.
        </td>
      </tr>
    );
  }
  const show = (msg: string | null) => (tried ? msg : null);
  const cls = (msg: string | null) => (show(msg) ? ui.cellErr : ui.cellOk);
  const placeholder = "placeholder:font-sans placeholder:text-[#6B6F78]";
  return (
    <tr className="bg-[#F5F5F4] align-top">
      <td className="px-1 py-1">
        <input
          ref={codeRef}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().trim())}
          onKeyDown={onEnter}
          placeholder="예: P"
          maxLength={3}
          aria-label="새 근무 코드"
          aria-invalid={show(codeMsg) ? true : undefined}
          className={`${ui.cell} w-16 font-mono ${placeholder} ${cls(codeMsg)}`}
        />
        {show(codeMsg) && <p className={`${ui.error} mt-0.5`}>{codeMsg}</p>}
      </td>
      <td className="px-1 py-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
          placeholder="예: 피크"
          aria-label="새 근무 이름"
          aria-invalid={show(nameMsg) ? true : undefined}
          className={`${ui.cell} w-32 ${placeholder} ${cls(nameMsg)}`}
        />
        {show(nameMsg) && <p className={`${ui.error} mt-0.5`}>{nameMsg}</p>}
      </td>
      <td className="px-1 py-1">
        <input
          value={start}
          onChange={(e) => setStart(e.target.value.trim())}
          onKeyDown={onEnter}
          placeholder="11:00"
          aria-label="새 근무 시작 시각"
          aria-invalid={show(timesMsg) ? true : undefined}
          className={`${ui.cell} w-20 font-mono ${placeholder} ${cls(timesMsg)}`}
        />
        {show(timesMsg) && <p className={`${ui.error} mt-0.5 max-w-40`}>{timesMsg}</p>}
      </td>
      <td className="px-1 py-1">
        <input
          value={end}
          onChange={(e) => setEnd(e.target.value.trim())}
          onKeyDown={onEnter}
          placeholder="14:00"
          aria-label="새 근무 끝 시각"
          aria-invalid={show(timesMsg) ? true : undefined}
          className={`${ui.cell} w-20 font-mono ${placeholder} ${cls(timesMsg)}`}
        />
      </td>
      <td className="px-1 py-1">
        <input
          inputMode="decimal"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          onKeyDown={onEnter}
          placeholder="3"
          aria-label="새 근무 실근무 시간"
          aria-invalid={show(hoursMsg) ? true : undefined}
          className={`${ui.cell} w-16 font-mono ${placeholder} ${cls(hoursMsg)}`}
        />
        {show(hoursMsg) && <p className={`${ui.error} mt-0.5 max-w-40`}>{hoursMsg}</p>}
      </td>
      <td className="px-1 py-1">
        <div className="flex justify-end">
          <button type="button" onClick={add} className={ui.textSm}>
            추가
          </button>
        </div>
      </td>
    </tr>
  );
}
