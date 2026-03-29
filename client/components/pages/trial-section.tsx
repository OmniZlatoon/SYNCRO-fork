"use client";

import { useState } from "react";
import { apiPost } from "@/lib/api";
import type { Subscription } from "@/lib/supabase/subscriptions";

interface TrialSectionProps {
  trials: Subscription[];
  darkMode?: boolean;
  onTrialAction: (id: number, action: "convert" | "cancel") => void;
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function urgencyColor(days: number): string {
  if (days <= 1) return "text-red-500";
  if (days <= 3) return "text-orange-500";
  if (days <= 7) return "text-yellow-500";
  return "text-green-600";
}

function urgencyBg(days: number, dark: boolean): string {
  if (days <= 1) return dark ? "bg-red-900/20 border-red-700" : "bg-red-50 border-red-200";
  if (days <= 3) return dark ? "bg-orange-900/20 border-orange-700" : "bg-orange-50 border-orange-200";
  return dark ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200";
}

export function TrialSection({ trials, darkMode = false, onTrialAction }: TrialSectionProps) {
  const [loading, setLoading] = useState<Record<number, boolean>>({});

  if (trials.length === 0) return null;

  // Sort by urgency: fewest days remaining first
  const sorted = [...trials].sort((a, b) => {
    const da = a.trial_ends_at ? daysUntil(a.trial_ends_at) : 999;
    const db = b.trial_ends_at ? daysUntil(b.trial_ends_at) : 999;
    return da - db;
  });

  const handleAction = async (sub: Subscription, action: "convert" | "cancel") => {
    setLoading((prev: Record<number, boolean>) => ({ ...prev, [sub.id]: true }));
    try {
      await apiPost(`/api/subscriptions/${sub.id}/trial/${action}`);
      onTrialAction(sub.id, action);
    } catch (err) {
      console.error(`Trial ${action} failed`, err);
    } finally {
      setLoading((prev: Record<number, boolean>) => ({ ...prev, [sub.id]: false }));
    }
  };

  return (
    <section aria-labelledby="active-trials-heading" className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg" aria-hidden="true">🧪</span>
        <h3
          id="active-trials-heading"
          className={`text-lg font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}
        >
          Active Trials
        </h3>
        <span className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
          ({sorted.length})
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((sub) => {
          const days = sub.trial_ends_at ? daysUntil(sub.trial_ends_at) : null;
          const convertPrice = sub.trial_converts_to_price ?? sub.price_after_trial;
          const isLoading = loading[sub.id];

          return (
            <div
              key={sub.id}
              className={`border rounded-xl p-5 flex flex-col gap-3 ${urgencyBg(days ?? 999, darkMode)}`}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#1E2A35] rounded-lg flex items-center justify-center text-xl" aria-hidden="true">
                    {sub.icon}
                  </div>
                  <div>
                    <p className={`font-semibold text-sm ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                      {sub.name}
                    </p>
                    <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>{sub.category}</p>
                  </div>
                </div>
                {sub.credit_card_required && (
                  <span
                    title="Credit card on file — will auto-charge"
                    className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full font-medium"
                  >
                    CC required
                  </span>
                )}
              </div>

              {/* Countdown */}
              {days !== null && (
                <div className={`flex items-center gap-2 font-semibold text-sm ${urgencyColor(days)}`}>
                  <span aria-hidden="true">⏱</span>
                  <span>
                    {days === 0
                      ? "Expires TODAY"
                      : days === 1
                      ? "Expires tomorrow"
                      : `Expires in ${days} days`}
                  </span>
                </div>
              )}

              {/* Convert price info */}
              {convertPrice != null && (
                <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Converts to <span className="font-semibold">${convertPrice.toFixed(2)}/mo</span> after trial
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-auto pt-1">
                <button
                  onClick={() => handleAction(sub, "cancel")}
                  disabled={isLoading}
                  aria-label={`Cancel ${sub.name} trial`}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
                >
                  Cancel Trial
                </button>
                <button
                  onClick={() => handleAction(sub, "convert")}
                  disabled={isLoading}
                  aria-label={`Keep ${sub.name} subscription`}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-[#007A5C]/10 text-[#007A5C] hover:bg-[#007A5C]/20 dark:bg-[#007A5C]/20 dark:hover:bg-[#007A5C]/30 transition-colors disabled:opacity-50"
                >
                  Keep It
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
