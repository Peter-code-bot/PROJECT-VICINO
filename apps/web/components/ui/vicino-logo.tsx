interface VicinoLogoProps {
  size?: number;
  className?: string;
}

export function VicinoLogo({ size = 40, className }: VicinoLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 90"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="VICINO"
    >
      <polygon points="4,0 30,0 52,85 26,85" fill="#FF3B30" />
      <polygon points="70,0 96,0 74,85 48,85" fill="#1A1A1A" />
    </svg>
  );
}
