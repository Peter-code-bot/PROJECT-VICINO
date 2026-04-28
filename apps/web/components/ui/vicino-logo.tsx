interface VicinoLogoProps {
  size?: number;
  className?: string;
}

export function VicinoLogo({ size = 40, className }: VicinoLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="VICINO"
    >
      {/* Squircle background — bone/cream with margin around V */}
      <rect width="100" height="100" rx="22" fill="#F5F0E8" />
      {/* Left arm — red */}
      <polygon points="26,14 43,14 51,78 33,78" fill="#FF3B30" />
      {/* Right arm — black */}
      <polygon points="54,14 73,14 67,78 47,78" fill="#1A1A1A" />
    </svg>
  );
}
