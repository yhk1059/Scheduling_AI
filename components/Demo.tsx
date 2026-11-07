"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { useAppStore } from "@/lib/store";
import { signInWithGoogle } from "@/lib/supabase";

import { LOGIN_ERROR } from "./Account";
import Dialog from "./Dialog";
import { ui } from "./ui";

/** 체험을 끝내고 Google 로그인으로 간다. 실패하면 error. Account.tsx의 useGoogleLogin과 같은 모양이되 exitDemo를 먼저 부른다. */
export function useStartOwnShop() {
  const exitDemo = useAppStore((s) => s.exitDemo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const start = async () => {
    setBusy(true);
    setError(false);
    // 체험 데이터가 로그인 뒤 내 매장으로 올라가지 않게 먼저 비운다
    exitDemo();
    try {
      await signInWithGoogle();
    } catch {
      setBusy(false);
      setError(true);
    }
  };
  return { busy, error, start, label: busy ? "이동 중…" : "내 매장으로 시작하기" };
}

/** 체험 상단 바 오른쪽: "체험 중" 배지 + 안내 + [내 매장으로 시작하기] + [나가기]. */
export function DemoBar() {
  const router = useRouter();
  const exitDemo = useAppStore((s) => s.exitDemo);
  const { busy, error, start, label } = useStartOwnShop();
  const leave = () => {
    exitDemo();
    router.push("/");
  };
  return (
    <div className="flex items-center gap-3">
      <span className={`${ui.badge} ${ui.badgeTone.draft}`}>체험 중</span>
      <span className={ui.help}>저장되지 않아요</span>
      <span className="flex flex-col items-end gap-1">
        <button type="button" onClick={() => void start()} disabled={busy} className={ui.primarySm}>
          {label}
        </button>
        {error && (
          <span role="alert" className={ui.error}>
            {LOGIN_ERROR}
          </span>
        )}
      </span>
      <button type="button" onClick={leave} className={ui.textSm}>
        나가기
      </button>
    </div>
  );
}

/** 체험에서 막는 동작을 눌렀을 때의 대화상자(확정 등). */
export function DemoGateDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { busy, error, start, label } = useStartOwnShop();
  return (
    <Dialog
      title={title}
      onClose={onClose}
      secondary={{ label: "닫기", onClick: onClose }}
      primary={{ label, onClick: () => void start(), disabled: busy }}
    >
      {children}
      {error && (
        <p role="alert" className={ui.error}>
          {LOGIN_ERROR}
        </p>
      )}
    </Dialog>
  );
}
