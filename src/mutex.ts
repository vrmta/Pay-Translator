/**
 * FIFO async mutex. Callers queue behind the current exclusive section so
 * concurrent `routePayment` invocations cannot interleave budget checks and
 * reservations.
 */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(() => fn());
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
