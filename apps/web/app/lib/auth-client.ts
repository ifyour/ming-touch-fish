import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
  fetchOptions: {
    credentials: 'include',
  },
});

export const { signIn, signOut, useSession } = authClient;
