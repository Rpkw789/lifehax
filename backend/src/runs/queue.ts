export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("concurrency must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let next = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      const value = values[index];
      if (value === undefined) return;
      results[index] = await worker(value, index);
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
