'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

interface DigestPreferences {
  digestEnabled:     boolean;
  digestDay:         number;
  includeYearToDate: boolean;
  updatedAt:         string;
}

interface DigestHistoryEntry {
  id:          string;
  digestType:  'monthly' | 'test';
  periodLabel: string;
  status:      'sent' | 'failed' | 'skipped';
  sentAt:      string;
}

interface DigestSettingsProps {
  darkMode?: boolean;
}

const DAY_OPTIONS = [
  { value: 1,  label: '1st of the month' },
  { value: 5,  label: '5th of the month' },
  { value: 10, label: '10th of the month' },
  { value: 15, label: '15th of the month' },
  { value: 20, label: '20th of the month' },
];

export function DigestSettings({ darkMode }: DigestSettingsProps) {
  const [prefs,        setPrefs]        = useState<DigestPreferences | null>(null);
  const [history,      setHistory]      = useState<DigestHistoryEntry[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [testSending,  setTestSending]  = useState(false);
  const [toastMsg,     setToastMsg]     = useState<{ text: string; ok: boolean } | null>(null);

  const showToast = (text: string, ok: boolean) => {
    setToastMsg({ text, ok });
    setTimeout(() => setToastMsg(null), 4000);
  };

  // Load preferences + history on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [prefsRes, histRes] = await Promise.all([
          apiGet('/api/digest/preferences'),
          apiGet('/api/digest/history'),
        ]);
        if (!mounted) return;
        setPrefs(prefsRes.data);
        setHistory(histRes.data ?? []);
      } catch {
        // non-fatal
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleToggle = useCallback(async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const res = await apiPatch('/api/digest/preferences', {
        digestEnabled: !prefs.digestEnabled,
      });
      setPrefs(res.data);
      showToast(
        res.data.digestEnabled ? 'Monthly digest enabled.' : 'Monthly digest disabled.',
        true,
      );
    } catch {
      showToast('Failed to update preferences.', false);
    } finally {
      setSaving(false);
    }
  }, [prefs]);

  const handleDayChange = useCallback(async (day: number) => {
    if (!prefs) return;
    setSaving(true);
    try {
      const res = await apiPatch('/api/digest/preferences', { digestDay: day });
      setPrefs(res.data);
      showToast('Digest day updated.', true);
    } catch {
      showToast('Failed to update preferences.', false);
    } finally {
      setSaving(false);
    }
  }, [prefs]);

  const handleYtdToggle = useCallback(async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const res = await apiPatch('/api/digest/preferences', {
        includeYearToDate: !prefs.includeYearToDate,
      });
      setPrefs(res.data);
      showToast('Preference saved.', true);
    } catch {
      showToast('Failed to update preferences.', false);
    } finally {
      setSaving(false);
    }
  }, [prefs]);

  const handleSendTest = useCallback(async () => {
    setTestSending(true);
    try {
      await apiPost('/api/digest/test', {});
      showToast('Test digest sent! Check your inbox.', true);
      // Refresh history
      const histRes = await apiGet('/api/digest/history');
      setHistory(histRes.data ?? []);
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Failed to send test digest.';
      showToast(msg, false);
    } finally {
      setTestSending(false);
    }
  }, []);

  // ── Styles ─────────────────────────────────────────────────────────────────
  const card     = `border rounded-xl p-6 ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`;
  const label    = `text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`;
  const subtext  = `text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`;
  const heading  = `text-lg font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`;

  if (loading || !prefs) {
    return (
      <div className={card}>
        <div className="animate-pulse space-y-3">
          <div className={`h-4 rounded w-1/3 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`} />
          <div className={`h-3 rounded w-2/3 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Toast */}
      {toastMsg && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
            toastMsg.ok ? 'bg-[#007A5C] text-white' : 'bg-[#E86A33] text-white'
          }`}
        >
          {toastMsg.text}
        </div>
      )}

      {/* Main settings card */}
      <div className={card}>
        <h3 className={heading}>📧 Monthly Digest Email</h3>

        {/* Enable toggle */}
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              type="button"
              role="switch"
              aria-checked={prefs.digestEnabled}
              disabled={saving}
              onClick={handleToggle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD166] ${
                prefs.digestEnabled ? 'bg-[#007A5C]' : darkMode ? 'bg-gray-700' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  prefs.digestEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <div>
              <p className={label}>Receive monthly digest email</p>
              <p className={subtext}>
                A single summary email instead of individual renewal reminders
              </p>
            </div>
          </label>

          {/* Digest day */}
          {prefs.digestEnabled && (
            <>
              <div>
                <label className={`block ${label} mb-2`}>Send digest on</label>
                <select
                  value={prefs.digestDay}
                  disabled={saving}
                  onChange={(e) => handleDayChange(Number(e.target.value))}
                  className={`px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD166] disabled:opacity-50 ${
                    darkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                >
                  {DAY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Year-to-date toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.includeYearToDate}
                  disabled={saving}
                  onChange={handleYtdToggle}
                  className="w-4 h-4 rounded accent-[#007A5C]"
                />
                <div>
                  <p className={label}>Include year-to-date spend</p>
                  <p className={subtext}>Shows cumulative spend since January</p>
                </div>
              </label>

              {/* Send test */}
              <div className={`pt-2 border-t ${darkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                <p className={`${subtext} mb-3`}>
                  Preview exactly what the digest will look like before the scheduled send.
                </p>
                <button
                  type="button"
                  disabled={testSending || saving}
                  onClick={handleSendTest}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                    darkMode
                      ? 'bg-[#2D3748] text-white hover:bg-[#374151]'
                      : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                  }`}
                >
                  {testSending ? 'Sending…' : '✉️ Send Test Digest'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* History card */}
      {history.length > 0 && (
        <div className={card}>
          <h3 className={heading}>Digest History</h3>
          <div className="space-y-2">
            {history.slice(0, 8).map((h) => (
              <div
                key={h.id}
                className={`flex items-center justify-between py-2 border-b last:border-b-0 ${
                  darkMode ? 'border-gray-800' : 'border-gray-100'
                }`}
              >
                <div>
                  <p className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {h.periodLabel}
                    {h.digestType === 'test' && (
                      <span className={`ml-2 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        (test)
                      </span>
                    )}
                  </p>
                  <p className={subtext}>
                    {new Date(h.sentAt).toLocaleString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                      hour: 'numeric', minute: '2-digit',
                    })}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    h.status === 'sent'
                      ? darkMode ? 'bg-[#007A5C]/20 text-[#007A5C]' : 'bg-green-100 text-green-700'
                      : h.status === 'failed'
                      ? darkMode ? 'bg-[#E86A33]/20 text-[#E86A33]' : 'bg-red-100 text-red-700'
                      : darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {h.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}