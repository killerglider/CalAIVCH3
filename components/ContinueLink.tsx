import Link from "next/link";

export function ContinueLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-6 flex justify-end border-t border-[#cbd4d6] pt-5">
      <Link href={href} className="gold-button">
        Continue to {label} <span aria-hidden="true" className="text-base text-[#d0b355]">&rarr;</span>
      </Link>
    </div>
  );
}
