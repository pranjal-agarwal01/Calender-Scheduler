import { useAnnouncer } from '../../store/announcerStore';

/** Visually hidden aria-live regions; text is set via `announce()` (moves, undo, saves...). */
export function LiveRegion() {
  const polite = useAnnouncer((s) => s.polite);
  const assertive = useAnnouncer((s) => s.assertive);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </>
  );
}
