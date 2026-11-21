import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Vinayak Procurement Agent",
  description: "Mock-first procurement workflow demo",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
            <Link href="/" className="font-semibold text-slate-950">
              Vinayak Procurement
            </Link>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
              Mock API demo
            </span>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
