export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogMeta {
  service?: string
  requestId?: string
  duration?: number
  error?: unknown
  [key: string]: unknown
}

function formatValue(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ''}`
  if (typeof v === 'object' && v !== null) return JSON.stringify(v)
  return String(v)
}

function log(level: LogLevel, message: string, meta?: LogMeta) {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  }

  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v !== undefined) entry[k] = v
    }
  }

  const line = Object.entries(entry)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(' ')

  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  debug: (message: string, meta?: LogMeta) => log('debug', message, meta),
  info: (message: string, meta?: LogMeta) => log('info', message, meta),
  warn: (message: string, meta?: LogMeta) => log('warn', message, meta),
  error: (message: string, meta?: LogMeta) => log('error', message, meta),
}
