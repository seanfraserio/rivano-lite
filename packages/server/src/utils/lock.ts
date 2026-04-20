/**
 * Simple mutex for serializing async operations (e.g., file writes).
 * Prevents data races when concurrent requests modify the same resource.
 */
let writeLock = Promise.resolve();

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve: () => void;
  writeLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(() => fn()).finally(() => resolve?.());
}
