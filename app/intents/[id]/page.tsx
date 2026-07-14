import { IntentWatcher } from "./watcher";

export default async function IntentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IntentWatcher intentId={id} />;
}
