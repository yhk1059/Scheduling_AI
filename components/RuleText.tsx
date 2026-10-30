import type { RuleSentence } from "@/lib/wording";

/** 카드 해석 결과(식에서 만든 문장). 조정 가능한 값은 점선 밑줄과 mono로 보인다. */
export default function RuleText({ sentence }: { sentence: RuleSentence }) {
  return (
    <>
      {sentence.parts.map((p, i) =>
        "value" in p ? (
          <span key={i} className="font-mono underline decoration-dotted underline-offset-2">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
