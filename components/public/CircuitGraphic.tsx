export function CircuitGraphic({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 360"
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id="cg-line" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" stopOpacity="0.9" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      {/* core */}
      <rect x="196" y="90" width="88" height="180" rx="6" stroke="url(#cg-line)" strokeWidth="2" />
      <rect x="210" y="104" width="60" height="152" rx="4" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="1.5" />

      {/* primary winding coils (left) */}
      {Array.from({ length: 9 }).map((_, i) => (
        <path
          key={`p${i}`}
          d={`M150 ${110 + i * 17} q-26 8.5 0 17`}
          stroke="#ffffff"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
      {/* secondary winding coils (right) */}
      {Array.from({ length: 9 }).map((_, i) => (
        <path
          key={`s${i}`}
          d={`M330 ${110 + i * 17} q26 8.5 0 17`}
          stroke="#3b82f6"
          strokeOpacity="0.8"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}

      {/* feed lines */}
      <path d="M40 140 H150 M40 240 H150" stroke="url(#cg-line)" strokeWidth="2" />
      <path d="M330 140 H440 M330 240 H440" stroke="url(#cg-line)" strokeWidth="2" />
      <circle cx="40" cy="140" r="4" fill="#3b82f6" />
      <circle cx="40" cy="240" r="4" fill="#3b82f6" />
      <circle cx="440" cy="140" r="4" fill="#3b82f6" />
      <circle cx="440" cy="240" r="4" fill="#3b82f6" />

      {/* nodes / bushings */}
      <path d="M240 90 V60 M240 270 V300" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="2" />
      <circle cx="240" cy="54" r="5" stroke="#3b82f6" strokeWidth="2" />
      <circle cx="240" cy="306" r="5" stroke="#3b82f6" strokeWidth="2" />
    </svg>
  );
}
