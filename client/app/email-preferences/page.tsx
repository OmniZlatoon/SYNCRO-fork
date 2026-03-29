'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface EmailPreferences {
  reminders: boolean;
  digests: boolean;
  marketing: boolean;
  updates: boolean;
}

const CATEGORIES: {
  key: keyof EmailPreferences;
  title: string;
  description: string;
}[] = [
  {
    key: 'reminders',
    title: 'Renewal Reminders',
    description: 'Notifications before your subscriptions renew',
  },
  {
    key: 'digests',
    title: 'Monthly Digest',
    description: 'Monthly summary of your subscription spending',
  },
  {
    key: 'marketing',
    title: 'Marketing',
    description: 'Product announcements and feature updates',
  },
  {
    key: 'updates',
    title: 'Account Updates',
    description: 'Important account and security notifications',
  },
];

function getAuthToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(^| )authToken=([^;]+)/);
  return match ? match[2] : '';
}

function Toggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
        enabled ? 'bg-indigo-600' : 'bg-gray-300'
      }`}
      aria-pressed={enabled}
    >
      <span
        className={`inline-block w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 mt-0.5 ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function EmailPreferencesPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<keyof EmailPreferences | null>(null);

  const buildHeaders = useCallback((): HeadersInit => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      const authToken = getAuthToken();
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
  }, [token]);

  useEffect(() => {
    const url = new URL(`${API_BASE}/api/compliance/email-preferences`);
    if (token) url.searchParams.set('token', token);

    fetch(url.toString(), {
      credentials: 'include',
      headers: buildHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load preferences (${res.status})`);
        const json = await res.json();
        setPrefs(json.data ?? json);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, buildHeaders]);

  const handleToggle = async (key: keyof EmailPreferences) => {
    if (!prefs) return;
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);

    try {
      const res = await fetch(`${API_BASE}/api/compliance/email-preferences`, {
        method: 'PATCH',
        credentials: 'include',
        headers: buildHeaders(),
        body: JSON.stringify({ [key]: updated[key], ...(token ? { token } : {}) }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 2000);
    } catch (err) {
      // Revert on failure
      setPrefs(prefs);
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h1 className="text-2xl font-semibold text-gray-900 mb-1">Email Preferences</h1>
          <p className="text-sm text-gray-500 mb-8">
            Choose which emails you&apos;d like to receive from Syncro.
          </p>

          {loading && (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center justify-between py-4 border-b border-gray-100 animate-pulse">
                  <div className="space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-36" />
                    <div className="h-3 bg-gray-100 rounded w-56" />
                  </div>
                  <div className="w-11 h-6 bg-gray-200 rounded-full" />
                </div>
              ))}
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {prefs && !loading && (
            <div className="divide-y divide-gray-100">
              {CATEGORIES.map(({ key, title, description }) => (
                <div key={key} className="flex items-center justify-between py-5">
                  <div className="pr-4">
                    <p className="text-sm font-medium text-gray-900">{title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                    {savedKey === key && (
                      <p className="text-xs text-indigo-600 mt-1">Saved</p>
                    )}
                  </div>
                  <Toggle enabled={prefs[key]} onToggle={() => handleToggle(key)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Review our{' '}
          <Link href="/privacy" className="text-indigo-600 hover:underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </main>
  );
}
