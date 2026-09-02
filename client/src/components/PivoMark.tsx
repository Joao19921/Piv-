/** Simbolo Pivo: seta ascendente (crescimento) com um ponto de pivo, gradiente teal -> laranja. */
export function PivoMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id="pivoMarkGradient" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#0D5C5C" />
          <stop offset="55%" stopColor="#008080" />
          <stop offset="100%" stopColor="#F57F17" />
        </linearGradient>
      </defs>
      <path
        d="M8 33 L25 13 M16 13 H26 V23"
        stroke="url(#pivoMarkGradient)"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="16.5" cy="23" r="3" fill="#F57F17" stroke="#FFFFFF" strokeWidth="1.4" />
    </svg>
  );
}
