# 번역 eval 결과

- 실행 시각: 2026-11-05T20:21:22+09:00
- 모델: `claude-sonnet-5-5`
- 데이터셋: `eval/dataset.jsonl` (102개)
- 판정: 의미 기준(무작위 근무표 50개 + 기대 규칙의 세기마다 세는 칸을 뒤집은 근무표 4개, 시드 20261030, 위반은 evaluate.evaluate_rule)

- 합격 기준: 전체 ≥ 90% · time-window ≥ 90% → **합격**

## 묶음별 정확도

| 묶음 | 케이스 | 완전 일치율 | 목표 | status 정확도 | 제약 F1 | 스키마 유효율 |
|---|---|---|---|---|---|---|
| basic | 43 | 93.0% | - | 100.0% | 92.3% | 100.0% |
| config | 9 | 100.0% | - | 100.0% | 100.0% | 100.0% |
| time-window | 17 | 100.0% | ≥ 90% | 100.0% | 100.0% | 100.0% |
| hours | 7 | 100.0% | - | 100.0% | 100.0% | 100.0% |
| tag | 11 | 90.9% | - | 100.0% | 88.9% | 100.0% |
| conditional | 7 | 100.0% | - | 100.0% | 100.0% | 100.0% |
| pair | 8 | 100.0% | - | 100.0% | 100.0% | 100.0% |
| 전체 | 102 | 96.1% | ≥ 90% | 100.0% | 96.3% | 100.0% |

## 전체 지표

| 지표 | 값 |
|---|---|
| 케이스 수 | 102 |
| 스키마 유효율 | 100.0% |
| status 정확도 | 100.0% |
| 제약 precision | 96.3% |
| 제약 recall | 96.3% |
| 제약 F1 | 96.3% |
| 케이스 완전 일치율 | 96.1% |
| clarify 정확도 | 100.0% |
| unsupported 정확도 | 100.0% |
| 평균 재시도 횟수 | 0.03 |
| 평균 지연(초) | 2.95 |
| p95 지연(초) | 5.40 |
| 입력 토큰 합계 | 1,776,830 |
| 출력 토큰 합계 | 28,609 |

## 실패 케이스 (4개)

| id | set | 입력 | 기대값 | 실제값 |
|---|---|---|---|---|
| w01 | basic | 마감 다음 날은 무조건 쉬게 해 주세요 | ok [{"body": {"for_each": {"per": "person_day"}, "kind": "require", "then": {"left": {"offset": [1, 1], "shifts": {"not_in": ["O"]}}, "op": "eq", "right": 0}, "when": {"all": [{"left": {"offset": [0, 0], "shifts": {"in": ["C"]}}, "op": "ge", "right": 1}, {"left": {"offset": [1, 1], "shifts": {"not_in": ["C"]}}, "op": "ge", "right": 1}]}}, "type": "rule"}] | ok [{"body": {"for_each": {"per": "person_day"}, "kind": "require", "then": {"left": {"offset": [1, 1], "shifts": {"not_in": ["O"]}}, "op": "eq", "right": 0.0}, "when": {"left": {"offset": [0, 0], "shifts": {"in": ["C"]}}, "op": "ge", "right": 1.0}}, "type": "rule"}] |
| m01 | basic | 이영희 15~17일 휴가 | ok [{"body": {"for_each": {"days": {"days": [14, 15, 16]}, "people": {"ids": ["e01"]}, "per": "person"}, "kind": "require", "then": {"left": {"shifts": {"not_in": ["O"]}}, "op": "le", "right": {"value": "max"}}}, "type": "rule", "values": {"max": {"label": "최대 횟수", "value": 0}}}] | ok [{"body": {"for_each": {"days": {"days": [15, 16, 17]}, "people": {"ids": ["e01"]}, "per": "person"}, "kind": "require", "then": {"left": {"shifts": {"not_in": ["O"]}}, "op": "le", "right": {"value": "max"}}}, "type": "rule", "values": {"max": {"label": "최대 횟수", "value": 0.0}}}] |
| b14 | basic | 마감은 최소 2일 이상 이어서 하게 해 주세요 | ok [{"body": {"for_each": {"per": "person_day"}, "kind": "require", "then": {"left": {"offset": [1, 1], "shifts": {"not_in": ["C"]}}, "op": "eq", "right": 0}, "when": {"all": [{"left": {"offset": [-1, -1], "shifts": {"not_in": ["C"]}}, "op": "ge", "right": 1}, {"left": {"offset": [0, 0], "shifts": {"in": ["C"]}}, "op": "ge", "right": 1}]}}, "type": "rule"}] | ok [{"body": {"for_each": {"per": "person_day"}, "kind": "require", "then": {"left": {"offset": [1, 1], "shifts": {"in": ["C"]}}, "op": "ge", "right": 1.0}, "when": {"all": [{"left": {"offset": [-1, -1], "shifts": {"not_in": ["C"]}}, "op": "ge", "right": 1.0}, {"left": {"offset": [0, 0], "shifts": {"in": ["C"]}}, "op": "ge", "right": 1.0}]}}, "type": "rule"}] |
| a06 | tag | 신입은 마감 하지 않게 해 주세요 | ok [{"body": {"for_each": {"people": {"tags": ["신입"]}, "per": "person"}, "kind": "require", "then": {"left": {"shifts": {"in": ["C"]}}, "op": "le", "right": {"value": "max"}}}, "type": "rule", "values": {"max": {"label": "최대 횟수", "value": 0}}}] | ok [{"body": {"for_each": {"people": {"tags": ["신입"]}, "per": "person"}, "kind": "require", "then": {"left": {"shifts": {"in": ["C"]}}, "op": "le", "right": {"value": "max"}}}, "hardness": "soft", "type": "rule", "values": {"max": {"label": "최대 횟수", "value": 0.0}}}] |

## 실행 이력

| 실행 시각 | 모델 | 케이스 | basic | config | time-window | hours | tag | conditional | pair | 전체 | 스키마 유효율 | 합격 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-31T00:01:28+09:00 | `claude-sonnet-5-5` | 100 | 97.6% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 99.0% | 100.0% | 합격 |
| 2026-11-05T20:12:31+09:00 | `claude-sonnet-5-5` | 102 | 95.3% | 100.0% | 100.0% | 100.0% | 90.9% | 100.0% | 100.0% | 97.1% | 100.0% | 합격 |
| 2026-11-05T20:21:22+09:00 | `claude-sonnet-5-5` | 102 | 93.0% | 100.0% | 100.0% | 100.0% | 90.9% | 100.0% | 100.0% | 96.1% | 100.0% | 합격 |
