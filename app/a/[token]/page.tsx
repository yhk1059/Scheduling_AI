import type { Metadata } from "next";
import { Suspense } from "react";

import AvailabilityForm from "@/components/AvailabilityForm";

export const metadata: Metadata = {
  title: "가능 시간 입력 · 매장 직원 근무표",
  robots: { index: false },
  referrer: "no-referrer",
};

async function TokenForm({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AvailabilityForm token={token} />;
}

export default function AvailabilityPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense>
      <TokenForm params={params} />
    </Suspense>
  );
}
