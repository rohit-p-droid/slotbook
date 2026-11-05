export interface LogContext {
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  [key: string]: any;
}

export const logger = {
  info(message: string, context?: LogContext) {
    console.log(
      JSON.stringify({
        level: 'info',
        timestamp: new Date().toISOString(),
        message,
        ...context,
      })
    );
  },
  warn(message: string, context?: LogContext) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        timestamp: new Date().toISOString(),
        message,
        ...context,
      })
    );
  },
  error(message: string, error?: any, context?: LogContext) {
    console.error(
      JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        message,
        errorMessage: error?.message || error,
        stack: error?.stack,
        ...context,
      })
    );
  },
};
