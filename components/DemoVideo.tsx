"use client";

// 데모 영상(ADR-022). 랜딩과 로그인 화면의 [데모 영상]가 대화상자로 연다. 영상은 public/demo.mp4(npm run record:dining으로 다시 만든다).
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ui } from "./ui";

export const DEMO_VIDEO = "/demo.mp4";

/** [데모 영상] 버튼. 누르면 영상 대화상자가 열린다. */
export default function DemoVideoButton({ className, children }: { className: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && <DemoVideoDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** 영상 대화상자. 열리면 [닫기]에 포커스, Esc로 닫고, 닫히면 연 버튼으로 포커스를 되돌린다. */
function DemoVideoDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
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
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-[#1B1B18]/60 px-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-video-title"
        className={`${ui.cardXl} ${ui.shadow} flex w-full max-w-[1120px] flex-col gap-3 p-4`}
      >
        <div className="flex items-center gap-4 px-1">
          <h2 id="demo-video-title" className={ui.sectionTitle}>
            데모 영상
          </h2>
          <p className={`${ui.help} flex-1`}>실제 화면이에요. 직원 링크 → 매장 조건 → 근무표를 못 만들 때의 대안 → 확정까지 2분 안에 보여요.</p>
          <button ref={closeRef} type="button" onClick={onClose} className={ui.textSm}>
            닫기
          </button>
        </div>
        <video src={DEMO_VIDEO} controls autoPlay playsInline aria-label="데모 영상" className="aspect-[16/10] w-full rounded-lg bg-[#1B1B18]">
          이 브라우저에서는 영상을 재생할 수 없어요.
        </video>
      </div>
    </div>
  );
}
