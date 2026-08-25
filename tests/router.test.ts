import * as ed25519 from "@noble/ed25519";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../src/canonical.js";
import { bytesToHex } from "../src/bytes.js";
import {
  WireSwitch,
  DEFAULT_GATEWAY_URL,
  GatewayError,
  HourlyLimitError,
  InvalidKeyError,
  PerTransactionLimitError,
  TransportError,
  type TranslationResponse,
} from "../src/index.js";

function randomSeedHex(): string {
  return bytesToHex(ed25519.utils.randomPrivateKey());
}

const SAMPLE_ROUTE = {
  ingressProtocol: "GOOGLE_AP2",
  egressProtocol: "STRIPE_ACP",
  amount: 25,
  recipientMerchantId: "merchant_abc",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function gatewayOk(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    success: true,
    status: "translated",
    translationId: "tr_123",
    requestId: "req_123",
    ingressProtocol: SAMPLE_ROUTE.ingressProtocol,
    egressProtocol: SAMPLE_ROUTE.egressProtocol,
    amount: SAMPLE_ROUTE.amount,
    recipientMerchantId: SAMPLE_ROUTE.recipientMerchantId,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("WireSwitch", () => {
  const fetchMock = vi.fn();
  const originalGateway = process.env["ROUTER_GATEWAY_URL"];

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env["ROUTER_GATEWAY_URL"];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalGateway === undefined) {
      delete process.env["ROUTER_GATEWAY_URL"];
    } else {
      process.env["ROUTER_GATEWAY_URL"] = originalGateway;
    }
  });

  describe("constructor / init", () => {
    it("accepts a hex Ed25519 seed and circuitBreaker config", () => {
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 500 },
      });
      expect(router).toBeInstanceOf(WireSwitch);
    });

    it("accepts a 0x-prefixed hex seed and a base64 seed", () => {
      const seed = ed25519.utils.randomPrivateKey();
      const hex = bytesToHex(seed);
      const base64 = Buffer.from(seed).toString("base64");

      expect(
        () =>
          new WireSwitch(`0x${hex}`, {
            circuitBreaker: { maxPerTransactionUSD: 10, maxPerHourUSD: 10 },
          }),
      ).not.toThrow();

      expect(
        () =>
          new WireSwitch(base64, {
            circuitBreaker: { maxPerTransactionUSD: 10, maxPerHourUSD: 10 },
          }),
      ).not.toThrow();
    });

    it("rejects missing or malformed key material", () => {
      const options = { circuitBreaker: { maxPerTransactionUSD: 10, maxPerHourUSD: 10 } };
      expect(() => new WireSwitch("", options)).toThrow(InvalidKeyError);
      expect(() => new WireSwitch("not-a-key", options)).toThrow(InvalidKeyError);
    });

    it("rejects missing or non-positive circuitBreaker limits", () => {
      const key = randomSeedHex();
      expect(() => new WireSwitch(key, undefined as never)).toThrow(TypeError);
      expect(
        () =>
          new WireSwitch(key, {
            circuitBreaker: { maxPerTransactionUSD: 0, maxPerHourUSD: 10 },
          }),
      ).toThrow(TypeError);
      expect(
        () =>
          new WireSwitch(key, {
            circuitBreaker: { maxPerTransactionUSD: 10, maxPerHourUSD: -1 },
          }),
      ).toThrow(TypeError);
    });
  });

  describe("circuit breaker", () => {
    it("rejects amounts strictly greater than maxPerTransactionUSD without sending", async () => {
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 50, maxPerHourUSD: 500 },
      });

      await expect(
        router.routePayment({ ...SAMPLE_ROUTE, amount: 50.01 }),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(PerTransactionLimitError);
        expect(error).toMatchObject({ amountUSD: 50.01, limitUSD: 50, code: "PER_TRANSACTION_LIMIT" });
        return true;
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("allows an amount equal to maxPerTransactionUSD", async () => {
      fetchMock.mockResolvedValue(gatewayOk({ amount: 50 }));
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 50, maxPerHourUSD: 500 },
        gatewayUrl: "https://gateway.test/v1/translate",
      });

      await expect(router.routePayment({ ...SAMPLE_ROUTE, amount: 50 })).resolves.toMatchObject({
        success: true,
        amount: 50,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects when the rolling hourly budget would be exceeded, without sending", async () => {
      fetchMock.mockResolvedValue(gatewayOk({ amount: 80 }));
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 100 },
      });

      await router.routePayment({ ...SAMPLE_ROUTE, amount: 80 });
      fetchMock.mockClear();

      await expect(router.routePayment({ ...SAMPLE_ROUTE, amount: 21 })).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(HourlyLimitError);
          expect(error).toMatchObject({ amountUSD: 21, limitUSD: 100, spentUSD: 80, code: "HOURLY_LIMIT" });
          return true;
        },
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("routePayment", () => {
    it("POSTs a signed intent and returns TranslationResponse", async () => {
      fetchMock.mockResolvedValue(gatewayOk());
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 500 },
        gatewayUrl: "https://gateway.test/v1/translate",
      });

      const result: TranslationResponse = await router.routePayment(SAMPLE_ROUTE);

      expect(result).toEqual({
        success: true,
        status: "translated",
        translationId: "tr_123",
        requestId: "req_123",
        ingressProtocol: "GOOGLE_AP2",
        egressProtocol: "STRIPE_ACP",
        amount: 25,
        recipientMerchantId: "merchant_abc",
        timestamp: "2026-01-01T00:00:00.000Z",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://gateway.test/v1/translate");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        "content-type": "application/json",
        "x-signing-alg": "ed25519",
      });
    });

    it("uses ROUTER_GATEWAY_URL when no gatewayUrl option is provided", async () => {
      process.env["ROUTER_GATEWAY_URL"] = "https://env-gateway.test/v1/translate";
      fetchMock.mockResolvedValue(gatewayOk());
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 500 },
      });

      await router.routePayment(SAMPLE_ROUTE);
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://env-gateway.test/v1/translate");
    });

    it("falls back to the default localhost gateway URL", async () => {
      fetchMock.mockResolvedValue(gatewayOk());
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 500 },
      });

      await router.routePayment(SAMPLE_ROUTE);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(DEFAULT_GATEWAY_URL);
    });

    it("sends Authorization Bearer when apiKey is provided", async () => {
      fetchMock.mockResolvedValue(gatewayOk());
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 500 },
        apiKey: "pt_test_unit",
      });

      await router.routePayment(SAMPLE_ROUTE);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer pt_test_unit");
    });

    it("includes a verifiable Ed25519 signature over canonical intent JSON", async () => {
      const seed = ed25519.utils.randomPrivateKey();
      fetchMock.mockResolvedValue(gatewayOk());
      const router = new WireSwitch(bytesToHex(seed), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 500 },
      });

      await router.routePayment(SAMPLE_ROUTE);

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      const envelope = JSON.parse(String(init.body)) as {
        intent: Record<string, unknown>;
        signature: string;
        publicKey: string;
        alg: string;
      };

      expect(envelope.alg).toBe("ed25519");
      expect(headers["x-signature"]).toBe(envelope.signature);
      expect(headers["x-public-key"]).toBe(envelope.publicKey);
      expect(envelope.signature).toMatch(/^[0-9a-f]{128}$/);
      expect(envelope.intent).toMatchObject({
        ingressProtocol: SAMPLE_ROUTE.ingressProtocol,
        egressProtocol: SAMPLE_ROUTE.egressProtocol,
        amount: SAMPLE_ROUTE.amount,
        recipientMerchantId: SAMPLE_ROUTE.recipientMerchantId,
      });
      expect(typeof envelope.intent["timestamp"]).toBe("string");
      expect(typeof envelope.intent["nonce"]).toBe("string");

      const message = new TextEncoder().encode(canonicalJson(envelope.intent));
      const expectedPub = await ed25519.getPublicKeyAsync(seed);
      expect(envelope.publicKey).toBe(bytesToHex(expectedPub));

      const ok = await ed25519.verifyAsync(
        hexToBytesForTest(envelope.signature),
        message,
        expectedPub,
      );
      expect(ok).toBe(true);
    });

    it("wraps network failures as TransportError and does not consume hourly budget", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 40 },
      });

      await expect(router.routePayment({ ...SAMPLE_ROUTE, amount: 30 })).rejects.toBeInstanceOf(
        TransportError,
      );

      fetchMock.mockResolvedValue(gatewayOk({ amount: 30 }));
      await expect(router.routePayment({ ...SAMPLE_ROUTE, amount: 30 })).resolves.toMatchObject({
        success: true,
      });
    });

    it("wraps HTTP failures as GatewayError", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "nope" }, 502));
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 500 },
      });

      await expect(router.routePayment(SAMPLE_ROUTE)).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(GatewayError);
        expect(error).toMatchObject({ statusCode: 502, code: "GATEWAY_ERROR" });
        return true;
      });
    });

    it("parses a Core 200 translate payload into TranslationResponse", async () => {
      const core200 = {
        nexus_routing_id: "nexus_abc123",
        settled: true,
        timestamp: "2026-08-24T18:00:00.000Z",
        network_latency_ms: 12,
      };
      fetchMock.mockResolvedValue(jsonResponse(core200));
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 500 },
      });

      const result: TranslationResponse = await router.routePayment(SAMPLE_ROUTE);

      expect(result).toEqual({
        success: true,
        status: "success",
        translationId: "nexus_abc123",
        requestId: "nexus_abc123",
        ingressProtocol: SAMPLE_ROUTE.ingressProtocol,
        egressProtocol: SAMPLE_ROUTE.egressProtocol,
        amount: SAMPLE_ROUTE.amount,
        recipientMerchantId: SAMPLE_ROUTE.recipientMerchantId,
        timestamp: "2026-08-24T18:00:00.000Z",
      });
    });

    it("throws GatewayError with the Core circuit-breaker message on HTTP 429", async () => {
      const message = "Pay-Translator Circuit Breaker Tripped: Velocity Limit Exceeded";
      fetchMock.mockResolvedValue(jsonResponse({ status: "error", message }, 429));
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 500 },
      });

      await expect(router.routePayment(SAMPLE_ROUTE)).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(GatewayError);
        expect(error).toMatchObject({
          statusCode: 429,
          code: "GATEWAY_ERROR",
          message,
          body: { status: "error", message },
        });
        return true;
      });
    });

    it("throws GatewayError for a missing-signature 400 with code invalid_signature", async () => {
      const body = { error: "Missing signature", code: "invalid_signature" };
      fetchMock.mockResolvedValue(jsonResponse(body, 400));
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 500 },
      });

      await expect(router.routePayment(SAMPLE_ROUTE)).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(GatewayError);
        expect(error).toMatchObject({
          statusCode: 400,
          code: "GATEWAY_ERROR",
          message: "Missing signature",
          body: { error: "Missing signature", code: "invalid_signature" },
        });
        return true;
      });
    });
  });

  describe("concurrent hourly-cap safety", () => {
    it("does not let two overlapping calls both pass the hourly cap", async () => {
      fetchMock.mockImplementation(
        async () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => resolve(gatewayOk({ amount: 80 })), 40);
          }),
      );

      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 100, maxPerHourUSD: 100 },
      });

      const payload = { ...SAMPLE_ROUTE, amount: 80 };
      const results = await Promise.allSettled([
        router.routePayment(payload),
        router.routePayment(payload),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.status === "rejected" && rejected[0].reason).toBeInstanceOf(HourlyLimitError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("serializes a burst of reservations so the hourly sum never exceeds the cap", async () => {
      fetchMock.mockImplementation(async () => gatewayOk({ amount: 40 }));
      const router = new WireSwitch(randomSeedHex(), {
        circuitBreaker: { maxPerTransactionUSD: 40, maxPerHourUSD: 100 },
      });

      const payload = { ...SAMPLE_ROUTE, amount: 40 };
      const results = await Promise.allSettled([
        router.routePayment(payload),
        router.routePayment(payload),
        router.routePayment(payload),
        router.routePayment(payload),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(2);
      for (const result of rejected) {
        expect(result.status === "rejected" && result.reason).toBeInstanceOf(HourlyLimitError);
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

function hexToBytesForTest(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
