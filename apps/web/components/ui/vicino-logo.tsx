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
      {/* Squircle background — bone/cream */}
      <rect width="100" height="100" rx="22" fill="#F5F0E8" />
      {/* Left arm — red, thick */}
      <polygon points="8,12 37,12 52,85 24,85" fill="#FF3B30" />
      {/* Right arm — black, thick */}
      <polygon points="63,12 92,12 76,85 50,85" fill="#1A1A1A" />
    </svg>
  );
}
