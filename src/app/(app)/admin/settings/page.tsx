import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { AppearanceSettings } from "@/components/appearance-controls";

export const metadata = { title: "Appearance" };

export default async function AppearancePage() {
  await requirePermission("admin.settings.appearance");
  return (
    <>
      <PageHeader
        title="Appearance"
        description="Theme, typeface and density. Personal to you and this browser."
      />
      <AppearanceSettings />
    </>
  );
}
