export interface SqliteRunResult {
    changes: number;
    lastInsertRowid: number | bigint;
}
export interface SqliteStatement {
    run(...params: unknown[]): SqliteRunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
}
export interface SqliteDatabase {
    exec(sql: string): void;
    prepare(sql: string): SqliteStatement;
    close(): void;
    pragma(statement: string): void;
    transaction<TArgs extends unknown[]>(fn: (...args: TArgs) => void): (...args: TArgs) => void;
}
export declare function openSqliteDatabase(path: string): SqliteDatabase;
