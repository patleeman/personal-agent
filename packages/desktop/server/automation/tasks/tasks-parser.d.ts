interface ParsedCronField {
  values: Set<number>;
  wildcard: boolean;
}
export interface ParsedCronExpression {
  raw: string;
  minute: ParsedCronField;
  hour: ParsedCronField;
  dayOfMonth: ParsedCronField;
  month: ParsedCronField;
  dayOfWeek: ParsedCronField;
}
interface CronTaskSchedule {
  type: 'cron';
  expression: string;
  parsed: ParsedCronExpression;
}
interface AtTaskSchedule {
  type: 'at';
  at: string;
  atMs: number;
}
export type ParsedTaskSchedule = CronTaskSchedule | AtTaskSchedule;
export interface ParsedTaskDefinition {
  key: string;
  filePath: string;
  fileName: string;
  id: string;
  title?: string;
  enabled: boolean;
  schedule: ParsedTaskSchedule;
  prompt: string;
  profile: string;
  modelRef?: string;
  thinkingLevel?: string;
  cwd?: string;
  timeoutSeconds: number;
}
interface ParseTaskDefinitionOptions {
  filePath: string;
  rawContent: string;
  defaultTimeoutSeconds: number;
}
export declare function parseCronExpression(rawExpression: string): ParsedCronExpression;
export declare function cronMatches(expression: ParsedCronExpression, at: Date): boolean;
export declare function parseTaskDefinition(options: ParseTaskDefinitionOptions): ParsedTaskDefinition;
export {};
