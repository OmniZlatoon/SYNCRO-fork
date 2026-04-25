"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"
import { SuggestionsPanel } from "@/components/app/SuggestionsPanel"

interface Subscription {
  id: string
  name: string
  price: number
  status: string
  billing_cycle: string
  next_renewal: string
  category: string
}

interface DashboardClientProps {
  initialSubscriptions: Subscription[]
  initialEmailAccounts: any[]
  initialTeamMembers: any[]
  initialNotifications: any[]
  initialProfile: any
  user: User
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
  paused: "bg-yellow-100 text-yellow-800",
  expired: "bg-gray-100 text-gray-600",
}

export default function DashboardClient({
  initialSubscriptions,
  initialEmailAccounts: _initialEmailAccounts,
  initialTeamMembers,
  initialNotifications,
  initialProfile,
  user,
}: DashboardClientProps) {
  const [subscriptions] = useState(initialSubscriptions)
  const [notifications] = useState(initialNotifications)
  // initialEmailAccounts reserved for future email account display
  const [gdprLoading, setGdprLoading] = useState<"export" | "delete" | null>(null)
  const [gdprMessage, setGdprMessage] = useState<string | null>(null)

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = "/auth/login"
  }

  const handleExportData = async () => {
    setGdprLoading("export")
    setGdprMessage(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/export-data`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (!res.ok) throw new Error("Export failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "syncro-data-export.json"
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setGdprMessage("Failed to export data. Please try again.")
    } finally {
      setGdprLoading(null)
    }
  }

  const handleDeleteAccount = async () => {
    if (!window.confirm("This will permanently delete your account and all data. This cannot be undone. Continue?")) return
    setGdprLoading("delete")
    setGdprMessage(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (!res.ok) throw new Error("Deletion failed")
      window.location.href = "/auth/login"
    } catch {
      setGdprMessage("Failed to delete account. Please try again.")
      setGdprLoading(null)
    }
  }

  const unreadCount = notifications.filter((n: any) => !n.read).length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4 flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          Welcome, {initialProfile?.full_name || user.email}
        </h1>
        <button
          onClick={handleSignOut}
          className="px-3 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
        >
          Sign Out
        </button>
      </header>

      <main className="px-4 sm:px-8 py-6 space-y-6">
        {/* Smart money-saving suggestions */}
        <SuggestionsPanel />
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Subscriptions", value: subscriptions.length },
            { label: "Active", value: subscriptions.filter(s => s.status === "active").length },
            { label: "Team Members", value: initialTeamMembers.length },
            { label: "Unread Alerts", value: unreadCount },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-sm text-gray-500">{label}</p>
              <p className="text-2xl font-semibold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Subscriptions — table on desktop, cards on mobile */}
        <section className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">Subscriptions</h2>
          </div>

          {subscriptions.length === 0 ? (
            <p className="px-4 sm:px-6 py-8 text-sm text-gray-500 text-center">
              No subscriptions yet.
            </p>
          ) : (
            <>
              {/* Desktop table — hidden on mobile */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                    <tr>
                      {["Name", "Category", "Price", "Billing", "Next Renewal", "Status"].map(h => (
                        <th key={h} className="px-6 py-3 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {subscriptions.map(sub => (
                      <tr key={sub.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 font-medium text-gray-900">{sub.name}</td>
                        <td className="px-6 py-4 text-gray-600 capitalize">{sub.category}</td>
                        <td className="px-6 py-4 text-gray-600">${Number(sub.price).toFixed(2)}</td>
                        <td className="px-6 py-4 text-gray-600 capitalize">{sub.billing_cycle}</td>
                        <td className="px-6 py-4 text-gray-600">
                          {sub.next_renewal ? new Date(sub.next_renewal).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[sub.status] ?? "bg-gray-100 text-gray-600"}`}>
                            {sub.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards — hidden on sm+ */}
              <ul className="sm:hidden divide-y divide-gray-100">
                {subscriptions.map(sub => (
                  <li key={sub.id} className="px-4 py-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-gray-900">{sub.name}</span>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[sub.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {sub.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600">
                      <span className="text-gray-400">Category</span>
                      <span className="capitalize">{sub.category}</span>
                      <span className="text-gray-400">Price</span>
                      <span>${Number(sub.price).toFixed(2)} / {sub.billing_cycle}</span>
                      <span className="text-gray-400">Next Renewal</span>
                      <span>{sub.next_renewal ? new Date(sub.next_renewal).toLocaleDateString() : "—"}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Privacy & Data section (GDPR) */}
        <section className="bg-white rounded-lg border border-gray-200 px-4 sm:px-6 py-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Privacy & Data</h2>
          <p className="text-sm text-gray-500 mb-4">
            You can download a copy of your data or permanently delete your account.
          </p>
          {gdprMessage && (
            <p className="mb-3 text-sm text-red-600">{gdprMessage}</p>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleExportData}
              disabled={gdprLoading !== null}
              className="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {gdprLoading === "export" ? "Exporting…" : "Export My Data"}
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={gdprLoading !== null}
              className="px-4 py-2 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {gdprLoading === "delete" ? "Deleting…" : "Delete My Account"}
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
