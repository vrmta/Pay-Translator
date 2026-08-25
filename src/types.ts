/**
 * Local spend limits enforced by the client before any signing or network I/O.
 *
 * Amounts equal to a limit are allowed; amounts strictly greater are rejected.
 */
export interface CircuitBreakerConfig {
  /** Maximum USD permitted for a single `routePayment` call. */
  maxPerTransactionUSD: number;
  /** Maximum USD permitted across a rolling 1-hour window. */
  maxPerHourUSD: number;
}

/**
 * Constructor options for {@link WireSwitch}. Author: Varun M
 */
export interface WireSwitchOptions {
  circuitBreaker: CircuitBreakerConfig;
  /**
   * Optional gateway URL override. When omitted, the client uses
   * `process.env.ROUTER_GATEWAY_URL`, then falls back to
   * `http://127.0.0.1:8080/v1/translate` (local gateway only).
   * Hosted use sets `gatewayUrl` or `ROUTER_GATEWAY_URL` to `https://wireswitch.io/v1/translate`.
   */
  gatewayUrl?: string;
  /**
   * Optional issued developer API key (`pt_live_` / `pt_test_`).
   * When set, POST /v1/translate sends `Authorization: Bearer ${apiKey}`.
   * When omitted, the header is not sent. Author: Varun M
   */
  apiKey?: string;
}

/**
 * Input to {@link WireSwitch.routePayment}.
 */
export interface RoutePaymentOptions {
  /** Ingress protocol identifier, e.g. `GOOGLE_AP2`. */
  ingressProtocol: string;
  /** Egress protocol identifier, e.g. `STRIPE_ACP`. */
  egressProtocol: string;
  /** Payment amount in USD. */
  amount: number;
  /** Destination merchant identifier in the egress protocol. */
  recipientMerchantId: string;
}

/**
 * Canonical unsigned intent that is serialized and Ed25519-signed.
 */
export interface PaymentIntent {
  ingressProtocol: string;
  egressProtocol: string;
  amount: number;
  recipientMerchantId: string;
  /** ISO-8601 timestamp of intent construction. */
  timestamp: string;
  /** Unique request nonce (UUID). */
  nonce: string;
}

/**
 * Envelope POSTed to the translation gateway.
 */
export interface SignedIntentEnvelope {
  intent: PaymentIntent;
  /** Hex-encoded Ed25519 signature over canonical JSON of `intent`. */
  signature: string;
  /** Hex-encoded 32-byte Ed25519 public key. */
  publicKey: string;
  /** Signing algorithm identifier. Always `ed25519`. */
  alg: "ed25519";
}

/**
 * Successful (or accepted) response from the translation gateway.
 *
 * Gateways may return either `translationId` or `requestId`; the client
 * populates both, using whichever identifier the gateway supplied.
 */
export interface TranslationResponse {
  success: boolean;
  status: string;
  translationId: string;
  requestId: string;
  ingressProtocol: string;
  egressProtocol: string;
  amount: number;
  recipientMerchantId: string;
  timestamp: string;
}

export const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8080/v1/translate";
export const SIGNING_ALG = "ed25519" as const;
export const HOUR_MS = 60 * 60 * 1000;
