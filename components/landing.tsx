import type { ReactNode } from "react";

import Link from "next/link";

import { ui } from "@/components/ui";
import { Mark } from "@/components/Wordmark";
import { PRODUCT_NAME } from "@/lib/product";

// 랜딩(/)과 만든 방식(/how)이 같이 쓰는 레이아웃·문구 조각.

// 저장소를 옮기면 이 한 줄만 바꾼다.
export const REPO_URL = "https://github.com/yhk1059/Scheduling_AI";

export const container = "mx-auto w-full max-w-[1200px] px-5 lg:px-14";
export const section = "border-t border-line py-16 lg:py-28";
const sectionTitle = "text-[32px] leading-[1.15] lg:text-[52px] font-bold tracking-[-0.04em] text-ink";
const lead = "max-w-[640px] text-base leading-relaxed text-body";
export const body = "text-sm leading-relaxed text-body";

export function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className={ui.eyebrow}>{eyebrow}</p>
      <h2 className={sectionTitle}>{title}</h2>
      <p className={lead}>{children}</p>
    </div>
  );
}

export function LandingFooter() {
  const link = "-my-3 inline-flex h-10 items-center hover:text-ink";
  return (
    <footer>
      <div className={`${container} flex flex-col gap-3 py-8 text-xs font-medium text-muted lg:flex-row lg:items-center lg:justify-between`}>
        <span className="flex items-center gap-2">
          <Mark size={18} tone="muted" />
          {PRODUCT_NAME}
        </span>
        <span className="flex items-center gap-4">
          <Link href="/privacy" className={link}>
            개인정보처리방침
          </Link>
          <Link href="/how" className={link}>
            만든 방식
          </Link>
          <a href={REPO_URL} className={link}>
            GitHub
          </a>
        </span>
      </div>
    </footer>
  );
}
