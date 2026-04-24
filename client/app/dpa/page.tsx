import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Data Processing Agreement — SYNCRO',
  description: 'Request a Data Processing Agreement (DPA) with SYNCRO.',
}

export default function DpaPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/" className="text-indigo-600 text-sm hover:underline">
        &larr; Back to home
      </Link>

      <h1 className="text-3xl font-bold mt-8 mb-2">Data Processing Agreement</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: March 28, 2026</p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">What is a DPA?</h2>
        <p className="text-gray-700">
          A Data Processing Agreement (DPA) is a legally binding contract between a data controller
          (you or your organization) and a data processor (SYNCRO) that governs how personal data is
          collected, processed, stored, and protected. DPAs are required under data protection
          regulations such as the GDPR (EU), UK GDPR, and similar frameworks when personal data is
          processed on behalf of another organization.
        </p>
        <p className="mt-3 text-gray-700">
          If your organization uses SYNCRO to manage subscriptions and processes personal data of
          employees, customers, or other individuals, you may need a DPA to ensure your compliance
          obligations are met.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Request a DPA</h2>
        <p className="mb-4 text-gray-700">
          We provide DPAs to organizations upon request. To initiate the process, contact our legal
          team:
        </p>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
          <p className="font-medium text-gray-800 mb-1">
            Email us at{' '}
            <a href="mailto:legal@syncro.app" className="text-indigo-600 hover:underline">
              legal@syncro.app
            </a>
          </p>
          <p className="text-sm text-gray-500 mb-4">Use the subject line: &ldquo;DPA Request&rdquo;</p>

          <p className="text-sm font-medium text-gray-700 mb-2">Please include the following:</p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-gray-700">
            <li>Your organization name and registered address</li>
            <li>Name and email address of the primary legal or privacy contact</li>
            <li>
              Jurisdiction(s) under which your organization operates (e.g., EU, UK, US states)
            </li>
            <li>
              Any specific regulatory requirements or clauses you need addressed (e.g., Standard
              Contractual Clauses, specific retention limits)
            </li>
          </ul>
        </div>

        <p className="mt-4 text-gray-700 text-sm">
          We aim to respond to all DPA requests within 5 business days.
        </p>
      </section>

      <hr className="my-8 border-gray-200" />

      <p className="text-sm text-gray-500">
        Also see:{' '}
        <Link href="/privacy" className="text-indigo-600 hover:underline">
          Privacy Policy
        </Link>{' '}
        &middot;{' '}
        <Link href="/terms" className="text-indigo-600 hover:underline">
          Terms of Service
        </Link>
      </p>
    </main>
  )
}
