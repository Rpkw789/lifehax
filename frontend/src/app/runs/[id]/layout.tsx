import { RunProvider } from "@/lib/run-context";
import { Shell } from "./Shell";

export default async function RunLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <RunProvider runId={id}>
      <Shell>{children}</Shell>
    </RunProvider>
  );
}
