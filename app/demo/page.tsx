"use client";

import dynamic from "next/dynamic";

// 앱과 같은 셸을 체험으로 연다. 세션은 브라우저에서만 확인하므로 클라이언트에서만 렌더한다.
const AppShell = dynamic(() => import("@/components/AppShell"), { ssr: false });

export default function DemoPage() {
  return <AppShell demo />;
}
