# [PRODUCT_NAME]

[![npm](https://img.shields.io/npm/v/@[BRAND_LOWER]/sdk.svg)](https://www.npmjs.com/package/@[BRAND_LOWER]/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![latency](https://img.shields.io/badge/latency-under%2020ms-brightgreen)](#)

**Sign locally. Translate remotely. Never leak the key.**

[PRODUCT_NAME] is the open-source client SDK for agentic payment translation. Your agent speaks one protocol. The merchant speaks another. The SDK signs the intent on *your* machine with *your* key, then hands a sealed payload to a closed-source routing ledger that actually moves the money.

No hosted wallet. No "trust us with the seed." If you cannot grok the client, do not ship it.

Repo: [github.com/vrmta/Pay-Translator](https://github.com/vrmta/Pay-Translator)

---

## 🔥 The Problem

Agentic commerce is already here — HTTP 402 (`x402`), Google AP2, Stripe ACP, Visa Intelligent Commerce — and none of them speak the same language.

You do not want to:

- bake a Stripe secret into a long-running agent
- reimplement every protocol adapter yourself
- discover at 3am that a retry loop just drained the treasury

You want a **local cryptographic firewall** in front of a **remote translation engine**.

That split is the whole product:

| Layer | What it is | Where it runs |
| --- | --- | --- |
| **This SDK** | Open source. Circuit breaker, Ed25519 intent signing, protocol enums. | Your process. Keys never leave. |
| **Routing ledger** | Closed source. Protocol translation + settlement. | Remote engine the SDK POSTs a *signed* intent to. |

The ledger never sees your private key. The SDK never pretends to be the bank. If the remote engine is down or lying, you still have a signature, a nonce, and a local spend cap.

---

## ⚡ Quick Start

```bash
npm install @[BRAND_LOWER]/sdk
```

```ts
import { AgenticWalletRouter, Protocols } from '@[BRAND_LOWER]/sdk';

const router = new AgenticWalletRouter({
  privateKey: process.env.WALLET_PRIVATE_KEY!,
  circuitBreaker: {
    maxPerTransactionUSD: 50,
    maxPerHourUSD: 500,
  },
});

const transaction = await router.routePayment({
  ingressProtocol: Protocols.GOOGLE_AP2,
  egressProtocol: Protocols.STRIPE_ACP,
  amount: 19.99,
  currency: 'USD',
  recipientMerchantId: 'merchant_123',
});

console.log(transaction.settled, transaction.latencyMs);
```

Point the client at your gateway with `ROUTER_GATEWAY_URL` (defaults to `https://localhost:8080/v1/translate` for local work).

What just happened:

1. The circuit breaker reserved `$19.99` against the hourly ledger **before** any bytes left the box.
2. The SDK canonicalized the intent (protocols, amount, merchant, timestamp, nonce) and **Ed25519-signed** it with the local key.
3. A signed envelope hit the routing ledger. Settlement came back as `transaction.settled` plus `transaction.latencyMs`.

If either cap would trip, `routePayment` throws and **does not sign or send**. Concurrent calls are serialized so two agents cannot both slip through the hourly budget.

---

## 🔐 Security

Trust is not a landing-page adjective. It is a threat model you can read.

### Keys stay local

`privateKey` is consumed in-process to sign intents. It is never put on the wire, never logged, and never sent to the routing ledger. If a copy of the SDK cannot convince you of that in a few hundred lines, do not use it — that is why this client is MIT and public.

### Sign-then-send

Every `routePayment` builds a metadata intent and signs the canonical JSON (Ed25519 via `@noble/ed25519`). The remote engine verifies the signature; it cannot mint an intent you did not authorize. Replay is bounded by nonce + timestamp.

### Circuit breaker is a client-side fuse

The in-memory rolling 1-hour ledger is your runaway-bot kill switch:

- `maxPerTransactionUSD` — a single call cannot exceed this.
- `maxPerHourUSD` — spend in the last hour plus this amount cannot exceed this.
- Reservation happens **before** signing. Transport failures release the reservation so a dead gateway does not burn budget.

This is process-local, not a bank. Restart the process and the fuse resets. Pair it with whatever durable policy you already run.

### What the closed-source routing ledger is (and is not)

The remote engine is the **protocol translator and settlement path**. You send a signed intent; it translates ingress → egress and returns settlement metadata.

It is **not** your custodian. It does not hold the signing key. Treat it like any other payment processor: least privilege, egress allow-list, and verify `transaction.settled` before you tell the agent it paid.

### What we do *not* claim

We do not invent download counts, star counts, or audit-firm logos. This README does not claim a third-party security audit has been completed. Read the source, run the tests, decide.

---

## 🗺️ Roadmap

| Phase | Status | What ships |
| --- | --- | --- |
| **Phase 1** | Current | `x402` ingress → Stripe ACP egress. The boring, useful path: agent hits 402, merchant gets paid on Stripe. |
| **Phase 2** | Next | Google AP2 + Visa ICC. Same signed-intent model, more rails. |
| **Phase 3** | Planned | AI-aware velocity anomaly protection — catch "this agent is behaving unlike itself" on top of the hard USD caps. |

Circuit breaker + local signing are already the Phase-1 contract. Later phases add rails and smarter velocity, not a new trust model.

---

## 📄 License

MIT. See [`LICENSE`](https://github.com/vrmta/Pay-Translator/blob/main/LICENSE).

Fork it. Audit it. Install `@[BRAND_LOWER]/sdk` and keep the key on your side of the wire.
