import { changedEventFieldsForSave } from './eventSaveFields';
import { mergeChangedEventFields } from './convex/events';

const row = (overrides = {}) => ({
  id: 'evt-1', name: 'Tshepo Sekhokho', date: '2026-11-28', status: 'In Progress',
  branch: ['GP'], products: [], attendants: [], updates: [], files: [], activity: [],
  customFields: { custom_designs: 'Done' }, ...overrides,
});

test('a rename sends only the name', () => {
  expect(changedEventFieldsForSave(row(), row({ name: 'Tshepo Sekhokho (???)' }))).toEqual(['name']);
});

test('a custom column edit is sent per key', () => {
  const before = row();
  const after = row({ customFields: { custom_designs: 'Done', custom_excl_jc: '9065' } });
  expect(changedEventFieldsForSave(before, after)).toEqual(['customFields.custom_excl_jc']);
});

test('a date change also sends the workspace year', () => {
  expect(changedEventFieldsForSave(row(), row({ date: '2027-01-05' })).sort()).toEqual(['date', 'workspaceYear']);
});

test('26 Nov 2026: a stale rename no longer blanks a colleague\'s Excl JC', () => {
  // Stored row: Johan has just set Excl JC to 9065.
  const stored = { ...row(), eventKey: 'evt-1', customFields: { custom_designs: 'Done', custom_excl_jc: '9065' } };
  // Tamika's screen still has the row without it, and she renames it.
  const hers = row({ name: 'Tshepo Sekhokho (???)' });
  const changed = changedEventFieldsForSave(row(), hers);
  const payload = { ...hers, eventKey: 'evt-1', updatedAt: 1 };
  const write = mergeChangedEventFields(stored, payload, changed);
  expect(write).toEqual({ updatedAt: 1, name: 'Tshepo Sekhokho (???)' });
  expect({ ...stored, ...write }.customFields.custom_excl_jc).toBe('9065');
});

test('clearing a custom column removes only that key', () => {
  const stored = { customFields: { a: '1', b: '2' } };
  const write = mergeChangedEventFields(stored, { updatedAt: 1, customFields: { a: '1' } }, ['customFields.b']);
  expect(write.customFields).toEqual({ a: '1' });
});

test('a custom column edit keeps the other custom columns as stored', () => {
  const stored = { customFields: { custom_excl_jc: '9065', custom_designs: 'Done' } };
  const write = mergeChangedEventFields(stored, { updatedAt: 1, customFields: { custom_designs: 'Awaiting Feedback' } }, ['customFields.custom_designs']);
  expect(write.customFields).toEqual({ custom_excl_jc: '9065', custom_designs: 'Awaiting Feedback' });
});
