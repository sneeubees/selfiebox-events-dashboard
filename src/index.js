import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, useAuth } from '@clerk/react';
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const clerkPublishableKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;
const convexUrl = process.env.REACT_APP_CONVEX_URL;

if (!clerkPublishableKey) {
  throw new Error('Missing REACT_APP_CLERK_PUBLISHABLE_KEY');
}

if (!convexUrl) {
  throw new Error('Missing REACT_APP_CONVEX_URL');
}

const convex = new ConvexReactClient(convexUrl);

function useConvexClerkAuth() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  return {
    isLoading: !isLoaded,
    isAuthenticated: !!isSignedIn,
    fetchAccessToken: async ({ forceRefreshToken } = {}) =>
      (await getToken({ template: 'convex', skipCache: !!forceRefreshToken })) ?? null,
  };
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      <ConvexProviderWithAuth client={convex} useAuth={useConvexClerkAuth}>
        <App />
      </ConvexProviderWithAuth>
    </ClerkProvider>
  </React.StrictMode>
);

reportWebVitals();
