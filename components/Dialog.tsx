"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { ui } from "./ui";

interface DialogAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * 공용 대화상자(UI_GUIDE "대화상자"). 버튼은 최대 2개: Secondary + Primary(danger면 Danger 스타일).
 * 열리면 첫 버튼에 포커스, Esc로 onClose, 닫히면 연 요소로 포커스를 되돌린다.
 */
export default function Dialog({
  title,
  children,
  onClose,
  secondary,
  primary,
  danger = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  secondary?: DialogAction;
  primary?: DialogAction;
  danger?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-[#1B1B18]/40 px-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className={`${ui.card} flex w-full max-w-[440px] flex-col gap-3.5`}
      >
        <h2 id="dialog-title" className={ui.cardTitle}>
          {title}
        </h2>
        <div className="flex flex-col gap-2.5 text-sm leading-relaxed text-[#3D3D38]">{children}</div>
        <div className="flex justify-end gap-2">
          {secondary && (
            <button type="button" onClick={secondary.onClick} disabled={secondary.disabled} className={ui.secondary}>
              {secondary.label}
            </button>
          )}
          {primary && (
            <button
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled}
              className={danger ? ui.dangerMd : ui.primary}
            >
              {primary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
