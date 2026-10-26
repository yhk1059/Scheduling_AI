import Link from "next/link";

// 임시 페이지. 랜딩은 step 14에서 만든다.
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[1360px] px-8 py-16">
      <Link
        href="/app"
        className="inline-flex h-10 items-center rounded-md border border-[#155E75] bg-[#155E75] px-4 text-sm font-medium text-white transition-colors duration-[120ms] hover:bg-[#0E4A5C]"
      >
        데모 시작
      </Link>
    </main>
  );
}
