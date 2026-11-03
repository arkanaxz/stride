import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getBundle } from "@/lib/database";
import RunHistoryPage from "@/components/run-history-page";

export const dynamic = "force-dynamic";

export default async function HistoryRoute() {
  const user = await currentUser();
  if (!user) redirect("/login?next=%2Fhistory");
  const { runs } = await getBundle();
  return <RunHistoryPage runs={runs} />;
}
