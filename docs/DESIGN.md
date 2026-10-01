# Design note

A calendar where the browser is the source of truth (DummyJSON stores nothing), every change is undoable, and
saves go to an unreliable fake API. This note explains the four decisions that shape the code.

## 1. State and history

**Stores (Zustand).** `calendarStore` holds `events` (a map of stored records), `undoStack`, `redoStack` and sync
status. `authStore`, `usersStore` (attendee cache), `uiStore` (open dialogs, keyboard-move session) and
`toastStore` are separate so opening a dialog can never touch history or persistence. Components select narrow
slices (e.g. one event's "saving" flag), so a change re-renders only what uses it.

**Command pattern.** A `Command` is `{ id, label, changes: EventChange[] }` where each change is a
`{ id, before, after }` snapshot (`null` = does not exist). `do` applies every `after`, `undo` applies every `before`
in reverse. Snapshots make commands:

- **multi-record**: “this and following” truncates one series *and* creates another, but is still one undo step;
- **pure to plan**: `planEdit / planDelete / planCreate` (in `domain/recurrence/edit.ts`) compute changes from the
  current events without touching the store, which is why they are unit-tested in isolation;
- **safe against stale input**: `execute()` rejects a plan whose `before` is not exactly the current object, so a
  form opened before a rollback can never overwrite newer data.

One drag, one keyboard move (M + arrows + Enter), one form save or one delete = one `execute()` = one undo step.
Undo/redo are buttons plus Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y); text inputs keep their native undo.

## 2. Overlap layout and recurrence

**Overlap layout** (`domain/layout/overlap.ts`, hand-written): per day column, sort events by start (longer first on
ties), split them into *clusters* of transitively overlapping events, and greedily place each event in the first
column whose last event has ended (interval-graph colouring, so the column count equals the maximum number of
events happening at the same moment). Each event is `1/columns` wide and then *expands right* over neighbouring columns
that are free for its whole duration, like Google Calendar. Very short events collide on their drawn height (≥20
min) so labels never overlap. `packLanes` does the same greedy placement for horizontal bars (all-day row, month).

**Recurrence** (`domain/recurrence/`): a series is stored once (the *master* with a rule); instances are generated
only for the visible range, never stored. `ruleDates` yields calendar *dates* (`YYYY-MM-DD`) for daily / weekly
(several weekdays, every N weeks) / monthly rules, and jumps straight to the visible range while still reporting the
true occurrence index (needed for “ends after N times”). Each date plus the series' wall-clock time is converted to
UTC in the **event's own time zone**, so a 09:00 stand-up stays at 09:00 across DST (tested for New York's
November switch). Month ends: “monthly on day 31” is computed from the start date every month, so it gives
Jan 31 → Feb 28 → Mar 31 with no drift; “2nd Tuesday” and “last Friday” are supported, and months without a 5th
weekday are skipped. Exceptions follow RFC 5545 / Google: `exdates` hide instances, and a “this event” edit creates
an *override* (`recurringEventId + originalStart`). Occurrence URLs are `/events/<seriesId>~<originalStartMs>`, and
the route checks the rule really produces that start, so made-up ids show “Event not found”.

Time zones use only `Intl.DateTimeFormat`: the offset of a zone at an instant is cached per 15-minute bucket, and
wall-clock → UTC handles DST gaps (02:30 that doesn't exist becomes 03:30) and overlaps (the earlier 01:30).
All-day events are floating dates stored as UTC midnight, so they never shift between zones.

## 3. Persistence and rollback

**Persistence** (`store/persistence.ts`): one localStorage key per user holding
`{ schemaVersion: 1, savedAt, seedAnchor, events[] }`, written 250 ms after each change and on `pagehide`.
Loading is layered:

1. unparseable JSON, a wrong shape or an unknown `schemaVersion` → the raw text is copied to `<key>.corrupt`,
   the user is told, and the calendar is re-seeded (if the format ever changes, the version is bumped and the old
   shape converted at this point instead);
2. every event is validated; recoverable fields are repaired (e.g. unknown colour or zone), broken events are dropped
   individually, and the user sees how many.

Seed events come from `GET /todos` (paged with `skip`, 254 in total); their times are pure arithmetic on the todo
id relative to the Monday the calendar was first seeded, so re-seeding reproduces them exactly.

**Fake sync and rollback** (`store/history.ts`, `calendarStore.ts`). Every transition (do, undo, redo) becomes a
*mutation* carrying full snapshots. Mutations are sent one at a time, in order, to a fake API that fails ~20% of
the time (adjustable in Developer tools) and then calls `POST /todos/add`, `PUT /todos/{id}` or `DELETE /todos/{id}`
(only for seeded todos, since ids created on DummyJSON return 404 later). A `SyncLedger` remembers, per event, the
last *confirmed* snapshot and the newest mutation. On failure:

- if a newer mutation for that event is queued, nothing happens: it carries the full newer state (last write wins),
  which is what makes “drag, edit, drag again while a save is pending” end in the state of the last action;
- otherwise the event goes back to its last confirmed snapshot, and history is repaired **for that event only**:
  a failed *do* is removed, a failed *undo* goes back on the undo stack, a failed *redo* back on the redo stack, and
  any remaining step that no longer lines up with the reverted value is trimmed.

Commands on other events are never touched, so Ctrl+Z after a rollback undoes the right thing. Seven unit tests
cover these orderings (failure after later edits, superseded failures, stale success, failed undo/redo).

## 4. Drag performance

`useDragInteraction` keeps the whole gesture in a ref. `pointermove` only stores coordinates and schedules one
`requestAnimationFrame`; the frame computes snapped times and writes `top/height/left` and the time text straight onto
a single preview element. React renders twice per drag (dim the original, un-dim it) and the store is written once
on `pointerup`. Esc cancels, and the preview stays in place while the “this / following / all” dialog is open.

Around it, memoisation keeps unrelated work out of each render: expansion is cached per event object in a
`WeakMap` (unchanged events keep the same occurrence objects), and event blocks use a memo comparator on what they
draw. In a production build with **754 events (141 on screen)**, dropping an event re-renders only that block, in
about 8–14 ms, and switching weeks takes about 12–20 ms.

## The hard problem: rolling back without breaking later undo steps

The two obvious ways to roll back a failed save are both wrong once the user keeps working. Calling `undo()` reverts
the *latest* command: if A fails after B was made, it reverts B, not A. Restoring a whole-state snapshot from before A
wipes out B as well. The fix was to stop treating rollback as a history operation and track sync per *event*:
every save carries full snapshots, the ledger keeps the last confirmed value per event, and only the newest failed
save for an event is reverted, to that confirmed value. History is then repaired locally for the reverted events.

Reverting to the failed command's own `before` would have been simpler, but it breaks on one ordering: save 1 of an
event fails while save 2 is still queued (so nothing is reverted yet), then save 2 fails too. The right result is
the original value, because the server never received either change, but save 2's `before` is save 1's result.
Because saves are sent serially, an older save always settles before a newer one, so the ledger's “last confirmed”
value is exactly what the server has. The history tests pin this case down.

**Bugs found while testing in the browser** (all fixed):

- Three fast clicks on *Save* created three events: the double-submit guard was released in `finally` right after
  the first save, before the dialog unmounted. The guard now stays set after a successful submit (same for Login
  and Delete).
- `/events/:id` did not open: in React Router 8 a layout route's `useParams()` does not see its child's params. The
  page now reads the id with `useMatch('/events/:eventId')`.
- Every day's seeded todos started in the same hour (ids sharing a day differ by 50, which cancelled out in the hour
  formula), making each day one giant overlap cluster.
- Escape stopped closing a dialog after its focused button became disabled while saving (focus fell to `<body>`); the
  focus trap now listens on `document` with a stack of open dialogs.
- Dropping an event re-rendered every event block: an event handler depended on an object that is new on every render.
