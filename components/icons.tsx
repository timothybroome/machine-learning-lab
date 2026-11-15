import { CLASS_NAMES } from "@/lib/shapes";

/** Little outline pictures of each shape class. */
export function ShapeIcon({ cls, size = 22 }: { cls: number; size?: number }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.4,
    strokeLinejoin: "round" as const,
    strokeLinecap: "round" as const,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={CLASS_NAMES[cls]}>
      {cls === 0 && <path d="M12 3.5 21 20H3z" {...common} />}
      {cls === 1 && <rect x="4" y="4" width="16" height="16" rx="1" {...common} />}
      {cls === 2 && <circle cx="12" cy="12" r="8.5" {...common} />}
      {cls === 3 && <path d="M4 19 20 5" {...common} />}
    </svg>
  );
}
