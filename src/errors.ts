/**
 * Base error for all client-side failures originating in this SDK.
 */
export class AgenticWalletRouterError extends Error {
  readonly code: string;

  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AgenticWalletRouterError";
    this.code = options?.code ?? "ROUTER_ERROR";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Base class for local circuit-breaker rejections. These are thrown before
 * signing or sending, so no network request is made.
 */
export class CircuitBreakerError extends AgenticWalletRouterError {
  readonly amountUSD: number;
  readonly limitUSD: number;
  readonly spentUSD: number | undefined;

  constructor(
    message: string,
    options: {
      code: string;
      amountUSD: number;
      limitUSD: number;
      spentUSD?: number;
    },
  ) {
    super(message, { code: options.code });
    this.name = "CircuitBreakerError";
    this.amountUSD = options.amountUSD;
    this.limitUSD = options.limitUSD;
    this.spentUSD = options.spentUSD;
  }
}

/**
 * Thrown when `amount` is strictly greater than `maxPerTransactionUSD`.
 */
export class PerTransactionLimitError extends CircuitBreakerError {
  constructor(amountUSD: number, limitUSD: number) {
    super(
      `Per-transaction limit exceeded: amount ${amountUSD} USD is greater than maxPerTransactionUSD ${limitUSD}.`,
      { code: "PER_TRANSACTION_LIMIT", amountUSD, limitUSD },
    );
    this.name = "PerTransactionLimitError";
  }
}

/**
 * Thrown when the rolling 1-hour spend plus `amount` would exceed
 * `maxPerHourUSD`. The payment is not signed or sent.
 */
export class HourlyLimitError extends CircuitBreakerError {
  constructor(amountUSD: number, limitUSD: number, spentUSD: number) {
    super(
      `Hourly limit exceeded: spent ${spentUSD} USD in the last hour plus amount ${amountUSD} USD would exceed maxPerHourUSD ${limitUSD}.`,
      { code: "HOURLY_LIMIT", amountUSD, limitUSD, spentUSD },
    );
    this.name = "HourlyLimitError";
  }
}

/**
 * Thrown when the HTTP transport fails (DNS, TLS, connection reset, missing fetch).
 */
export class TransportError extends AgenticWalletRouterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { code: "TRANSPORT_ERROR", cause: options?.cause });
    this.name = "TransportError";
  }
}

/**
 * Thrown when the gateway returns a non-success HTTP status, invalid body,
 * or an explicit failure payload.
 */
export class GatewayError extends AgenticWalletRouterError {
  readonly statusCode: number | undefined;
  readonly body: unknown;

  constructor(
    message: string,
    options?: { statusCode?: number; body?: unknown; cause?: unknown },
  ) {
    super(message, { code: "GATEWAY_ERROR", cause: options?.cause });
    this.name = "GatewayError";
    this.statusCode = options?.statusCode;
    this.body = options?.body;
  }
}

/**
 * Thrown when constructor arguments are missing or malformed.
 */
export class InvalidKeyError extends AgenticWalletRouterError {
  constructor(message: string) {
    super(message, { code: "INVALID_KEY" });
    this.name = "InvalidKeyError";
  }
}
