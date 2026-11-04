export class SoundCloudError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SoundCloudError";
  }
}

export class AuthError extends SoundCloudError {
  constructor(message: string, status?: number) {
    super(message, status, "auth");
    this.name = "AuthError";
  }
}

export class RateLimitError extends SoundCloudError {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message, 429, "rate_limited");
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends SoundCloudError {
  constructor(message: string) {
    super(message, 404, "not_found");
    this.name = "NotFoundError";
  }
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

/** "fetch failed" hides the real reason (DNS, refused, proxy, TLS) in err.cause. */
export function describeNetworkError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } };
  const base = e?.message ?? String(err);
  const cause = e?.cause?.code ?? e?.cause?.message;
  return cause && !base.includes(cause) ? `${base} (${cause})` : base;
}

/** Never let raw response bodies grow unbounded inside error messages. */
export function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
