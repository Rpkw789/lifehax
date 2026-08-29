import { Sidebar } from "./Sidebar";
import styles from "./AppFrame.module.css";

/**
 * The outer chrome every signed-in screen sits in: the sidebar, and a column
 * beside it that scrolls on its own.
 *
 * Deliberately ignorant of runs. The run shell adds the header and stepper on
 * top of this; the settings screen does not, because those are run chrome and
 * settings are not part of a run.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.frame}>
      <Sidebar />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
