# wireswitch

TypeScript client for [WireSwitch](https://wireswitch.io). Signs payment intents on the agent (Ed25519), enforces in-process spend caps, then POSTs a signed envelope to the gateway.

The hosted hop accepts a Google AP2-shaped envelope and settles a Stripe **test** PaymentIntent. It is not ACP `checkout_sessions`, not x402, and not a generic protocol translator.

## Install

```bash
npm i wireswitch
```

## Use the hosted gateway

You need an issued API key (`pt_test_` / `pt_live_`). Do not omit `gatewayUrl` in production.

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
  egressProtocol: "STRIPE_ACP",
  amount: 19.99,
  recipientMerchantId: "merchant_123",
});
```

Without `gatewayUrl` / `ROUTER_GATEWAY_URL`, the client POSTs to `http://127.0.0.1:8080/v1/translate` (local gateway only).

`apiKey` is sent as `Authorization: Bearer`. The hosted gateway rejects unsigned or unauthenticated translate calls.

## License

MIT. See [`LICENSE`](LICENSE).

Author: Varun M
