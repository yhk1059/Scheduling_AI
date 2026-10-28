"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { ui } from "./ui";

/**
 * 공용 대화상자(UI_GUIDE "대화상자"). 버튼은 [취소] + Primary 하나.
 * 열리면 첫 버튼에 포커스, Esc로 닫고, 닫히면 연 요소로 포커스를 되돌린다.
 */
export default function Dialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = "취소",
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelRef.current();
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
        <div className="text-sm leading-relaxed text-[#3D3D38]">{children}</div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={ui.secondary}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={ui.primary}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
