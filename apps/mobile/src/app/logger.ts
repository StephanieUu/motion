type LogContext = Record<string, unknown>

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return { value: String(error) }
}

export const logger = {
  info(message: string, context?: LogContext) {
    console.info(`[motion] ${message}`, context ?? {})
  },
  error(message: string, error: unknown, context?: LogContext) {
    console.error(`[motion] ${message}`, {
      ...context,
      error: normalizeError(error),
    })
  },
}
