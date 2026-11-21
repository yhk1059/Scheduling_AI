"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

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

  // body에 그린다. 헤더처럼 backdrop-filter가 있는 조상 안에서는 fixed가 화면이 아니라 그 조상 기준이 된다.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111214]/40 px-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className={`${ui.cardXl} ${ui.shadow} flex w-full max-w-[440px] flex-col gap-3.5 px-6 py-5`}
      >
        <h2 id="dialog-title" className={ui.sectionTitle}>
          {title}
        </h2>
        <div className="flex flex-col gap-2.5 text-sm leading-relaxed text-[#4B4F57]">{children}</div>
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
    </div>,
    document.body,
  );
}
