"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useAppStore, type PendingAfterLogin } from "@/lib/store";
import { signInWithGoogle, signOut, supabaseConfigured } from "@/lib/supabase";

import Dialog from "./Dialog";
import { ui } from "./ui";

/** 게스트가 이 동작을 하려면 로그인이 필요한가. Supabase env가 없으면 게스트로만 동작한다. */
export function useNeedsLogin(): boolean {
  const auth = useAppStore((s) => s.auth);
  return supabaseConfigured && auth === null;
}

/** Google 로그인으로 이동. 진행 중 "이동 중…", 실패하면 그 자리에 문구. */
export function useGoogleLogin(before?: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const login = async () => {
    setBusy(true);
    setError(false);
    before?.();
    try {
      await signInWithGoogle();
    } catch {
      setBusy(false);
      setError(true);
    }
  };
  return { busy, error, login, label: busy ? "이동 중…" : "Google로 로그인" };
}

const LOGIN_ERROR = "로그인 페이지로 이동하지 못했어요. 잠시 후 다시 시도해 주세요.";

export function PrivacyLink({ className = ui.text }: { className?: string }) {
  return (
    <Link href="/privacy" className={className}>
      개인정보처리방침
    </Link>
  );
}

export function LoginButton({ className = ui.secondary }: { className?: string }) {
  const { busy, error, login, label } = useGoogleLogin();
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={login} disabled={busy} className={className}>
        {label}
      </button>
      {error && (
        <span role="alert" className={ui.error}>
          {LOGIN_ERROR}
        </span>
      )}
    </span>
  );
}

/** 게스트가 [확정]·[다음 기간 만들기]를 눌렀을 때. 로그인하면 로그인 뒤 그 동작을 이어서 한다. */
export function LoginRequiredDialog({
  action,
  onClose,
  onCsvOnly,
}: {
  action: PendingAfterLogin;
  onClose: () => void;
  /** 확정에서 열렸을 때만. [CSV만 받기] */
  onCsvOnly?: () => void;
}) {
  const requireLogin = useAppStore((s) => s.requireLogin);
  const { busy, error, login, label } = useGoogleLogin(() => requireLogin(action));
  return (
    <Dialog
      title="로그인하고 저장하기"
      onClose={onClose}
      secondary={onCsvOnly ? { label: "CSV만 받기", onClick: onCsvOnly } : { label: "닫기", onClick: onClose }}
      primary={{ label, onClick: login, disabled: busy }}
    >
      <p>이 근무표와 병동을 저장하려면 로그인하세요.</p>
      <div>
        <PrivacyLink className={`${ui.textSm} -ml-2`} />
      </div>
      {error && (
        <p role="alert" className={ui.error}>
          {LOGIN_ERROR}
        </p>
      )}
    </Dialog>
  );
}

/** 로그인 직후 스토어가 묻는 것: 샘플 저장 선택, 서버 우선 안내. */
export function LoginPromptDialog() {
  const prompt = useAppStore((s) => s.loginPrompt);
  const chooseSample = useAppStore((s) => s.chooseSample);
  const dismiss = useAppStore((s) => s.dismissLoginPrompt);
  if (!prompt) return null;
  if (prompt.kind === "sample-choice") {
    // Esc는 지우지 않는 쪽(샘플 저장)으로 닫는다
    const keep = () => void chooseSample(true);
    return (
      <Dialog
        title="샘플 병동 저장"
        onClose={keep}
        secondary={{ label: "빈 병동으로 시작", onClick: () => void chooseSample(false) }}
        primary={{ label: "샘플 저장", onClick: keep }}
      >
        샘플 병동을 내 병동으로 저장할까요, 빈 병동으로 시작할까요?
      </Dialog>
    );
  }
  return (
    <Dialog title="내 병동을 불러왔어요" onClose={dismiss} primary={{ label: "닫기", onClick: dismiss }}>
      저장된 내 병동을 불러왔어요. 이 브라우저에서 입력한 내용은 지웠어요.
    </Dialog>
  );
}

function wardLabel(name: string | undefined): string {
  return name || "이름 없는 병동";
}

/** [내 병동 데이터 삭제] 2단계 확인. */
function DeleteDataDialog({ onClose }: { onClose: () => void }) {
  const wardName = useAppStore((s) => wardLabel(s.ward?.name));
  const deleteWardData = useAppStore((s) => s.deleteWardData);
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const remove = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await deleteWardData();
      onClose();
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };

  if (step === 1)
    return (
      <Dialog
        key="step1"
        title="내 병동 데이터 삭제"
        onClose={onClose}
        secondary={{ label: "취소", onClick: onClose }}
        primary={{ label: "계속", onClick: () => setStep(2) }}
      >
        내 병동 데이터를 모두 지울까요? 되돌릴 수 없어요. Google 계정 연결은 남아요.
      </Dialog>
    );

  const matches = typed.trim() === wardName;
  return (
    <Dialog
      key="step2"
      title="병동 이름을 입력하세요"
      onClose={() => !busy && onClose()}
      secondary={{ label: "취소", onClick: onClose, disabled: busy }}
      primary={{ label: busy ? "삭제 중…" : "삭제", onClick: () => void remove(), disabled: !matches || busy }}
      danger
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="delete-ward-name" className={ui.label}>
          병동 이름 <span className="font-mono">{wardName}</span>
        </label>
        <input
          id="delete-ward-name"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy}
          autoComplete="off"
          className={ui.input}
        />
        {!matches && <p className={ui.help}>병동 이름을 똑같이 입력하면 삭제할 수 있어요.</p>}
      </div>
      {failed && (
        <p role="alert" className={ui.error}>
          삭제하지 못했어요. 잠시 후 다시 시도해 주세요
        </p>
      )}
    </Dialog>
  );
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 상단 바 오른쪽: 저장 상태 + 계정(UI_GUIDE "저장 상태", "계정"). */
export function AccountBar() {
  const auth = useAppStore((s) => s.auth);
  const sync = useAppStore((s) => s.sync);
  const retrySave = useAppStore((s) => s.retrySave);
  const signedOut = useAppStore((s) => s.signedOut);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const logout = async () => {
    setMenuOpen(false);
    try {
      await signOut();
    } finally {
      // 구독이 signedOut()을 부르지만, 로그아웃 요청이 실패해도 이 브라우저의 데이터는 지운다
      if (useAppStore.getState().auth) signedOut();
    }
  };
  const openDelete = () => {
    setMenuOpen(false);
    // 대화상자를 닫으면 메뉴 버튼으로 포커스가 돌아오게 한다
    menuButtonRef.current?.focus();
    setDeleting(true);
  };

  const status =
    auth === null ? (
      <span>이 브라우저에만 저장</span>
    ) : sync.status === "loading" ? (
      <span>불러오는 중…</span>
    ) : sync.status === "saving" ? (
      <span>저장 중…</span>
    ) : sync.status === "error" ? (
      <span className="flex items-center gap-1 text-[#B42318]">
        저장 실패
        <button type="button" onClick={() => void retrySave()} className={ui.textSm}>
          다시 시도
        </button>
      </span>
    ) : (
      <span>
        저장됨{sync.savedAt && <span className="ml-1 font-mono">{hhmm(sync.savedAt)}</span>}
      </span>
    );

  return (
    <div className="flex items-center gap-3 text-xs text-[#66665E]">
      <span role="status">{status}</span>
      {supabaseConfigured &&
        (auth === null ? (
          <LoginButton className={ui.secondarySm} />
        ) : (
          <div ref={menuRef} className="relative flex items-center gap-1">
            <span className="text-xs text-[#3D3D38]">{auth.email}</span>
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="계정 메뉴"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className={ui.textSm}
            >
              <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <path d="M2.5 4.5 6 8l3.5-3.5" />
              </svg>
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute top-full right-0 z-10 mt-1 flex min-w-[180px] flex-col rounded-lg border border-[#E2E2DC] bg-white p-1"
              >
                <button type="button" role="menuitem" onClick={() => void logout()} className={`${ui.textSm} justify-start`}>
                  로그아웃
                </button>
                <button type="button" role="menuitem" onClick={openDelete} className={`${ui.danger} justify-start`}>
                  내 병동 데이터 삭제
                </button>
              </div>
            )}
          </div>
        ))}
      {deleting && <DeleteDataDialog onClose={() => setDeleting(false)} />}
    </div>
  );
}
