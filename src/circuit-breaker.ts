import { centsToUsd, usdToCents } from "./canonical.js";
import { HourlyLimitError, PerTransactionLimitError } from "./errors.js";
import { AsyncMutex } from "./mutex.js";
import type { CircuitBreakerConfig } from "./types.js";
import { HOUR_MS } from "./types.js";

interface LedgerEntry {
  id: string;
  amountCents: number;
  timestampMs: number;
}

/**
 * In-memory rolling 1-hour spend ledger. All check-and-reserve operations run
 * under an async mutex so concurrent `routePayment` calls cannot both pass
 * the hourly cap.
 */
export class CircuitBreaker {
  private readonly entries: LedgerEntry[] = [];
  private readonly mutex = new AsyncMutex();
  private readonly maxPerTransactionCents: number;
  private readonly maxPerHourCents: number;
  private readonly now: () => number;

  constructor(config: CircuitBreakerConfig, clock: () => number = () => Date.now()) {
    this.maxPerTransactionCents = usdToCents(config.maxPerTransactionUSD);
    this.maxPerHourCents = usdToCents(config.maxPerHourUSD);
    this.now = clock;
  }

  /**
   * Enforce per-transaction and hourly limits, then reserve `amountUSD`.
   * Returns a reservation id that can be released if the subsequent send fails.
   */
  async reserve(amountUSD: number): Promise<string> {
    const amountCents = usdToCents(amountUSD);

    return this.mutex.runExclusive(() => {
      if (amountCents > this.maxPerTransactionCents) {
        throw new PerTransactionLimitError(amountUSD, centsToUsd(this.maxPerTransactionCents));
      }

      const now = this.now();
      this.prune(now);
      const spentCents = this.spentCents();
      if (spentCents + amountCents > this.maxPerHourCents) {
        throw new HourlyLimitError(
          amountUSD,
          centsToUsd(this.maxPerHourCents),
          centsToUsd(spentCents),
        );
      }

      const id = crypto.randomUUID();
      this.entries.push({ id, amountCents, timestampMs: now });
      return id;
    });
  }

  /**
   * Drop a reservation (e.g. after a transport/gateway failure) so the amount
   * does not consume hourly budget.
   */
  async release(id: string): Promise<void> {
    await this.mutex.runExclusive(() => {
      const index = this.entries.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        this.entries.splice(index, 1);
      }
    });
  }

  private prune(now: number): void {
    const cutoff = now - HOUR_MS;
    let write = 0;
    for (let read = 0; read < this.entries.length; read++) {
      const entry = this.entries[read];
      if (entry !== undefined && entry.timestampMs > cutoff) {
        this.entries[write] = entry;
        write += 1;
      }
    }
    this.entries.length = write;
  }

  private spentCents(): number {
    let total = 0;
    for (const entry of this.entries) {
      total += entry.amountCents;
    }
    return total;
  }
}
