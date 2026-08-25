# wireswitch

TypeScript client SDK. Signs payment intents locally (Ed25519), enforces in-process circuit-breaker limits, then POSTs a signed envelope to a translation gateway.

- Homepage: [wireswitch.io](https://wireswitch.io)
- Repo: [github.com/vrmta/wireswitch](https://github.com/vrmta/wireswitch)

## Install

```bash
npm i wireswitch
```

```ts
import { WireSwitch } from "wireswitch";

const client = new WireSwitch(process.env.WALLET_PRIVATE_KEY!, {
  circuitBreaker: {
    maxPerTransactionUSD: 50,
    maxPerHourUSD: 500,
  },
});

const result = await client.routePayment({
  ingressProtocol: "GOOGLE_AP2",
  egressProtocol: "STRIPE_ACP",
  amount: 19.99,
  recipientMerchantId: "merchant_123",
});
```

`gatewayUrl` defaults to `http://127.0.0.1:8080/v1/translate`. Override with the `gatewayUrl` option or `ROUTER_GATEWAY_URL`. Optional `apiKey` is sent as `Authorization: Bearer`.

## License

MIT. See [`LICENSE`](https://github.com/vrmta/wireswitch/blob/main/LICENSE).

Author: Varun M
