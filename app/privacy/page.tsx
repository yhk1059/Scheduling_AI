import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "개인정보처리방침 · 매장 직원 근무표",
};

const EFFECTIVE_DATE = "2026-10-28";

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "1. 수집하는 항목",
    items: [
      "Google 로그인 시: Google 계정 이메일과 고유 식별자",
      "매장 데이터: 매장 이름, 직원 이름·태그, 필요 인원, 매장 조건, 요청, 근무표, 확정 기록",
      "직원 가능 시간: 직원이 링크로 입력한 날짜별 가능 시간. 링크에는 매장 이름과 직원 이름이 함께 저장됩니다.",
      "직원 이름은 이니셜로 입력해도 됩니다.",
    ],
  },
  {
    title: "2. 이용 목적",
    items: ["근무표 작성과 매장 데이터 저장·불러오기에만 씁니다."],
  },
  {
    title: "3. 보관 위치와 기간",
    items: [
      "매장 데이터와 직원 가능 시간을 Supabase(서울 리전)에 저장하고, 매니저가 [내 매장 데이터 삭제]를 할 때까지 보관합니다.",
    ],
  },
  {
    title: "4. 처리 위탁과 국외 이전",
    items: [
      "Supabase: 데이터베이스와 인증(서울 리전)",
      "Vercel: 웹 호스팅과 근무표 계산 서버. 계산 서버는 요청을 저장하지 않습니다.",
      "Anthropic: 자연어로 입력한 매장 조건·요청의 해석과 충돌 설명. 보낼 때 직원 이름은 E01 같은 가명으로 바꾸고, 응답을 받은 뒤 되돌립니다.",
    ],
  },
  {
    title: "5. 삭제 방법",
    items: [
      "계정 메뉴의 [내 매장 데이터 삭제]로 서버에 저장된 매장 데이터와 직원 가능 시간을 즉시 지웁니다.",
      "직원은 매니저에게 자기 가능 시간 삭제를 요청할 수 있습니다.",
      "로그아웃하면 이 브라우저에 남은 매장 데이터를 지웁니다.",
      "Google 계정 연결 정보(이메일)는 남습니다.",
    ],
  },
  {
    title: "6. 서비스 성격",
    items: ["이 서비스는 LLM 활용 역량을 보여 주기 위한 포트폴리오 프로토타입입니다."],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-[1360px] px-8 py-[72px]">
      <div className="flex max-w-[720px] flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link href="/" className="text-xs font-medium text-[#155E75] hover:text-[#0E4A5C]">
            ← 매장 직원 근무표
          </Link>
          <h1 className="text-[22px] font-semibold text-[#1B1B18]">개인정보처리방침</h1>
          <p className="text-xs font-medium text-[#66665E]">
            시행일 <span className="font-mono">{EFFECTIVE_DATE}</span>
          </p>
        </div>
        {SECTIONS.map((s) => (
          <section key={s.title} className="flex flex-col gap-2">
            <h2 className="text-[15px] font-semibold text-[#1B1B18]">{s.title}</h2>
            <ul className="list-disc pl-5 text-sm leading-relaxed text-[#3D3D38]">
              {s.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
