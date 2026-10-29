import type { Metadata } from "next";

import SampleDemo from "@/components/SampleDemo";

export const metadata: Metadata = {
  title: "샘플 데모 · 간호사 근무표",
};

export default function DemoPage() {
  return <SampleDemo />;
}
