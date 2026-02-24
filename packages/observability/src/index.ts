export type LogContext = Record<string, string | number | boolean | undefined>;

export function logInfo(message: string, ctx: LogContext = {}): void {
  console.log(JSON.stringify({ level: "info", message, ...ctx }));
}

export function logError(message: string, ctx: LogContext = {}): void {
  console.error(JSON.stringify({ level: "error", message, ...ctx }));
}
