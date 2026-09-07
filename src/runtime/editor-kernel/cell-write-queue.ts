/** Writes in one editor run in entry order, including after a failed write. */
export class CellWriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(write: () => Promise<T>): Promise<T> {
    const result = this.tail.then(write);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
