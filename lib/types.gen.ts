/* eslint-disable */
// 자동 생성 파일. 직접 수정하지 말고 `npm run gen:types`로 다시 만든다(backend/domain/models.py 기준).

export type SolveResponse = SolveOk | SolveInfeasible | SolveTimeout;
export type TranslateResponse = TranslateOk | TranslateClarify | TranslateUnsupported;
export type ConstraintSpec = Rule | FixedAssignment;

export interface ApiTypes {
  ScheduleRequest: ScheduleRequest;
  SolveResponse: SolveResponse;
  TranslateRequest: TranslateRequest;
  TranslateResponse: TranslateResponse;
  ExplainRequest: ExplainRequest;
  ExplainResponse: ExplainResponse;
  ErrorBody: ErrorBody;
  ConstraintSpec: ConstraintSpec;
  [k: string]: unknown;
}
export interface ScheduleRequest {
  config?: ShopConfig;
  /**
   * @minItems 1
   */
  employees: [Employee, ...Employee[]];
  period: Period;
  holidays?: number[];
  constraints?: (Rule | FixedAssignment)[];
  carry_over?: CarryOverRow[];
  previous?: {
    [k: string]: string[];
  } | null;
  history?: History | null;
  input_version: number;
}
export interface ShopConfig {
  /**
   * @minItems 1
   * @maxItems 8
   */
  shifts: [ShiftDef, ...ShiftDef[]];
}
export interface ShiftDef {
  code: string;
  name: string;
  hours: number;
  parts?: string[];
  start?: string | null;
  end?: string | null;
  active?: boolean;
}
export interface Employee {
  id: string;
  name: string;
  /**
   * @maxItems 5
   */
  tags?: string[];
}
/**
 * 시작일 + 길이(ADR-015). 날짜는 기간 안의 1..length 인덱스로 다룬다.
 */
export interface Period {
  start_date: string;
  length: number;
}
/**
 * 규칙 = 범위 + 본문. 기본 hardness는 require가 hard, balance가 soft·낮음(블록과 같다).
 */
export interface Rule {
  id: string;
  scope: "shop" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  priority?: "high" | "normal" | "low";
  type: "rule";
  default?: boolean;
  values?: {
    [k: string]: Value;
  };
  body: Require | Balance;
}
/**
 * 조정 가능한 값. 카드 [수정]과 완화 제안은 이 값만 바꾼다.
 *
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-z0-9_]{0,23}$".
 */
export interface Value {
  value: number;
  label: string;
}
export interface Require {
  kind: "require";
  for_each: ForEach;
  when?: Cmp | All | Any | null;
  then: Cmp | All | Any;
}
export interface ForEach {
  per: "period" | "day" | "person" | "person_day" | "person_week" | "person_window";
  people?: People;
  days?: Days;
  window?: number | null;
}
export interface People {
  ids?: string[] | null;
  tags?: string[] | null;
  exclude_tags?: string[];
}
export interface Days {
  kind?: "all" | "weekday" | "weekend" | "holiday";
  weekdays?: number[] | null;
  days?: number[] | null;
}
export interface Cmp {
  left: Count;
  op: "ge" | "le" | "eq";
  right: number | ValueRef | Count;
}
/**
 * 세는 칸: (who 또는 묶인 사람) × (묶인 날을 days로 거른 것) 중 shifts에 맞는 칸의 수(또는 근무 시간).
 */
export interface Count {
  who?: People1 | null;
  days?: Days1;
  offset?: [unknown, unknown, ...unknown[]] | null;
  shifts: Shifts;
  measure?: "count" | "hours";
}
export interface People1 {
  ids?: string[] | null;
  tags?: string[] | null;
  exclude_tags?: string[];
}
export interface Days1 {
  kind?: "all" | "weekday" | "weekend" | "holiday";
  weekdays?: number[] | null;
  days?: number[] | null;
}
/**
 * 칸이 맞는다 = 그 칸 코드의 covers가 in과 겹친다(또는 not_in과 겹치지 않는다).
 */
export interface Shifts {
  in?: [string, ...string[]] | null;
  not_in?: [string, ...string[]] | null;
}
export interface ValueRef {
  value: string;
}
export interface All {
  /**
   * @minItems 2
   * @maxItems 4
   */
  all: [Cmp, Cmp, ...Cmp[]];
}
export interface Any {
  /**
   * @minItems 2
   * @maxItems 4
   */
  any: [Cmp, Cmp, ...Cmp[]];
}
/**
 * 내장 함수 고르게: 고른 사람 사이 차이를 줄인다(고르게 블록과 같다).
 */
export interface Balance {
  kind: "balance";
  people?: People2;
  days?: Days2;
  shifts: Shifts;
  measure?: "count" | "hours";
  with_history?: boolean;
  max_gap?: number | ValueRef;
}
export interface People2 {
  ids?: string[] | null;
  tags?: string[] | null;
  exclude_tags?: string[];
}
export interface Days2 {
  kind?: "all" | "weekday" | "weekend" | "holiday";
  weekdays?: number[] | null;
  days?: number[] | null;
}
/**
 * 칸 고정(수동 고정, 지난 날짜 잠금). 규칙이 아니라 데이터라서 항상 hard다.
 */
export interface FixedAssignment {
  id: string;
  scope: "shop" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "fixed_assignment";
  params: FixedAssignmentParams;
}
export interface FixedAssignmentParams {
  employee_id: string;
  day: number;
  shift: string;
}
export interface CarryOverRow {
  employee_id: string;
  /**
   * @maxItems 7
   */
  shifts: string[];
}
/**
 * 최근 28일 확정 배정 원본. 고르게 블록마다 세는 일은 백엔드가 한다(ADR-018).
 */
export interface History {
  start_date: string;
  rows: {
    /**
     * @maxItems 28
     */
    [k: string]: string[];
  };
  holidays?: string[];
}
export interface SolveOk {
  status: "ok";
  input_version: number;
  result: ScheduleResult;
}
export interface ScheduleResult {
  assignments: {
    [k: string]: string[];
  };
  summary: Summary;
  stats: {
    [k: string]: EmployeeStats;
  };
  soft_violations: SoftViolation[];
  diff?: DiffCell[] | null;
  optimal: boolean;
}
export interface Summary {
  preferences_total: number;
  preferences_met: number;
  soft_violation_count: number;
}
export interface EmployeeStats {
  counts: {
    [k: string]: number;
  };
  hours: number;
  weekend_holiday_work: number;
  max_consecutive_work: number;
  preference_rate: number | null;
  deviation: number;
}
export interface SoftViolation {
  constraint_id: string;
  employee_id?: string | null;
  day?: number | null;
  detail: string;
}
export interface DiffCell {
  employee_id: string;
  day: number;
  before: string;
  after: string;
}
export interface SolveInfeasible {
  status: "infeasible";
  input_version: number;
  conflicts: Conflict[];
}
export interface Conflict {
  constraint_id: string;
  type: string;
  source_text: string;
}
export interface SolveTimeout {
  status: "timeout";
  input_version: number;
}
export interface TranslateRequest {
  text: string;
  scope: "shop" | "period";
  context: TranslateContext;
  input_version: number;
}
export interface TranslateContext {
  config?: ShopConfig1;
  employees: Employee[];
  period: Period;
  holidays?: number[];
  today: string;
}
export interface ShopConfig1 {
  /**
   * @minItems 1
   * @maxItems 8
   */
  shifts: [ShiftDef, ...ShiftDef[]];
}
export interface TranslateOk {
  status: "ok";
  input_version: number;
  constraints: (Rule | FixedAssignment)[];
  config_changes?: ShiftChange[];
  examples?: {
    /**
     * @maxItems 3
     */
    [k: string]: RuleExample[];
  };
}
/**
 * 설정 변경 카드(ADR-018): 근무 코드 추가·수정. 삭제는 설정 화면에서만 한다.
 */
export interface ShiftChange {
  action: "add" | "update";
  shift: ShiftDef;
}
/**
 * 예시 판정(설계 §4.2): 샘플 근무표에서 규칙을 어긴 사례 하나. 카드가 작은 근무 띠로 그린다.
 */
export interface RuleExample {
  /**
   * @minItems 1
   * @maxItems 3
   */
  employee_ids: [string, ...string[]];
  /**
   * @minItems 1
   * @maxItems 7
   */
  days: [number, ...number[]];
  cells: {
    [k: string]: string[];
  };
  marks: [unknown, unknown, ...unknown[]][];
  detail: string;
}
export interface TranslateClarify {
  status: "clarify";
  input_version: number;
  question: string;
}
export interface TranslateUnsupported {
  status: "unsupported";
  input_version: number;
  reason: string;
}
export interface ExplainRequest {
  request: ScheduleRequest;
  conflicts: Conflict[];
}
export interface ExplainResponse {
  text: string;
  proposals: RelaxationProposal[];
  fallback: boolean;
  input_version: number;
}
export interface RelaxationProposal {
  title: string;
  description: string;
  changes: ConstraintChange[];
  verified_summary?: Summary | null;
}
/**
 * 완화 변경(★7): 끄기, 값 하나 바꾸기, 반드시/가능하면 바꾸기. 식 구조는 바꾸지 않는다.
 */
export interface ConstraintChange {
  action: "disable" | "set_value" | "set_hardness";
  constraint_id: string;
  hardness?: ("hard" | "soft") | null;
  name?: string | null;
  value?: number | null;
}
export interface ErrorBody {
  error: ErrorDetail;
}
export interface ErrorDetail {
  code: string;
  message: string;
  request_id: string;
}
