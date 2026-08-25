import { parsePrivateKey, signIntent } from "./signing.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { GatewayError, TransportError } from "./errors.js";
import type {
  AgenticWalletRouterOptions,
  CircuitBreakerConfig,
  PaymentIntent,
  RoutePaymentOptions,
  SignedIntentEnvelope,
  TranslationResponse,
} from "./types.js";
import { DEFAULT_GATEWAY_URL, SIGNING_ALG } from "./types.js";

/**
 * Client SDK for routing an agentic wallet payment through a protocol
 * translation gateway.
 *
 * The circuit breaker runs locally and in-memory. Budgets are reserved under
 * a mutex before any signing or HTTP. Intents are signed with Ed25519
 * (`@noble/ed25519`) over canonical JSON.
 */
export class AgenticWalletRouter {
  private readonly seed: Uint8Array;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly gatewayUrl: string;
  private readonly apiKey: string | undefined;

  /**
   * @param encryptedPrivateKey Hex or base64 32-byte Ed25519 seed. If the
   *   material is encrypted at rest, decrypt it before construction. See README.
   * @param options.circuitBreaker Local USD caps (`maxPerTransactionUSD`,
   *   `maxPerHourUSD`).
   * @param options.gatewayUrl Optional override for `ROUTER_GATEWAY_URL`.
   * @param options.apiKey Optional issued developer key sent as Bearer.
   */
  constructor(encryptedPrivateKey: string, options: AgenticWalletRouterOptions) {
    if (options === undefined || options === null || typeof options !== "object") {
      throw new TypeError("Constructor options with a circuitBreaker config are required.");
    }
    assertCircuitBreakerConfig(options.circuitBreaker);
    this.seed = parsePrivateKey(encryptedPrivateKey);
    this.circuitBreaker = new CircuitBreaker(options.circuitBreaker);
    this.gatewayUrl = resolveGatewayUrl(options.gatewayUrl);
    this.apiKey = optionalApiKey(options.apiKey);
  }

  /**
   * Enforce circuit-breaker limits, sign a translation intent, and POST it
   * to the gateway. Rejects without sending when a budget would be exceeded.
   */
  async routePayment(options: RoutePaymentOptions): Promise<TranslationResponse> {
    assertRoutePaymentOptions(options);

    const reservationId = await this.circuitBreaker.reserve(options.amount);

    try {
      const intent = buildIntent(options);
      const { signatureHex, publicKeyHex } = await signIntent(intent, this.seed);
      const envelope: SignedIntentEnvelope = {
        intent,
        signature: signatureHex,
        publicKey: publicKeyHex,
        alg: SIGNING_ALG,
      };

      const response = await postSignedIntent(this.gatewayUrl, envelope, this.apiKey);
      return response;
    } catch (error) {
      await this.circuitBreaker.release(reservationId);
      throw error;
    }
  }
}

function optionalApiKey(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function resolveGatewayUrl(override: string | undefined): string {
  if (typeof override === "string" && override.trim() !== "") {
    return override.trim();
  }
  const fromEnv = typeof process !== "undefined" ? process.env["ROUTER_GATEWAY_URL"] : undefined;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return fromEnv.trim();
  }
  return DEFAULT_GATEWAY_URL;
}

function assertCircuitBreakerConfig(config: CircuitBreakerConfig | undefined): asserts config is CircuitBreakerConfig {
  if (config === undefined || config === null || typeof config !== "object") {
    throw new TypeError("circuitBreaker config is required.");
  }
  assertPositiveFinite(config.maxPerTransactionUSD, "circuitBreaker.maxPerTransactionUSD");
  assertPositiveFinite(config.maxPerHourUSD, "circuitBreaker.maxPerHourUSD");
}

function assertRoutePaymentOptions(options: RoutePaymentOptions): void {
  if (options === undefined || options === null || typeof options !== "object") {
    throw new TypeError("routePayment options are required.");
  }
  assertNonEmptyString(options.ingressProtocol, "ingressProtocol");
  assertNonEmptyString(options.egressProtocol, "egressProtocol");
  assertNonEmptyString(options.recipientMerchantId, "recipientMerchantId");
  assertPositiveFinite(options.amount, "amount");
}

function assertPositiveFinite(value: number, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${field} must be a finite number greater than 0.`);
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
}

function buildIntent(options: RoutePaymentOptions): PaymentIntent {
  return {
    ingressProtocol: options.ingressProtocol,
    egressProtocol: options.egressProtocol,
    amount: options.amount,
    recipientMerchantId: options.recipientMerchantId,
    timestamp: new Date().toISOString(),
    nonce: crypto.randomUUID(),
  };
}

async function postSignedIntent(
  url: string,
  envelope: SignedIntentEnvelope,
  apiKey?: string,
): Promise<TranslationResponse> {
  if (typeof fetch !== "function") {
    throw new TransportError("Global fetch is not available in this runtime.");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "x-signature": envelope.signature,
    "x-public-key": envelope.publicKey,
    "x-signing-alg": envelope.alg,
  };
  if (apiKey !== undefined) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(envelope),
    });
  } catch (cause) {
    throw new TransportError(`Failed to reach translation gateway at ${url}.`, { cause });
  }

  const rawBody = await readBody(response);

  if (!response.ok) {
    throw new GatewayError(messageFromGatewayBody(rawBody, response.status), {
      statusCode: response.status,
      body: rawBody,
    });
  }

  return parseTranslationResponse(rawBody, envelope.intent, response.status);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new GatewayError("Translation gateway returned a non-JSON body.", {
      statusCode: response.status,
      body: text,
      cause,
    });
  }
}

function parseTranslationResponse(
  body: unknown,
  intent: PaymentIntent,
  statusCode: number,
): TranslationResponse {
  if (body === undefined || typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new GatewayError("Translation gateway returned an unexpected payload.", {
      statusCode,
      body,
    });
  }

  const record = body as Record<string, unknown>;

  if (record["success"] === false) {
    const message =
      typeof record["error"] === "string"
        ? record["error"]
        : typeof record["message"] === "string"
          ? record["message"]
          : "Translation gateway reported success=false.";
    throw new GatewayError(message, { statusCode, body });
  }

  const idKeys = [
    "translationId",
    "translation_id",
    "requestId",
    "request_id",
    "id",
    "nexus_routing_id",
    "nexusRoutingId",
  ];
  const translationId = firstString(record, idKeys);
  const requestId = firstString(record, [
    "requestId",
    "request_id",
    "translationId",
    "translation_id",
    "id",
    "nexus_routing_id",
    "nexusRoutingId",
  ]);

  if (translationId === undefined || requestId === undefined) {
    throw new GatewayError("Translation gateway response is missing a translation/request id.", {
      statusCode,
      body,
    });
  }

  const settled = record["settled"] === true;
  const status =
    firstString(record, ["status"]) ??
    (record["success"] === true || settled ? "success" : "ok");

  return {
    success: settled || record["success"] !== false,
    status,
    translationId,
    requestId,
    ingressProtocol: firstString(record, ["ingressProtocol", "ingress_protocol"]) ?? intent.ingressProtocol,
    egressProtocol: firstString(record, ["egressProtocol", "egress_protocol"]) ?? intent.egressProtocol,
    amount: typeof record["amount"] === "number" && Number.isFinite(record["amount"]) ? record["amount"] : intent.amount,
    recipientMerchantId:
      firstString(record, ["recipientMerchantId", "recipient_merchant_id"]) ?? intent.recipientMerchantId,
    timestamp: firstString(record, ["timestamp"]) ?? intent.timestamp,
  };
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function messageFromGatewayBody(body: unknown, statusCode: number): string {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (typeof record["error"] === "string" && record["error"].length > 0) {
      return record["error"];
    }
    if (typeof record["message"] === "string" && record["message"].length > 0) {
      return record["message"];
    }
  }
  return `Translation gateway returned HTTP ${statusCode}.`;
}
