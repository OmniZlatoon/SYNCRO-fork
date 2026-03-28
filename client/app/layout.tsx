import type React from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PWAProvider } from "../components/pwa-provider";

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "SYNCRO — Subscription Manager",
    description: "Self-custodial subscription management on Stellar",
    generator: "v0.app",
    manifest: "/manifest.json",
    themeColor: "#6366f1",
    viewport: "width=device-width, initial-scale=1, maximum-scale=1",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`font-sans antialiased`} suppressHydrationWarning>
                <PWAProvider>
                    {children}
                </PWAProvider>
            </body>
        </html>
    );
}
