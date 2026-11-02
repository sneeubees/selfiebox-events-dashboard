// Renders the real dashboard with sign-in and Convex faked. Nothing else
// exercises App.js as a whole, and a mistake that only shows at render time
// (a value used before it is declared, say) would stop the dashboard for all.
import React from 'react';
import { act, render, screen } from '@testing-library/react';

const mockState = { boardResult: [] };
const mockBoard = () => mockState.boardResult;

// Stable results, as Convex gives: a new object on every render would make the
// dashboard's effects run for ever.
const mockCache = new Map();
const mockQueryResult = (name) => {
  if (!mockCache.has(name)) {
    let value = [];
    if (name === 'users:current') value = { id: 'u1', _id: 'u1', role: 'admin', isApproved: true, isActive: true, email: 'test@example.com', fullName: 'Test Admin', firstName: 'Test' };
    if (name === 'workspaces:list') value = [2026, 2027].map((year) => ({ id: `w${year}`, year, name: String(year) }));
    if (name === 'events:hasAny') value = true;
    if (name === 'permissions:currentUserRights') value = {};
    mockCache.set(name, value);
  }
  return mockCache.get(name);
};
const mockAsync = async () => null;
const mockMutation = Object.assign(async () => null, { withOptimisticUpdate() { return this; } });
const mockConvex = { query: async () => null };
const mockClerk = { signOut: async () => {}, openUserProfile: () => {} };
const mockUser = { isLoaded: true, isSignedIn: true, user: { id: 'clerk1', primaryEmailAddress: { emailAddress: 'test@example.com' } } };

jest.mock('@clerk/react', () => ({
  SignIn: () => null,
  SignUp: () => null,
  useClerk: () => mockClerk,
  useUser: () => mockUser,
}));

jest.mock('convex/react', () => {
  const { getFunctionName: name } = jest.requireActual('convex/server');
  return {
    Authenticated: ({ children }) => children,
    AuthLoading: () => null,
    Unauthenticated: () => null,
    useAction: () => mockAsync,
    useConvex: () => mockConvex,
    useMutation: () => mockMutation,
    useQuery: (query, args) => (args === 'skip' ? undefined : mockQueryResult(name(query))),
    useQueries: (queries) => Object.fromEntries(Object.keys(queries).map((key) => [key, name(queries[key].query) === 'events:listByWorkspaceYear' ? mockBoard() : mockQueryResult(name(queries[key].query))])),
  };
});

const App = require('./App').default;

const row = (id) => ({ id, name: `Client ${id}`, eventTitle: '', date: '2026-11-05', workspaceYear: 2026, hours: '3', time: '', branch: ['GP'], products: [], status: 'Web Request', paymentStatus: '', accounts: '', vinyl: '', gsAi: '', imagesSent: '', snappic: '', attendants: [], exVat: '', packageOnly: '', notes: '', customFields: {}, updates: [], files: [], activity: [] });

const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); }); };

describe('dashboard renders', () => {
  beforeAll(() => {
    window.scrollTo = () => {};
    Element.prototype.scrollIntoView = () => {};
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} }));
    window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('with a healthy board', async () => {
    mockState.boardResult = [row('e1'), row('e2')];
    render(<App />);
    await settle();
    expect(screen.queryByText('Dashboard failed to load')).toBeNull();
    // Both rows reached the board: months start closed, so count the new-request badge.
    expect(document.body.textContent).toContain('New2');
  });

  test('with the board query failing on first load', async () => {
    mockState.boardResult = new Error('[CONVEX Q(events:listByWorkspaceYear)] Function execution timed out (maximum duration: 1s)');
    render(<App />);
    await settle();
    expect(screen.queryByText('Dashboard failed to load')).toBeNull();
    expect(document.body.textContent).toContain('Events Dashboard 2026');
    expect(document.body.textContent).not.toContain('New2');
  });
});
