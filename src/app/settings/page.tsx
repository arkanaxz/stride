import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import Dashboard from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=%2Fsettings");
  if (user.role !== "admin") redirect("/");
  return <Dashboard initialPage="settings" />;
}
