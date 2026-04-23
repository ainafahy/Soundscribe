"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Masthead() {
  const pathname = usePathname();

  const links: { href: string; label: string }[] = [
    { href: "/", label: "home" },
    { href: "/image", label: "image" },
    { href: "/text", label: "text" },
  ];

  return (
    <header className="masthead">
      <Link href="/" className="mast-brand" aria-label="Soundscribe home">
        Soundscribe
        <span className="it">by ainafahy</span>
      </Link>
      <nav className="mast-links" aria-label="primary">
        {links.map(({ href, label }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={`mast-link${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
