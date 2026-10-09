import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { FeedbackSettingsForm } from "@/components/admin/feedback-settings-form";
import { AreasSettingsForm } from "@/components/admin/areas-settings-form";
import { SettingsManager } from "@/components/admin/settings-manager";
import {
  BARANGAY_AREAS_KEY,
  DEFAULT_BARANGAY_AREAS,
  isFeedbackResubmissionAllowed,
} from "@/lib/cases/settings";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function AdminSettingsPage() {
  await requireRole(["ADMIN"]);
  const locale = await getLocale();
  const t = copy[locale].admin;
  const [feedbackResubmissionAllowed, settings] = await Promise.all([
    isFeedbackResubmissionAllowed(db),
    db.appSetting.findMany({ orderBy: { key: "asc" } }),
  ]);
  const areasSetting = settings.find((row) => row.key === BARANGAY_AREAS_KEY);
  const areasValue = areasSetting?.value ?? DEFAULT_BARANGAY_AREAS.join("\n");
  const otherSettings = settings.filter((row) => row.key !== BARANGAY_AREAS_KEY);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.settingsTitle}</h1>
        <p className="mt-1 text-sm text-slate-600">{t.settingsLead}</p>
      </div>

      <Card title={t.feedbackTitle} description={t.feedbackDesc}>
        <FeedbackSettingsForm
          locale={locale}
          feedbackResubmissionAllowed={feedbackResubmissionAllowed}
        />
      </Card>

      <Card title={t.areasTitle} description={t.areasDesc}>
        <AreasSettingsForm locale={locale} initialValue={areasValue} />
      </Card>

      <Card title={t.systemTitle} description={t.systemDesc}>
        <SettingsManager
          locale={locale}
          settings={otherSettings.map((setting) => ({
            key: setting.key,
            value: setting.value,
            updatedAt: setting.updatedAt.toISOString(),
          }))}
        />
      </Card>
    </div>
  );
}
