import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the SelfieBox dashboard heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /selfiebox events dashboard/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/search events/i)).toBeInTheDocument();
});
