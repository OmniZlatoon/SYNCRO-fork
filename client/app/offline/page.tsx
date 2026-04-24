'use client';
import React from 'react';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">You're Offline</h1>
          <p className="text-gray-400 mb-6">Showing cached subscription data</p>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <h2 className="text-lg font-semibold mb-4">Cached Subscriptions</h2>
          <div className="space-y-3">
            {/* Placeholder for cached subscriptions - in a real implementation,
                this would be populated from IndexedDB or localStorage */}
            <div className="flex items-center justify-between p-3 bg-gray-700 rounded">
              <div>
                <p className="font-medium">Netflix</p>
                <p className="text-sm text-gray-400">Renews: Dec 15, 2024</p>
              </div>
              <span className="text-green-400 text-sm">Active</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-700 rounded">
              <div>
                <p className="font-medium">Spotify</p>
                <p className="text-sm text-gray-400">Renews: Dec 20, 2024</p>
              </div>
              <span className="text-green-400 text-sm">Active</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}