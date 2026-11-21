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
        <header className="border-b border-slate-800 bg-slate-950 text-white">
          <nav className="mx-auto flex max-w-[1440px] items-center justify-between gap-5 px-5 py-4 sm:px-8">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-400 text-sm font-black text-slate-950">V</span>
              <span>
                <span className="block text-sm font-semibold tracking-tight">Vinayak Procurement</span>
                <span className="block text-[10px] uppercase tracking-[0.22em] text-slate-400">Decision workspace</span>
              </span>
            </Link>
            <div className="hidden items-center gap-2 text-xs text-slate-400 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Demo data connected
              <span className="ml-3 rounded-full border border-slate-700 px-3 py-1 text-slate-300">Amara Tower-2</span>
            </div>
          </nav>
        </header>
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-5 sm:px-8">
            {[{ href: "/intake", label: "Intake", step: "01" }, { href: "/match", label: "Match", step: "02" }, { href: "/quotes", label: "Quotes", step: "03" }, { href: "/comparative", label: "Compare", step: "04" }, { href: "/rfq", label: "RFQ draft", step: "05" }].map((item) => (
              <Link key={item.href} href={item.href} className="group flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-3 text-xs font-semibold text-slate-500 transition hover:border-amber-400 hover:text-slate-950">
                <span className="font-mono text-[10px] text-slate-400 group-hover:text-amber-600">{item.step}</span>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
