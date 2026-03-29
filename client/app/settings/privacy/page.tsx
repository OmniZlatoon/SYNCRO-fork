'use client';

import { useState } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function DataPrivacyPage() {
  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Delete modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteScheduled, setDeleteScheduled] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`${API_BASE}/api/compliance/export`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'syncro-data-export.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`${API_BASE}/api/compliance/account/delete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setDeleteScheduled(true);
      setModalOpen(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete request failed');
    } finally {
      setDeleting(false);
    }
  };

  const openModal = () => {
    setReason('');
    setConfirmed(false);
    setDeleteError(null);
    setModalOpen(true);
  };

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Back link */}
        <Link
          href="/settings/security"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-8 transition-colors"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Security Settings
        </Link>

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Data &amp; Privacy</h1>
        <p className="text-sm text-gray-500 mb-8">Manage your personal data and privacy preferences.</p>

        <div className="space-y-6">
          {/* Section 1: Export */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Export Your Data</h2>
            <p className="text-sm text-gray-500 mb-4">
              Download a copy of all the data Syncro holds about your account, including subscriptions, billing
              history, and profile information.
            </p>
            {exportError && (
              <p className="text-sm text-red-600 mb-3">{exportError}</p>
            )}
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {exporting ? 'Preparing export…' : 'Download Export (ZIP)'}
            </button>
          </section>

          {/* Section 2: Email Preferences */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Email Preferences</h2>
            <p className="text-sm text-gray-500 mb-4">
              Control which emails Syncro sends you, including renewal reminders, digests, and marketing
              communications.
            </p>
            <Link
              href="/email-preferences"
              className="inline-flex px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
            >
              Manage Email Preferences
            </Link>
          </section>

          {/* Section 3: Delete Account */}
          <section className="bg-white rounded-2xl border border-red-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Delete Account</h2>
            <p className="text-sm text-gray-500 mb-4">
              Permanently delete your Syncro account. Your data will be removed after a 30-day grace period, during
              which you can cancel this request.
            </p>

            {deleteScheduled && (
              <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 mb-4 text-sm text-yellow-800">
                Your account deletion has been scheduled. You have 30 days to cancel this request before your data
                is permanently removed.
              </div>
            )}

            <button
              onClick={openModal}
              disabled={deleteScheduled}
              className="px-4 py-2 text-sm font-medium border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              Delete Account
            </button>
          </section>
        </div>

        {/* Footer links */}
        <p className="text-center text-xs text-gray-400 mt-8">
          <Link href="/privacy" className="text-indigo-600 hover:underline">
            Privacy Policy
          </Link>
          {' · '}
          <Link href="/terms" className="text-indigo-600 hover:underline">
            Terms of Service
          </Link>
        </p>
      </div>

      {/* Delete confirmation modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Account</h3>
            <p className="text-sm text-gray-600 mb-4">
              This action will begin a 30-day countdown before your account and all associated data are permanently
              deleted. All active subscriptions will be cancelled immediately.
            </p>

            {/* Optional reason */}
            <label className="block mb-4">
              <span className="text-sm font-medium text-gray-700">Reason (optional)</span>
              <textarea
                className="mt-1 block w-full text-sm rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                rows={3}
                placeholder="Tell us why you're leaving…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>

            {/* Confirmation checkbox */}
            <label className="flex items-start gap-3 mb-5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span className="text-sm text-gray-700">
                I understand this action will cancel my subscriptions and permanently delete my data after 30 days.
              </span>
            </label>

            {deleteError && (
              <p className="text-sm text-red-600 mb-4">{deleteError}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!confirmed || deleting}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
