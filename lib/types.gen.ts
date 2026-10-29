/* eslint-disable */
// 자동 생성 파일. 직접 수정하지 말고 `npm run gen:types`로 다시 만든다(backend/domain/models.py 기준).

export type SolveResponse = SolveOk | SolveInfeasible | SolveTimeout;
export type TranslateResponse = TranslateOk | TranslateClarify | TranslateUnsupported;
export type ConstraintSpec = CountRule | SequenceRule | BalanceRule | FixedAssignment;

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
  config?: WardConfig;
  /**
   * @minItems 1
   */
  nurses: [Nurse, ...Nurse[]];
  period: Period;
  holidays?: number[];
  constraints?: (CountRule | SequenceRule | BalanceRule | FixedAssignment)[];
  carry_over?: CarryOverRow[];
  previous?: {
    [k: string]: string[];
  } | null;
  history?: History | null;
  input_version: number;
}
export interface WardConfig {
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
  active?: boolean;
}
export interface Nurse {
  id: string;
  name: string;
  years: number;
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
export interface CountRule {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  priority?: "high" | "normal" | "low";
  type: "count";
  params: CountParams;
}
export interface CountParams {
  people?: People;
  days?: Days;
  shifts: Shifts;
  per: "day" | "person" | "person_week" | "person_window";
  window?: number | null;
  measure?: "count" | "hours";
  min?: number | null;
  max?: number | null;
}
export interface People {
  ids?: string[] | null;
  tags?: string[] | null;
  exclude_tags?: string[];
  min_years?: number | null;
  max_years?: number | null;
}
export interface Days {
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
export interface SequenceRule {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  priority?: "high" | "normal" | "low";
  type: "sequence";
  params: SequenceParams;
}
export interface SequenceParams {
  people?: People1;
  forbid?: [[Shifts, Shifts, ...Shifts[]], ...[Shifts, Shifts, ...Shifts[]][]] | null;
  run?: Shifts | null;
  min_len?: number | null;
  max_len?: number | null;
  after?: Shifts | null;
  then_off?: number | null;
}
export interface People1 {
  ids?: string[] | null;
  tags?: string[] | null;
  exclude_tags?: string[];
  min_years?: number | null;
  max_years?: number | null;
}
export interface BalanceRule {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  priority?: "high" | "normal" | "low";
  type: "balance";
  params: BalanceParams;
}
export interface BalanceParams {
  people?: People2;
  days?: Days1;
  shifts: Shifts;
  measure?: "count" | "hours";
  with_history?: boolean;
  max_gap?: number;
}
export interface People2 {
  ids?: string[] | null;
  tags?: string[] | null;
  exclude_tags?: string[];
  min_years?: number | null;
  max_years?: number | null;
}
export interface Days1 {
  kind?: "all" | "weekday" | "weekend" | "holiday";
  weekdays?: number[] | null;
  days?: number[] | null;
}
/**
 * 칸 고정(수동 고정, 지난 날짜 잠금). 규칙이 아니라 데이터라서 항상 hard다.
 */
export interface FixedAssignment {
  id: string;
  scope: "ward" | "period";
  hardness?: "hard" | "soft";
  weight?: number;
  source_text: string;
  enabled?: boolean;
  type: "fixed_assignment";
  params: FixedAssignmentParams;
}
export interface FixedAssignmentParams {
  nurse_id: string;
  day: number;
  shift: string;
}
export interface CarryOverRow {
  nurse_id: string;
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
    [k: string]: NurseStats;
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
export interface NurseStats {
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
  nurse_id?: string | null;
  day?: number | null;
  detail: string;
}
export interface DiffCell {
  nurse_id: string;
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
  scope: "ward" | "period";
  context: TranslateContext;
  input_version: number;
}
export interface TranslateContext {
  config?: WardConfig1;
  nurses: Nurse[];
  period: Period;
  holidays?: number[];
  today: string;
}
export interface WardConfig1 {
  /**
   * @minItems 1
   * @maxItems 8
   */
  shifts: [ShiftDef, ...ShiftDef[]];
}
export interface TranslateOk {
  status: "ok";
  input_version: number;
  constraints: (CountRule | SequenceRule | BalanceRule | FixedAssignment)[];
  config_changes?: ShiftChange[];
}
/**
 * 설정 변경 카드(ADR-018): 근무 코드 추가·수정. 삭제는 설정 화면에서만 한다.
 */
export interface ShiftChange {
  action: "add" | "update";
  shift: ShiftDef;
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
export interface ConstraintChange {
  action: "disable" | "update";
  constraint_id: string;
  params?: {
    [k: string]: unknown;
  } | null;
  hardness?: ("hard" | "soft") | null;
}
export interface ErrorBody {
  error: ErrorDetail;
}
export interface ErrorDetail {
  code: string;
  message: string;
  request_id: string;
}
