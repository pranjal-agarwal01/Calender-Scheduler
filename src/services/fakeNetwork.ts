import { ApiError } from '../api/apiError';

/**
 * The "fake API" for sync: resolves after a realistic delay, and rejects with
 * probability `failureRate` (20% by default) so rollback paths get exercised.
 */
export function unreliableNetwork(failureRate: number): Promise<void> {
  const latency = 350 + Math.random() * 650;
  const fails = Math.random() < failureRate;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (fails) {
        reject(new ApiError({ code: 'SIMULATED', status: 503, message: 'The server rejected the change (simulated failure).' }));
      } else {
        resolve();
      }
    }, latency);
  });
}
