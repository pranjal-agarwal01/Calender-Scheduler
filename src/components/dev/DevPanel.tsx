import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useDevSettings } from '../../store/devSettingsStore';
import { useCalendarStore } from '../../store/calendarStore';
import { toast } from '../../store/toastStore';
import { tokenStorage } from '../../auth/tokenStorage';
import { authService } from '../../services/authService';
import { getRefreshCount } from '../../api/http';
import { storageKey } from '../../store/persistence';
import { toApiError } from '../../api/apiError';

/**
 * Tools to demo the "hard" requirements on the live site: sync failure rate,
 * slow network (?delay=3000), single-flight token refresh, 500-event
 * performance, and corrupted-storage recovery.
 */
export function DevPanel({ onClose, timeZone, anchor }: { onClose: () => void; timeZone: string; anchor: string }) {
  const { failureRate, slowNetwork, setFailureRate, setSlowNetwork } = useDevSettings();
  const eventCount = useCalendarStore((s) => Object.keys(s.events).length);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (name: string, task: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(name);
    try {
      await task();
    } finally {
      setBusy(null);
    }
  };

  const refreshStorm = () =>
    run('storm', async () => {
      const session = tokenStorage.get();
      if (!session) return;
      // Invalidate the access token, then fire 5 requests at once: all get 401.
      tokenStorage.updateTokens('expired-token-for-demo', session.refreshToken);
      const before = getRefreshCount();
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => authService.me()));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const refreshes = getRefreshCount() - before;
      const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      toast({
        kind: refreshes === 1 && ok === 5 ? 'success' : 'warning',
        title: `5 requests got 401 → ${refreshes} refresh call${refreshes === 1 ? '' : 's'}`,
        message: failure ? `${ok}/5 succeeded. ${toApiError(failure.reason).message}` : `${ok}/5 requests succeeded after retrying with the new token.`,
      });
    });

  const corruptStorage = () =>
    run('corrupt', async () => {
      const { userId } = useCalendarStore.getState();
      if (userId === null) return;
      localStorage.setItem(storageKey(userId), '{"schemaVersion":2,"events":[{"id":"broken"'); // truncated JSON
      await useCalendarStore.getState().load(userId, timeZone, { force: true });
    });

  return (
    <Modal title="Developer tools" onClose={onClose} size="md">
      <div className="space-y-5 text-sm">
        <section className="space-y-2">
          <h3 className="font-semibold text-slate-800">Fake sync API</h3>
          <label className="flex items-center justify-between gap-3">
            <span>Failure rate</span>
            <select
              value={failureRate}
              onChange={(e) => setFailureRate(Number(e.target.value))}
              className="h-9 rounded-lg border border-slate-300 px-2"
            >
              {[0, 0.2, 0.5, 1].map((rate) => (
                <option key={rate} value={rate}>
                  {rate * 100}%{rate === 0.2 ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>
              Slow network <span className="text-slate-500">(adds ?delay=3000 to DummyJSON calls)</span>
            </span>
            <input type="checkbox" checked={slowNetwork} onChange={(e) => setSlowNetwork(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          </label>
          <p className="text-xs text-slate-500">
            Try 50–100% and make a few changes: each failed save is rolled back on its own, and later undo steps still work.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-slate-800">Auth</h3>
          <Button onClick={refreshStorm} loading={busy === 'storm'} icon="zap">
            Expire token + fire 5 requests
          </Button>
          <p className="text-xs text-slate-500">Proves concurrent 401s share one POST /auth/refresh. Total refreshes this session: {getRefreshCount()}.</p>
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-slate-800">Performance ({eventCount} stored events)</h3>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                run('stress', () => {
                  useCalendarStore.getState().addStressEvents(500, anchor, timeZone);
                  toast({ kind: 'success', title: 'Added 500 local events around this month' });
                })
              }
              loading={busy === 'stress'}
            >
              Add 500 events
            </Button>
            <Button
              onClick={() =>
                run('unstress', () => {
                  const removed = useCalendarStore.getState().removeStressEvents();
                  toast({ kind: 'info', title: `Removed ${removed} generated events` });
                })
              }
            >
              Remove generated
            </Button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-slate-800">Local data</h3>
          <div className="flex flex-wrap gap-2">
            <Button onClick={corruptStorage} loading={busy === 'corrupt'}>
              Corrupt storage + reload
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                run('reset', async () => {
                  await useCalendarStore.getState().resetData(timeZone);
                  toast({ kind: 'info', title: 'Calendar reset to the DummyJSON seed' });
                })
              }
              loading={busy === 'reset'}
            >
              Reset to seed data
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
