'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore, type TokenResponse } from './api';

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string | null;
  status: string;
  locale: string;
  timezone: string | null;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
  mfaSetupRequired: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  features: string[];
}

export type LoginResponse = { mfaRequired: true; mfaToken: string } | ({ mfaRequired: false; user: CurrentUser; mfaSetupRequired: boolean } & TokenResponse);

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  joinCode?: string;
}

export interface RegisterResponse {
  message: string;
  verificationRequired: boolean;
  devToken?: string;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  can: (feature: string) => boolean;
  login: (input: { email: string; password: string; rememberMe?: boolean }) => Promise<LoginResponse>;
  completeMfa: (input: { mfaToken: string; code: string; rememberMe?: boolean }) => Promise<void>;
  register: (input: RegisterInput) => Promise<RegisterResponse>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

/** Per-browser note that a session exists; wrapped because storage can be blocked or throw. */
const sessionMarker = {
  get(): boolean {
    try {
      return localStorage.getItem('ss_session') === '1';
    } catch {
      return false;
    }
  },
  set(): void {
    try {
      localStorage.setItem('ss_session', '1');
    } catch {
      /* ignore */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem('ss_session');
    } catch {
      /* ignore */
    }
  },
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Loads the profile; with no access token in memory the client silently refreshes from the cookie first.
   * The refresh cookie is HttpOnly, so a local marker records that a session was started on this browser;
   * without it (first visit, after sign-out) no request is made at all.
   */
  const reload = useCallback(async () => {
    if (!tokenStore.access && !sessionMarker.get()) {
      setUser(null);
      return;
    }
    try {
      setUser(await api<CurrentUser>('/auth/me'));
    } catch {
      tokenStore.clear();
      sessionMarker.clear();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  const login = useCallback<AuthContextValue['login']>(async (input) => {
    const result = await api<LoginResponse>('/auth/login', { method: 'POST', body: input, auth: false });
    if (!result.mfaRequired) {
      tokenStore.set(result.accessToken);
      sessionMarker.set();
      setUser(await api<CurrentUser>('/auth/me'));
    }
    return result;
  }, []);

  const completeMfa = useCallback<AuthContextValue['completeMfa']>(async (input) => {
    const result = await api<LoginResponse>('/auth/2fa/challenge', { method: 'POST', body: input, auth: false });
    if (result.mfaRequired) throw new Error('Unexpected response');
    tokenStore.set(result.accessToken);
    sessionMarker.set();
    setUser(await api<CurrentUser>('/auth/me'));
  }, []);

  const register = useCallback<AuthContextValue['register']>((input) => api<RegisterResponse>('/auth/register', { method: 'POST', body: input, auth: false }), []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } catch {
      /* the local session is cleared regardless */
    }
    tokenStore.clear();
    sessionMarker.clear();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, can: (f) => user?.features.includes(f) ?? false, login, completeMfa, register, logout, reload }),
    [user, loading, login, completeMfa, register, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super administrator',
  superintendent: 'Superintendent',
  principal: 'Principal',
  teacher: 'Teacher',
  student: 'Student',
  parent: 'Parent',
  assistant: 'Assistant',
};
