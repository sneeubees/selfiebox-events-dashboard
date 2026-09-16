import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GoogleReviewsView from './GoogleReviewsView';
import { useQuery, useAction, useMutation } from 'convex/react';
jest.mock('convex/react', () => ({ useQuery: jest.fn(), useAction: jest.fn(), useMutation: jest.fn() }));
// CRA's Jest resolver predates Ant Design 6 package exports; test our state
// handling with semantic controls and validate the real library in the build.
jest.mock('antd', () => ({
  Button: ({ children, icon, loading, ...props }) => <button {...props}>{children}</button>,
  Alert: ({ message, description }) => <div role="alert">{message}{description}</div>,
  Select: ({ options, onChange, ...props }) => <select {...props} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>,
  Empty: ({ description }) => <p>{description}</p>, Spin: () => <span>Loading</span>,
}));
jest.mock('./convex/_generated/api', () => ({ api: {
  googleReviews: { status: 'status', disconnect: 'disconnect' },
  googleReviewsActions: { connect: 'connect', profiles: 'profiles', reviews: 'reviews' },
} }));
beforeAll(() => {
  window.matchMedia = jest.fn().mockImplementation(query => ({ matches: false, media: query, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() }));
});
beforeEach(() => { jest.clearAllMocks(); useMutation.mockReturnValue(jest.fn()); useAction.mockReturnValue(jest.fn()); });
test('unconfigured connection is disabled and explains setup status', () => {
  useQuery.mockReturnValue({ configured: false, connected: false });
  render(<GoogleReviewsView isAdmin />);
  expect(screen.getByRole('button', { name: /Connect Google/ })).toBeDisabled();
  expect(screen.getByText(/Google Reviews setup pending/)).toBeInTheDocument();
});
test('non-admin view never requests connection status', () => {
  useQuery.mockReturnValue(undefined);
  render(<GoogleReviewsView isAdmin={false} />);
  expect(useQuery).toHaveBeenCalledWith('status', 'skip');
  expect(screen.getByText(/available to administrators/)).toBeInTheDocument();
});
test('Google account permission errors are visible after loading profiles', async () => {
  useQuery.mockReturnValue({ configured: true, connected: true });
  useAction.mockImplementation(name => name === 'profiles' ? jest.fn().mockResolvedValue({ profiles: [], errors: ['Google denied access. Check API approval.'] }) : jest.fn());
  render(<GoogleReviewsView isAdmin />);
  fireEvent.click(screen.getByRole('button', { name: /Load profiles/ }));
  await waitFor(() => expect(screen.getByText(/Google denied access/)).toBeInTheDocument());
});
test('reviews paginate without duplicates and changing branches clears the previous reviews', async () => {
  useQuery.mockReturnValue({ configured: true, connected: true });
  const first = { reviewId: 'one', reviewer: { displayName: 'CT customer' }, starRating: 'FIVE', comment: '<script>not HTML</script>' };
  const reviews = jest.fn().mockImplementation(({ location, pageToken }) => Promise.resolve({
    reviews: location.endsWith('/2') ? [{ reviewId: 'kzn', reviewer: { displayName: 'KZN customer' }, starRating: 'FOUR' }] :
      pageToken ? [first, { reviewId: 'two', reviewer: { displayName: 'Second CT customer' }, starRating: 'FIVE' }] : [first],
    averageRating: location.endsWith('/2') ? 4 : 5, totalReviewCount: location.endsWith('/2') ? 1 : 2,
    nextPageToken: !pageToken && location.endsWith('/1') ? 'next' : '', fetchedAt: 100000,
  }));
  useAction.mockImplementation(name => name === 'reviews' ? reviews : name === 'profiles' ? jest.fn().mockResolvedValue({
    profiles: [{ resource: 'accounts/1/locations/1', title: 'Cape Town' }, { resource: 'accounts/1/locations/2', title: 'KZN' }], errors: [],
  }) : jest.fn());
  render(<GoogleReviewsView isAdmin />);
  fireEvent.click(screen.getByRole('button', { name: /Load profiles/ }));
  await screen.findByText('Cape Town');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'accounts/1/locations/1' } });
  await screen.findByText('CT customer');
  expect(screen.getByText('<script>not HTML</script>')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Load more reviews/ }));
  await screen.findByText('Second CT customer');
  expect(screen.getAllByText('CT customer')).toHaveLength(1);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'accounts/1/locations/2' } });
  await screen.findByText('KZN customer');
  expect(screen.queryByText('CT customer')).not.toBeInTheDocument();
});
