// Tailwind is loaded here, not in the root layout, so it reaches the vendored
// Tremor chart on this route and nothing else. See src/app/tremor.css.
import "@/app/tremor.css";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
