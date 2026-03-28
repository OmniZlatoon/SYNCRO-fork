"use client"

import { useState } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { Download, Calendar, BarChart3, ChevronLeft, ChevronRight } from "lucide-react"
import { downloadSubscriptionPDF } from "@/lib/pdf-report"

interface AnalyticsPageProps {
  subscriptions: any[]
  totalSpend: number
  darkMode?: boolean
  mode?: string
}

export default function AnalyticsPage({ subscriptions, totalSpend, darkMode, mode = "individual" }: AnalyticsPageProps) {
  const [view, setView] = useState("default") // 'default', 'calendar', 'comparison'
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [comparisonYear, setComparisonYear] = useState(new Date().getFullYear())

  const weeklyPerformance = [
    { day: "Mon", spend: 45, change: "+57%", sales: 2456, revenue: 9.8 },
    { day: "Tue", spend: 52, change: "+44%", sales: 2678, revenue: 10.2 },
    { day: "Wed", spend: 67, change: "+81%", sales: 2987, revenue: 11.3 },
    { day: "Thu", spend: 48, change: "+37%", sales: 2234, revenue: 8.9 },
    { day: "Fri", spend: 58, change: "+53%", sales: 2789, revenue: 10.8 },
    { day: "Sat", spend: 55, change: "+48%", sales: 2567, revenue: 10.1 },
    { day: "Sun", spend: 62, change: "+77%", sales: 2890, revenue: 11.0 },
  ]

  const monthlyData = [
    { month: "Jul", spend: 42 },
    { month: "Aug", spend: 48 },
    { month: "Sep", spend: 55 },
    { month: "Oct", spend: 62 },
    { month: "Nov", spend: 58 },
    { month: "Dec", spend: 67 },
  ]

  const categorySpend = subscriptions.reduce((acc: Array<{ name: string; value: number }>, sub: any) => {
    const existing = acc.find((item: { name: string; value: number }) => item.name === sub.category)
    if (existing) {
      existing.value += sub.price
    } else {
      acc.push({ name: sub.category, value: sub.price })
    }
    return acc
  }, [])

  const COLORS = ["#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe", "#e0e7ff"]

  const topTools = [...subscriptions].sort((a, b) => b.price - a.price).slice(0, 4)

  const handleExportCSV = () => {
    const headers = ["Name", "Category", "Price", "Renewal Date", "Status"]
    const rows = subscriptions.map((sub) => [
      sub.name,
      sub.category,
      `$${sub.price}`,
      new Date(Date.now() + sub.renewsIn * 24 * 60 * 60 * 1000).toLocaleDateString(),
      sub.status,
    ])

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `subscriptions-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
  }

  const handleExportPDF = async () => {
    await downloadSubscriptionPDF(subscriptions)
  }

  const getBusinessSubscriptions = () => {
    return subscriptions.filter(
      (sub) =>
        sub.tags?.includes("work") ||
        sub.tags?.includes("business") ||
        sub.category === "Development" ||
        sub.category === "Productivity",
    )
  }

  const handleExportBusinessCSV = () => {
    const businessSubs = getBusinessSubscriptions()
    const headers = ["Name", "Category", "Price", "Renewal Date", "Status", "Tax Deductible"]
    const rows = businessSubs.map((sub) => [
      sub.name,
      sub.category,
      `$${sub.price}`,
      new Date(Date.now() + sub.renewsIn * 24 * 60 * 60 * 1000).toLocaleDateString(),
      sub.status,
      "Yes",
    ])

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `business-subscriptions-tax-report-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
  }

  const calculateSpendingTrends = () => {
    const currentMonthSpend = subscriptions
      .filter((sub) => sub.status === "active")
      .reduce((sum, sub) => sum + sub.price, 0)

    const lastMonthSpend = currentMonthSpend * 0.85 // Simulate 15% increase
    const change = ((currentMonthSpend - lastMonthSpend) / lastMonthSpend) * 100

    return {
      current: currentMonthSpend,
      previous: lastMonthSpend,
      change: change.toFixed(1),
      isIncrease: change > 0,
    }
  }

  const calculateYearOverYear = () => {
    const currentYear = new Date().getFullYear()
    const currentYearSpend = subscriptions
      .filter((sub) => sub.status === "active")
      .reduce((sum, sub) => sum + sub.price * 12, 0)

    const previousYearSpend = currentYearSpend * 0.75 // Simulate 25% increase
    const change = ((currentYearSpend - previousYearSpend) / previousYearSpend) * 100

    return {
      current: currentYearSpend,
      previous: previousYearSpend,
      change: change.toFixed(1),
      isIncrease: change > 0,
    }
  }

  const getSimilarTools = (category: string) => {
    return subscriptions.filter((sub) => sub.category === category)
  }

  const upcomingRenewals = subscriptions
    .map((sub) => ({
      ...sub,
      renewalDate: new Date(Date.now() + sub.renewsIn * 24 * 60 * 60 * 1000),
    }))
    .sort((a, b) => a.renewalDate - b.renewalDate)

  const getCalendarDays = () => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDayOfWeek = firstDay.getDay()

    const days = []
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null)
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i)
    }
    return days
  }

  const getRenewalsForDate = (day: number | null) => {
    if (!day) return []
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const targetDate = new Date(year, month, day)

    return subscriptions.filter((sub) => {
      const renewalDate = new Date(Date.now() + sub.renewsIn * 24 * 60 * 60 * 1000)
      return renewalDate.getDate() === day && renewalDate.getMonth() === month && renewalDate.getFullYear() === year
    })
  }

  const previousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))
  }

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))
  }

  const calendarDays = getCalendarDays()
  const monthName = currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })
  const spendingTrends = calculateSpendingTrends()
  const yearOverYear = calculateYearOverYear()

  return (
    <div className="space-y-8">
      {/* Action Buttons */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handleExportCSV}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            darkMode ? "bg-[#2D3748] text-white hover:bg-[#374151]" : "bg-gray-100 text-gray-900 hover:bg-gray-200"
          }`}
        >
          <Download className="w-4 h-4" />
          Export as CSV
        </button>
        <button
          onClick={handleExportPDF}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            darkMode ? "bg-[#2D3748] text-white hover:bg-[#374151]" : "bg-gray-100 text-gray-900 hover:bg-gray-200"
          }`}
        >
          <Download className="w-4 h-4" />
          Export as PDF
        </button>
        <button
          onClick={handleExportBusinessCSV}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            darkMode ? "bg-[#007A5C] text-white hover:bg-[#007A5C]/90" : "bg-[#007A5C] text-white hover:bg-[#007A5C]/90"
          }`}
        >
          <Download className="w-4 h-4" />
          Tax Report
        </button>
        <button
          onClick={() => setView(view === "calendar" ? "default" : "calendar")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            view === "calendar"
              ? "bg-[#FFD166] text-[#1E2A35]"
              : darkMode
                ? "bg-[#2D3748] text-white hover:bg-[#374151]"
                : "bg-gray-100 text-gray-900 hover:bg-gray-200"
          }`}
        >
          <Calendar className="w-4 h-4" />
          Calendar View
        </button>
        <button
          onClick={() => setView(view === "comparison" ? "default" : "comparison")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            view === "comparison"
              ? "bg-[#FFD166] text-[#1E2A35]"
              : darkMode
                ? "bg-[#2D3748] text-white hover:bg-[#374151]"
                : "bg-gray-100 text-gray-900 hover:bg-gray-200"
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Compare Tools
        </button>
      </div>

      {/* Spending Trends Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div
          className={`border rounded-xl p-6 ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}
        >
          <h3 className={`text-lg font-semibold mb-2 ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
            Monthly Spending Trend
          </h3>
          <p className={`text-sm mb-4 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>Compared to last month</p>
          <div className="flex items-end gap-4">
            <div>
              <p className={`text-3xl font-bold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                ${spendingTrends.current.toFixed(2)}
              </p>
              <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>This month</p>
            </div>
            <div
              className={`flex items-center gap-1 px-3 py-1 rounded-full ${
                spendingTrends.isIncrease
                  ? darkMode
                    ? "bg-[#E86A33]/20 text-[#E86A33]"
                    : "bg-red-100 text-red-600"
                  : darkMode
                    ? "bg-[#007A5C]/20 text-[#007A5C]"
                    : "bg-green-100 text-green-600"
              }`}
            >
              <span className="text-lg">{spendingTrends.isIncrease ? "↑" : "↓"}</span>
              <span className="font-semibold">{Math.abs(Number.parseFloat(spendingTrends.change))}%</span>
            </div>
          </div>
        </div>

        {/* Year-over-Year Comparison Card */}
        <div
          className={`border rounded-xl p-6 ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}
        >
          <h3 className={`text-lg font-semibold mb-2 ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
            Year-over-Year Comparison
          </h3>
          <p className={`text-sm mb-4 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
            {new Date().getFullYear()} vs {new Date().getFullYear() - 1}
          </p>
          <div className="flex items-end gap-4">
            <div>
              <p className={`text-3xl font-bold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                ${yearOverYear.current.toFixed(2)}
              </p>
              <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>Annual spend</p>
            </div>
            <div
              className={`flex items-center gap-1 px-3 py-1 rounded-full ${
                yearOverYear.isIncrease
                  ? darkMode
                    ? "bg-[#E86A33]/20 text-[#E86A33]"
                    : "bg-red-100 text-red-600"
                  : darkMode
                    ? "bg-[#007A5C]/20 text-[#007A5C]"
                    : "bg-green-100 text-green-600"
              }`}
            >
              <span className="text-lg">{yearOverYear.isIncrease ? "↑" : "↓"}</span>
              <span className="font-semibold">{Math.abs(Number.parseFloat(yearOverYear.change))}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar View */}
      {view === "calendar" && (
        <div
          className={`border rounded-xl p-6 ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>Renewal Calendar</h3>
            <div className="flex items-center gap-4">
              <button
                onClick={previousMonth}
                className={`p-2 rounded-lg ${darkMode ? "hover:bg-[#374151]" : "hover:bg-gray-100"}`}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className={`font-medium ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>{monthName}</span>
              <button
                onClick={nextMonth}
                className={`p-2 rounded-lg ${darkMode ? "hover:bg-[#374151]" : "hover:bg-gray-100"}`}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div
                key={day}
                className={`text-center text-sm font-medium py-2 ${darkMode ? "text-gray-400" : "text-gray-600"}`}
              >
                {day}
              </div>
            ))}

            {calendarDays.map((day, index) => {
              const renewals = getRenewalsForDate(day)
              const isToday =
                day &&
                new Date().getDate() === day &&
                new Date().getMonth() === currentMonth.getMonth() &&
                new Date().getFullYear() === currentMonth.getFullYear()

              return (
                <div
                  key={index}
                  className={`min-h-[100px] p-2 border rounded-lg ${
                    darkMode ? "border-[#374151]" : "border-gray-200"
                  } ${!day ? "bg-transparent border-transparent" : ""} ${
                    isToday ? (darkMode ? "bg-[#FFD166]/10 border-[#FFD166]" : "bg-[#FFD166]/20 border-[#FFD166]") : ""
                  }`}
                >
                  {day && (
                    <>
                      <div
                        className={`text-sm font-medium mb-1 ${
                          isToday
                            ? darkMode
                              ? "text-[#FFD166]"
                              : "text-[#1E2A35]"
                            : darkMode
                              ? "text-gray-400"
                              : "text-gray-600"
                        }`}
                      >
                        {day}
                      </div>
                      {renewals.length > 0 && (
                        <div className="space-y-1">
                          {renewals.slice(0, 2).map((renewal) => (
                            <div
                              key={renewal.id}
                              className={`text-xs p-1 rounded ${
                                darkMode ? "bg-[#007A5C]/20 text-[#007A5C]" : "bg-[#007A5C]/10 text-[#007A5C]"
                              }`}
                            >
                              <div className="font-medium truncate">{renewal.name}</div>
                              <div className="font-bold">${renewal.price}</div>
                            </div>
                          ))}
                          {renewals.length > 2 && (
                            <div className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                              +{renewals.length - 2} more
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Comparison View */}
      {view === "comparison" && (
        <div
          className={`border rounded-xl p-6 ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}
        >
          <h3 className={`text-lg font-semibold mb-4 ${darkMode ? "text-white" : "text-gray-900"}`}>
            Cost Comparison by Category
          </h3>
          <div className="space-y-4">
            {categorySpend.map((category, idx) => {
              const tools = getSimilarTools(category.name)
              return (
                <div key={idx}>
                  <p className={`font-medium mb-2 ${darkMode ? "text-white" : "text-gray-900"}`}>
                    {category.name} - Total: ${category.value}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {tools.map((tool) => (
                      <div
                        key={tool.id}
                        className={`p-3 rounded-lg border ${
                          darkMode ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <img src={tool.logo || "/placeholder.svg"} alt={tool.name} className="w-6 h-6 rounded" />
                          <p className={`text-sm font-medium ${darkMode ? "text-white" : "text-gray-900"}`}>
                            {tool.name}
                          </p>
                        </div>
                        <p className={`text-lg font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
                          ${tool.price}
                        </p>
                        <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>/month</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Default View */}
      {view === "default" && (
        <>
          {/* Monthly Overview Line Chart */}
          <div
            className={`border rounded-xl p-6 ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}
          >
            <div className="mb-6">
              <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                Monthly Overview
              </h3>
              <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                Your spending trend over the past 6 months
              </p>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#374151" : "#e5e7eb"} />
                <XAxis dataKey="month" stroke={darkMode ? "#9ca3af" : "#9ca3af"} />
                <YAxis
                  stroke={darkMode ? "#9ca3af" : "#9ca3af"}
                  label={{ value: "$", angle: -90, position: "insideLeft" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: darkMode ? "#1f2937" : "#fff",
                    border: `1px solid ${darkMode ? "#374151" : "#e5e7eb"}`,
                    borderRadius: "8px",
                    color: darkMode ? "#fff" : "#000",
                  }}
                  formatter={(value) => `$${value}`}
                />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#6366f1"
                  strokeWidth={3}
                  dot={{ fill: "#6366f1", r: 5 }}
                  activeDot={{ r: 7 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Pie Chart and Top Tools */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Pie Chart */}
            <div
              className={`border rounded-xl p-6 ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}
            >
              <div className="mb-6">
                <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                  Monthly Overview
                </h3>
                <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                  How you're spending across AI categories
                </p>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={categorySpend}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {categorySpend.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `$${value}`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-6 space-y-2 text-sm">
                {categorySpend.map((cat, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                      ></div>
                      <span className={darkMode ? "text-gray-400" : "text-gray-600"}>
                        {cat.name}: ${cat.value}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Tools */}
            <div
              className={`border rounded-xl p-6 ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}
            >
              <div className="mb-6">
                <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Top Tools</h3>
                <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Ranked by monthly spend</p>
              </div>
              <div className="space-y-4">
                {topTools.map((tool, idx) => {
                  const percentage = ((tool.price / totalSpend) * 100).toFixed(0)
                  return (
                    <div
                      key={idx}
                      className={`flex items-center justify-between pb-4 border-b ${
                        darkMode ? "border-gray-700" : "border-gray-100"
                      } last:border-b-0`}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-8 h-8 rounded" style={{ backgroundColor: "#000" }}></div>
                        <div className="flex-1">
                          <p className={`font-medium ${darkMode ? "text-white" : "text-gray-900"}`}>{tool.name}</p>
                          <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>{tool.category}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>${tool.price}</p>
                        <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                          {percentage}% of Total
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
