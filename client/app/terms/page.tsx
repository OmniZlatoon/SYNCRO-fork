import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service — SYNCRO',
  description: 'Terms governing your use of the SYNCRO subscription management platform.',
}

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/" className="text-indigo-600 text-sm hover:underline">
        &larr; Back to home
      </Link>

      <h1 className="text-3xl font-bold mt-8 mb-2">Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: March 28, 2026</p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
        <p className="text-gray-700">
          By creating an account or using SYNCRO, you agree to be bound by these Terms of Service.
          If you do not agree, you must not access or use the platform. These terms apply to all
          users, including individuals and organizations.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
        <p className="text-gray-700">
          SYNCRO is a self-custodial subscription management platform that allows users to track,
          manage, and automate recurring crypto payments on the Stellar blockchain. The platform
          provides subscription tracking, renewal reminders, spending digests, and on-chain
          coordination via Soroban smart contracts.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">3. Self-Custodial Nature</h2>
        <p className="mb-2 text-gray-700">
          SYNCRO is a non-custodial service. This means:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>
            We never hold, control, or have access to your funds, private keys, or seed phrases
          </li>
          <li>You are solely responsible for the security of your wallet and credentials</li>
          <li>
            All on-chain transactions are executed by you or smart contracts you have authorized
          </li>
          <li>
            SYNCRO cannot reverse, cancel, or recover any blockchain transactions on your behalf
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">4. Account Responsibilities</h2>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>You must provide accurate information when creating your account</li>
          <li>You are responsible for maintaining the confidentiality of your login credentials</li>
          <li>You must notify us immediately of any unauthorized use of your account</li>
          <li>
            You may not share your account with others or allow third parties to access it on your
            behalf without explicit authorization
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">5. Acceptable Use</h2>
        <p className="mb-2 text-gray-700">You agree not to use SYNCRO to:</p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>Violate any applicable laws or regulations</li>
          <li>Engage in money laundering, fraud, or other financial crimes</li>
          <li>Attempt to gain unauthorized access to other accounts or system infrastructure</li>
          <li>Transmit malware, spam, or other harmful content</li>
          <li>Reverse-engineer, decompile, or scrape the platform without permission</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">6. Service Availability</h2>
        <p className="text-gray-700">
          SYNCRO is provided on an &ldquo;as-is&rdquo; and &ldquo;as-available&rdquo; basis. We do
          not offer a Service Level Agreement (SLA) and do not guarantee uninterrupted access to the
          platform. Scheduled maintenance, third-party outages (including Supabase and the Stellar
          Network), or unforeseen incidents may affect availability.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">7. Limitation of Liability</h2>
        <p className="mb-2 text-gray-700">
          To the fullest extent permitted by law, SYNCRO and its team are not liable for:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>
            Missed renewal reminders or notification failures due to delivery issues or system
            outages
          </li>
          <li>
            Failed, delayed, or incorrect blockchain transactions on the Stellar network
          </li>
          <li>Loss of funds resulting from wallet mismanagement or unauthorized access</li>
          <li>
            Any indirect, incidental, special, or consequential damages arising from your use of
            the platform
          </li>
        </ul>
        <p className="mt-3 text-gray-700">
          Our aggregate liability to you for any claim shall not exceed the amount you paid to
          SYNCRO in the twelve months preceding the claim.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">8. Termination</h2>
        <p className="text-gray-700">
          You may delete your account at any time. Upon deletion, your data will be retained for a
          30-day grace period before permanent removal, in accordance with our{' '}
          <Link href="/privacy" className="text-indigo-600 hover:underline">
            Privacy Policy
          </Link>
          . We reserve the right to suspend or terminate accounts that violate these terms, with or
          without prior notice depending on the severity of the violation.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">9. Changes to Terms</h2>
        <p className="text-gray-700">
          We may update these Terms of Service from time to time. When we do, we will update the
          &ldquo;Last updated&rdquo; date at the top of this page and notify active users via email.
          Continued use of SYNCRO after changes take effect constitutes your acceptance of the
          revised terms.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">10. Contact</h2>
        <p className="text-gray-700">
          For legal inquiries or questions about these terms, contact us at{' '}
          <a href="mailto:legal@syncro.app" className="text-indigo-600 hover:underline">
            legal@syncro.app
          </a>
          .
        </p>
      </section>

      <hr className="my-8 border-gray-200" />

      <p className="text-sm text-gray-500">
        Also see:{' '}
        <Link href="/privacy" className="text-indigo-600 hover:underline">
          Privacy Policy
        </Link>{' '}
        &middot;{' '}
        <Link href="/dpa" className="text-indigo-600 hover:underline">
          Data Processing Agreement
        </Link>
      </p>
    </main>
  )
}
