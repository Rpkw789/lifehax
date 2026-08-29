import styles from "./PageSkeleton.module.css";

/**
 * Placeholder for the session media inside a livestream tile: a nav row, an
 * image block beside a title / price / swatch / CTA stack, then three lines of
 * copy. The focus ring's six regions are positioned against this layout.
 */
export function PageSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <div className={styles.nav}>
        <div className={styles.logo} />
        <div className={styles.navLinks}>
          <div className={styles.navLink} />
          <div className={styles.navLink} />
          <div className={`${styles.navLink} ${styles.navLinkShort}`} />
        </div>
      </div>

      <div className={styles.hero}>
        <div className={styles.image} />
        <div className={styles.detail}>
          <div className={styles.title} />
          <div className={styles.subtitle} />
          <div className={styles.price} />
          <div className={styles.swatches}>
            <div className={styles.swatch} />
            <div className={styles.swatch} />
            <div className={`${styles.swatch} ${styles.swatchFaint}`} />
          </div>
          <div className={styles.cta} />
        </div>
      </div>

      <div className={styles.copy}>
        <div className={`${styles.line} ${styles.line1}`} />
        <div className={`${styles.line} ${styles.line2}`} />
        <div className={`${styles.line} ${styles.line3}`} />
      </div>
    </div>
  );
}
