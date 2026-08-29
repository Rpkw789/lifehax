import styles from "./SectionLabel.module.css";

/**
 * The mono uppercase rule that introduces each band of a screen. Margins are
 * the caller's business — they differ per screen.
 */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `${styles.label} ${className}` : styles.label}>
      {children}
    </div>
  );
}
