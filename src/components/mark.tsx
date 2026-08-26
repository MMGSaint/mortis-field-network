export function Mark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M32 14 L38 32 L32 50 L26 32 Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="32" r="3" fill="currentColor" />
    </svg>
  );
}
