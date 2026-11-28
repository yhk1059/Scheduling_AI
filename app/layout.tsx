import type { Metadata } from "next";
import "./globals.css";

const TAGLINE = "직원은 링크로 가능 시간을 칠하고, 매니저는 매장 조건을 말로 적어요. 막히면 이유와 해결책을 알려 드려요.";

export const metadata: Metadata = {
  metadataBase: new URL("https://optimize-schedule-ai.vercel.app"),
  title: { default: "스케줄링 AI · 근무표", template: "%s · 스케줄링 AI" },
  description: "말로 짜는 매장 직원 근무표",
  // 메신저·SNS 미리보기. 이미지는 npm run og로 만든다.
  openGraph: {
    title: "스케줄링 AI · 말로 짜는 매장 직원 근무표",
    description: TAGLINE,
    url: "/",
    siteName: "스케줄링 AI",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "스케줄링 AI · 매장 조건은 말로, 근무표는 버튼 하나로" }],
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className="h-full antialiased"
    >
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col bg-page font-sans text-ink">
        {children}
      </body>
    </html>
  );
}
