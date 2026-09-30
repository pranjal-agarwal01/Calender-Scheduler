import { describe, expect, it } from 'vitest';
import { layoutDay, packLanes } from './overlap';

describe('layoutDay', () => {
  it('gives non-overlapping events the full width', () => {
    const boxes = layoutDay([
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 600, end: 660 },
    ]);
    expect(boxes.get('a')).toMatchObject({ left: 0, width: 1 });
    expect(boxes.get('b')).toMatchObject({ left: 0, width: 1 });
  });

  it('puts overlapping events side by side', () => {
    const boxes = layoutDay([
      { id: 'a', start: 540, end: 660 },
      { id: 'b', start: 570, end: 630 },
      { id: 'c', start: 600, end: 690 },
    ]);
    expect(boxes.get('a')).toMatchObject({ column: 0, columns: 3 });
    expect(boxes.get('b')).toMatchObject({ column: 1, columns: 3 });
    expect(boxes.get('c')).toMatchObject({ column: 2, columns: 3 });
  });

  it('reuses freed columns and expands into free space to the right', () => {
    // a: 9-12 (long), b: 9-10, c: 10:30-11 (b's column is free again), d: 13-14 separate cluster
    const boxes = layoutDay([
      { id: 'a', start: 540, end: 720 },
      { id: 'b', start: 540, end: 600 },
      { id: 'c', start: 630, end: 660 },
      { id: 'd', start: 780, end: 840 },
    ]);
    expect(boxes.get('a')).toMatchObject({ left: 0, width: 0.5 });
    expect(boxes.get('b')).toMatchObject({ left: 0.5, width: 0.5 });
    expect(boxes.get('c')).toMatchObject({ left: 0.5, width: 0.5, column: 1 });
    expect(boxes.get('d')).toMatchObject({ left: 0, width: 1 });
  });

  it('lets an event span columns that are free during its time', () => {
    // a and b overlap (2 columns); c overlaps a only at the end and later sits alone in column... expansion check
    const boxes = layoutDay([
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 540, end: 570 },
      { id: 'c', start: 540, end: 555 },
      { id: 'd', start: 580, end: 640 },
    ]);
    // d starts after b and c ended, so it takes column 1 and can expand over column 2.
    expect(boxes.get('d')).toMatchObject({ column: 1, columns: 3, width: 2 / 3 });
  });
});

describe('packLanes', () => {
  it('stacks overlapping spans into separate lanes', () => {
    const lanes = packLanes([
      { id: 'week', startCol: 0, endCol: 6 },
      { id: 'mon', startCol: 0, endCol: 0 },
      { id: 'tue-wed', startCol: 1, endCol: 2 },
      { id: 'thu', startCol: 3, endCol: 3 },
    ]);
    expect(lanes.get('week')).toBe(0);
    expect(lanes.get('mon')).toBe(1);
    expect(lanes.get('tue-wed')).toBe(1);
    expect(lanes.get('thu')).toBe(1);
  });
});
