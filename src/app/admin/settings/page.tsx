import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { FeedbackSettingsForm } from "@/components/admin/feedback-settings-form";
import { SettingsManager } from "@/components/admin/settings-manager";
import { isFeedbackResubmissionAllowed } from "@/lib/cases/settings";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function AdminSettingsPage() {
  await requireRole(["ADMIN"]);
  const [feedbackResubmissionAllowed, settings] = await Promise.all([
    isFeedbackResubmissionAllowed(db),
    db.appSetting.findMany({ orderBy: { key: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Application-wide behavior controlled by administrators.
        </p>
      </div>

      <Card
        title="Resident feedback"
        description="Controls how residents can rate resolved cases."
      >
        <FeedbackSettingsForm
          feedbackResubmissionAllowed={feedbackResubmissionAllowed}
        />
      </Card>

      <Card
        title="System configuration"
        description="Arbitrary key/value settings. Built-in behavior uses defaults when a key is absent."
      >
        <SettingsManager
          settings={settings.map((setting) => ({
            key: setting.key,
            value: setting.value,
            updatedAt: setting.updatedAt.toISOString(),
          }))}
        />
      </Card>
    </div>
  );
}
