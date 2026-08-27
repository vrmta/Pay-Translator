# wireswitch

TypeScript client for [WireSwitch](https://wireswitch.io). Signs payment intents on the agent (Ed25519), enforces in-process spend caps, then POSTs a signed envelope to a protocol-translation hop.

WireSwitch is a **general protocol translator**. You name `ingressProtocol` and `egressProtocol` on one `POST`. The hosted hop is `https://wireswitch.io/v1/translate`.

**Test is free.** Sign up at [wireswitch.io/signup](https://wireswitch.io/signup) (Google or email) and issue a `pt_test_` key. Live keys are not public.

The hosted path that works today is a signed envelope → **Stripe test PaymentIntent**. `STRIPE_PI` and `STRIPE_ACP` are that rail (same PaymentIntent). It is not ACP `checkout_sessions`.

The engine also routes x402 cells. Hosted x402 settle needs facilitator credentials that are not on the public hop yet — do not treat those pairs as a promised hosted rail. Unknown pairs return 422.

## Install

```bash
npm i wireswitch
```

The snippet needs two secrets. `WIRESWITCH_API_KEY` is the `pt_test_` key from [signup](https://wireswitch.io/signup). `WALLET_PRIVATE_KEY` is a 32-byte Ed25519 seed the agent uses to sign the envelope. It is not the API key and not a bank account. For test, generate a throwaway hex seed:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste that value into `WALLET_PRIVATE_KEY`.

## Use the hosted hop

Set `gatewayUrl` to `https://wireswitch.io/v1/translate` and `apiKey` to your `pt_test_` key. Without `gatewayUrl` / `ROUTER_GATEWAY_URL`, the client POSTs to `http://127.0.0.1:8080/v1/translate` (local engine only).

```ts
import { WireSwitch } from "wireswitch";

const client = new WireSwitch(process.env.WALLET_PRIVATE_KEY!, {
  circuitBreaker: {
    maxPerTransactionUSD: 50,
    maxPerHourUSD: 500,
  },
  gatewayUrl: "https://wireswitch.io/v1/translate",
  apiKey: process.env.WIRESWITCH_API_KEY!,
});

const result = await client.routePayment({
  ingressProtocol: "GOOGLE_AP2",
  egressProtocol: "STRIPE_PI",
  amount: 19.99,
  recipientMerchantId: "merchant_123",
});
```

`apiKey` is sent as `Authorization: Bearer`. The hop rejects unsigned or unauthenticated translate calls.

## Pairs

| Ingress | Egress | Hosted hop today |
| --- | --- | --- |
| `GOOGLE_AP2` | `STRIPE_PI` (`STRIPE_ACP`) | Stripe **test** PaymentIntent |
| `GOOGLE_AP2` | `COINBASE_X402` | Engine cell; hosted facilitator not public |
| `COINBASE_X402` | `STRIPE_PI` (`STRIPE_ACP`) | Engine cell; needs `x402Payment` |
| `COINBASE_X402` | `COINBASE_X402` | Engine cell; hosted facilitator not public |

## License

MIT. See [`LICENSE`](LICENSE).

Author: Varun M
