import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, useAuth } from '@clerk/react';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
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

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <App />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </React.StrictMode>
);

reportWebVitals();
