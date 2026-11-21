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
        <header className="site-header border-b border-[#466a76] bg-[#31525e] text-white">
          <nav className="mx-auto flex max-w-[1540px] items-center justify-between gap-8 px-5 py-5 sm:px-8 lg:px-12">
            <Link href="/" className="flex items-center gap-3">
              <span className="brand-mark">V</span>
              <span>
                <span className="block font-serif text-[17px] tracking-tight text-[#f7f7f7]">Vinayak Group</span>
                <span className="mt-0.5 block text-[9px] uppercase tracking-[0.27em] text-[#d8e0e2]">Procurement office</span>
              </span>
            </Link>
            <div className="hidden items-center gap-7 text-[10px] uppercase tracking-[0.22em] text-[#d8e0e2] md:flex">
              <span>Live work package</span>
              <span className="h-5 w-px bg-[#6d8993]" />
              <span className="text-[#f7f7f7]">Amara / Tower-2</span>
              <span className="flex items-center gap-2 text-[#d0b355]"><span className="h-1.5 w-1.5 rounded-full bg-[#d0b355]" /> Connected</span>
            </div>
          </nav>
        </header>
        <div className="border-b border-[#d7dcdd] bg-[#f7f7f7]">
          <div className="mx-auto flex max-w-[1540px] gap-2 overflow-x-auto px-5 sm:px-8 lg:px-12">
            {[{ href: "/intake", label: "Capture", step: "01" }, { href: "/match", label: "Catalogue", step: "02" }, { href: "/quotes", label: "Quotes", step: "03" }, { href: "/comparative", label: "Decision", step: "04" }, { href: "/rfq", label: "RFQ draft", step: "05" }].map((item) => (
              <Link key={item.href} href={item.href} className="group flex shrink-0 items-center gap-2 border-b border-transparent px-3 py-3.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6e766d] transition hover:border-[#a9824b] hover:text-[#202a24]">
                <span className="font-mono text-[9px] text-[#a9824b]">{item.step}</span>
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
