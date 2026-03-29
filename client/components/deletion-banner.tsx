'use client';

import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface DeletionStatus {
  status: string;
  scheduled_deletion_at?: string;
}

export default function DeletionBanner() {
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/compliance/account/deletion-status`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        const data: DeletionStatus = json.data ?? json;
        if (data?.status === 'pending') setStatus(data);
      })
      .catch(() => {
        // Silently fail — no banner shown on error
      });
  }, []);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`${API_BASE}/api/compliance/account/delete/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) setHidden(true);
    } finally {
      setCancelling(false);
    }
  };

  if (!status || hidden) return null;

  const formattedDate = status.scheduled_deletion_at
    ? new Date(status.scheduled_deletion_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'a scheduled date';

  return (
    <div className="bg-red-50 border-b border-red-200 px-4 py-3">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-sm text-red-800">
          Your account is scheduled for deletion on{' '}
          <span className="font-semibold">{formattedDate}</span>.
        </p>
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="shrink-0 text-sm font-medium text-red-700 underline hover:text-red-900 disabled:opacity-50 transition-colors"
        >
          {cancelling ? 'Cancelling…' : 'Cancel Deletion'}
        </button>
      </div>
    </div>
  );
}
