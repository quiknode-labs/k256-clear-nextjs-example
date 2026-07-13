import { IntentWatcher } from "./watcher";

export default async function IntentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ gate?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const gate = query.gate === "confirmed" ? "confirmed" : "finalized";
  return <IntentWatcher intentId={id} gate={gate} />;
}
