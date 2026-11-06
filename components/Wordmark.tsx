import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/product";

const MARK_COLORS = {
  accent: { bg: "#155E75", fg: "#FFFFFF" },
  inverse: { bg: "#FFFFFF", fg: "#155E75" },
  muted: { bg: "#66665E", fg: "#FFFFFF" },
};

const QUOTE_PATH =
  "M10.5 7.5c-2.6.6-4 2.5-4 5v4H11v-4.5H9c0-1 .5-1.7 1.5-2V7.5zM17.5 7.5c-2.6.6-4 2.5-4 5v4H18v-4.5h-2c0-1 .5-1.7 1.5-2V7.5z";

/** 여는 따옴표 마크. */
export function Mark({ size, tone = "accent" }: { size: number; tone?: "accent" | "inverse" | "muted" }) {
  const { bg, fg } = MARK_COLORS[tone];
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} className="shrink-0">
      <rect width="24" height="24" rx="6" fill={bg} />
      <path fill={fg} d={QUOTE_PATH} />
    </svg>
  );
}

/** 사각형 없는 따옴표 글리프(규칙·요청 카드의 원문 앞). */
export function QuoteGlyph({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} className="shrink-0">
      <path fill="#155E75" d={QUOTE_PATH} />
    </svg>
  );
}

const SIZES = {
  bar: { mark: 22, text: "gap-2 text-[18px] font-bold tracking-[-0.02em]" },
  hero: { mark: 36, text: "gap-3 text-[32px] font-bold" },
  landing: { mark: 72, text: "gap-4 text-[52px] font-bold tracking-[-0.03em] lg:text-[72px]" },
  small: { mark: 18, text: "gap-1.5 text-[13px] font-semibold" },
};

/** 워드마크: 마크 + "스케줄링 AI". href가 있으면 홈 링크다. */
export default function Wordmark({
  size,
  href,
  tone = "accent",
}: {
  size: "bar" | "hero" | "landing" | "small";
  href?: string;
  tone?: "accent" | "inverse";
}) {
  const { mark, text } = SIZES[size];
  const className = `inline-flex items-center ${text} ${tone === "inverse" ? "text-white" : "text-[#1B1B18]"}`;
  const content = (
    <>
      <Mark size={mark} tone={tone} />
      {PRODUCT_NAME}
    </>
  );
  if (!href) return <span className={className}>{content}</span>;
  return (
    <Link
      href={href}
      aria-label={`${PRODUCT_NAME} 홈`}
      className={`${className} rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155E75]`}
    >
      {content}
    </Link>
  );
}
