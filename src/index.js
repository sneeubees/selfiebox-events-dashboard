import React, { useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, useAuth } from '@clerk/react';
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const clerkPublishableKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

function resolveConvexUrl() {
  const configuredUrl = process.env.REACT_APP_CONVEX_URL;
  if (typeof window !== 'undefined' && window.location.hostname === 'events.selfiebox.co.za') {
    return 'https://api.events.selfiebox.co.za/convex';
  }
  return configuredUrl;
}

const convexUrl = resolveConvexUrl();

if (!clerkPublishableKey) {
  throw new Error('Missing REACT_APP_CLERK_PUBLISHABLE_KEY');
}

if (!convexUrl) {
  throw new Error('Missing REACT_APP_CONVEX_URL');
}

const convex = new ConvexReactClient(convexUrl);

function ConvexProviderWithClerkTemplate({ children }) {
  const useAuthFromClerk = useMemo(
    () =>
      function useAuthFromClerk() {
        const { isLoaded, isSignedIn, getToken, orgId, orgRole } = useAuth();

        const fetchAccessToken = useCallback(
          async ({ forceRefreshToken }) => {
            try {
              return await getToken({
                template: 'convex',
                skipCache: forceRefreshToken,
              });
            } catch {
              return null;
            }
          },
          // Recreate the fetcher when Clerk's org context changes.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          [getToken, orgId, orgRole]
        );

        return useMemo(
          () => ({
            isLoading: !isLoaded,
            isAuthenticated: isSignedIn ?? false,
            fetchAccessToken,
          }),
          [isLoaded, isSignedIn, fetchAccessToken]
        );
      },
    []
  );

  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuthFromClerk}>
      {children}
    </ConvexProviderWithAuth>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      <ConvexProviderWithClerkTemplate>
        <App />
      </ConvexProviderWithClerkTemplate>
    </ClerkProvider>
  </React.StrictMode>
);

reportWebVitals();
