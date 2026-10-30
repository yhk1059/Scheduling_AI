"use client";

import dynamic from "next/dynamic";

// 세션과 캐시를 브라우저에서만 읽으므로 셸은 클라이언트에서만 렌더한다(하이드레이션 불일치 방지).
const AppShell = dynamic(() => import("@/components/AppShell"), { ssr: false });

export default function AppPage() {
  return <AppShell />;
}
