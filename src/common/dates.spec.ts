import { addDays } from './dates';

describe('addDays', () => {
  it('rolls over month and year boundaries in both directions', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-05', 365)).toBe('2027-10-05');
  });
});
