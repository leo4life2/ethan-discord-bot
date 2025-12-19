import { logger } from '../logger.js';

export interface RetryOptions {
  operation?: string;
  maxRetries?: number; // number of retries after the initial attempt
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: number; // 0.2 => +/-20%
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatus(err: unknown): number | undefined {
  const anyErr = err as any;
  const status = anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function getErrorCode(err: unknown): string | undefined {
  const anyErr = err as any;
  const code = anyErr?.code ?? anyErr?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

function getErrorMessage(err: unknown): string {
  const anyErr = err as any;
  const msg = anyErr?.message ?? anyErr?.error?.message;
  return typeof msg === 'string' ? msg : String(err);
}

export function isRetryableLikelyNetworkHiccup(err: unknown): boolean {
  const status = getErrorStatus(err);
  const code = getErrorCode(err);
  const message = getErrorMessage(err).toLowerCase();

  // OpenAI sometimes returns a 400 for upstream image fetch timeouts.
  if (status === 400 && message.includes('timeout while downloading')) return true;

  // Standard retryable HTTP statuses.
  if (status === 408) return true; // Request Timeout
  if (status === 409) return true; // Conflict (rare, but safe to retry for idempotent-ish calls)
  if (status === 429) return true; // Rate limit
  if (status !== undefined && status >= 500 && status <= 599) return true; // Server errors

  // Network / socket issues (Node fetch / undici / TLS) that surface without HTTP status.
  if (code && ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EAI_AGAIN'].includes(code)) {
    return true;
  }

  // Message-based fallback (last resort).
  if (message.includes('timed out')) return true;
  if (message.includes('timeout')) return true;
  if (message.includes('network')) return true;
  if (message.includes('socket hang up')) return true;
  if (message.includes('fetch failed')) return true;

  return false;
}

function computeDelayMs(
  attemptNumber: number,
  initialDelayMs: number,
  factor: number,
  maxDelayMs: number,
  jitter: number,
): number {
  const base = Math.min(maxDelayMs, Math.round(initialDelayMs * Math.pow(factor, Math.max(0, attemptNumber - 1))));
  if (jitter <= 0) return base;
  const rand = (Math.random() * 2 - 1) * jitter; // [-jitter, +jitter]
  return Math.max(0, Math.round(base * (1 + rand)));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    operation = 'operation',
    maxRetries = 3,
    initialDelayMs = 500,
    maxDelayMs = 8_000,
    factor = 2,
    jitter = 0.2,
  } = opts;

  let attempt = 0;
  // attempt=0 is the initial try, attempt=1..maxRetries are retries
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !isRetryableLikelyNetworkHiccup(err)) {
        throw err;
      }

      attempt += 1;
      const delayMs = computeDelayMs(attempt, initialDelayMs, factor, maxDelayMs, jitter);
      logger.warn('Transient error; retrying OpenAI call', {
        operation,
        attempt,
        maxRetries,
        delayMs,
        status: getErrorStatus(err),
        code: getErrorCode(err),
        message: getErrorMessage(err),
      });
      await sleep(delayMs);
    }
  }
}


