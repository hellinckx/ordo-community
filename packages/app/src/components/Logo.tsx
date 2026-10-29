import { cls } from "@/lib/format";

/** The Ordo mark: an O with a planet on its orbit, white on the solid brand square. Same drawing as brand/logo.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cls("shrink-0", className)}>
      <rect width="64" height="64" rx="15" fill="#0a5fe0" />
      <circle cx="32" cy="32" r="14.5" fill="none" stroke="#fff" strokeWidth="5.5" />
      <circle cx="42.25" cy="21.75" r="6.5" fill="#0a5fe0" />
      <circle cx="42.25" cy="21.75" r="4.25" fill="#fff" />
    </svg>
  );
}
