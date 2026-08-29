import styles from "./Button.module.css";

type Variant = "primary" | "outline" | "outlineSoft";
type Size = "lg" | "md";

/**
 * The three button treatments in the product: a dark primary, and two outline
 * weights that differ only in border and text color. No shadows, ever.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: {
  variant?: Variant;
  size?: Size;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={[styles.button, styles[size], styles[variant], className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
