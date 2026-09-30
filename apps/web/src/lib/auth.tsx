'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore, type TokenPair } from './api';

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
  createdAt: string;
  lastLoginAt: string | null;
  features: string[];
}

export type LoginResponse = { mfaRequired: true; mfaToken: string } | ({ mfaRequired: false; user: CurrentUser } & TokenPair);

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  can: (feature: string) => boolean;
  login: (input: { email: string; password: string; rememberMe?: boolean }) => Promise<LoginResponse>;
  completeMfa: (input: { mfaToken: string; code: string; rememberMe?: boolean }) => Promise<void>;
  register: (input: { email: string; password: string; firstName: string; lastName: string; role: string }) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!tokenStore.access && !tokenStore.refresh) {
      setUser(null);
      return;
    }
    try {
      setUser(await api<CurrentUser>('/auth/me'));
    } catch {
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  const login = useCallback<AuthContextValue['login']>(async (input) => {
    const result = await api<LoginResponse>('/auth/login', { method: 'POST', body: input, auth: false });
    if (!result.mfaRequired) {
      tokenStore.set(result);
      setUser(await api<CurrentUser>('/auth/me'));
    }
    return result;
  }, []);

  const completeMfa = useCallback<AuthContextValue['completeMfa']>(async (input) => {
    const result = await api<LoginResponse>('/auth/2fa/challenge', { method: 'POST', body: input, auth: false });
    if (result.mfaRequired) throw new Error('Unexpected response');
    tokenStore.set(result);
    setUser(await api<CurrentUser>('/auth/me'));
  }, []);

  const register = useCallback<AuthContextValue['register']>(async (input) => {
    const result = await api<{ user: CurrentUser } & TokenPair>('/auth/register', { method: 'POST', body: input, auth: false });
    tokenStore.set(result);
    setUser(await api<CurrentUser>('/auth/me'));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: { refreshToken: tokenStore.refresh ?? undefined } });
    } catch {
      /* the local session is cleared regardless */
    }
    tokenStore.clear();
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
