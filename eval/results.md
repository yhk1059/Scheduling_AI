# 번역 eval 결과

- 실행 시각: 2026-10-30T14:37:22+09:00
- 모델: `claude-sonnet-5-5`
- 데이터셋: `eval/dataset.jsonl` (105개)
- 판정: 의미 기준(무작위 근무표 50개 + 기대 규칙의 세기마다 세는 칸을 뒤집은 근무표 4개, 시드 20261030, 위반은 evaluate.evaluate_rule)

## set별 지표

| set | 케이스 | 완전 일치율 | 목표 | status 정확도 | 제약 F1 | 스키마 유효율 |
|---|---|---|---|---|---|---|
| legacy | 49 | 98.0% | ≥ 95% | 100.0% | 98.1% | 100.0% |
| new | 30 | 96.7% | ≥ 95% | 100.0% | 96.8% | 100.0% |
| expr | 26 | 100.0% | ≥ 85% | 100.0% | 100.0% | 100.0% |
| 기존 legacy+new 합산 | 79 | 97.5% | ≥ 95% | | | |

## 전체 지표

| 지표 | 값 |
|---|---|
| 케이스 수 | 105 |
| 스키마 유효율 | 100.0% |
| status 정확도 | 100.0% |
| 제약 precision | 98.2% |
| 제약 recall | 98.2% |
| 제약 F1 | 98.2% |
| 케이스 완전 일치율 | 98.1% |
| clarify 정확도 | 100.0% |
| unsupported 정확도 | 100.0% |
| 평균 재시도 횟수 | 0.03 |
| 평균 지연(초) | 2.95 |
| p95 지연(초) | 4.49 |
| 입력 토큰 합계 | 1,602,768 |
| 출력 토큰 합계 | 31,924 |

## 실패 케이스 (2개)

| id | set | 입력 | 기대값 | 실제값 |
|---|---|---|---|---|
| w01 | legacy | 나이트 다음 날은 무조건 쉬게 해 주세요 | ok [{"body": {"for_each": {"per": "person_day"}, "kind": "require", "then": {"left": {"offset": [1, 1], "shifts": {"not_in": ["O"]}}, "op": "eq", "right": 0.0}, "when": {"all": [{"left": {"offset": [0, 0], "shifts": {"in": ["N"]}}, "op": "ge", "right": 1.0}, {"left": {"offset": [1, 1], "shifts": {"not_in": ["N"]}}, "op": "ge", "right": 1.0}]}}, "type": "rule"}] | ok [{"body": {"for_each": {"per": "person_day"}, "kind": "require", "then": {"left": {"offset": [1, 1], "shifts": {"not_in": ["O"]}}, "op": "eq", "right": 0.0}, "when": {"left": {"offset": [0, 0], "shifts": {"in": ["N"]}}, "op": "ge", "right": 1.0}}, "type": "rule"}] |
| b10 | new | 신규 선생님들은 나이트 하지 않게 해 주세요 | ok [{"body": {"for_each": {"people": {"tags": ["신규"]}, "per": "person"}, "kind": "require", "then": {"left": {"shifts": {"in": ["N"]}}, "op": "le", "right": {"value": "max"}}}, "type": "rule", "values": {"max": {"label": "최대 횟수", "value": 0.0}}}] | ok [{"body": {"for_each": {"people": {"tags": ["신규"]}, "per": "person"}, "kind": "require", "then": {"left": {"shifts": {"in": ["N"]}}, "op": "le", "right": {"value": "max"}}}, "hardness": "soft", "type": "rule", "values": {"max": {"label": "최대 나이트 횟수", "value": 0.0}}}] |

## 실행 이력

| 실행 시각 | 모델 | 케이스 | legacy | new | expr | 기존 합산 | 스키마 유효율 | 게이트 |
|---|---|---|---|---|---|---|---|---|
| 2026-10-30T14:29:27+09:00 | `claude-sonnet-5-5` | 105 | 100.0% | 96.7% | 100.0% | 98.7% | 100.0% | 통과 |
| 2026-10-30T14:37:22+09:00 | `claude-sonnet-5-5` | 105 | 98.0% | 96.7% | 100.0% | 97.5% | 100.0% | 통과 |
