import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProfileForm } from "@/components/auth/profile-form";
import { PasswordForm } from "@/components/auth/password-form";
import { LogoutButton } from "@/components/auth/logout-button";
import { NativeServerUrlCard } from "@/components/settings/native-server-url-card";
import { requireUser } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "My profile",
};

export default async function ProfilePage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = copy[locale].profile;

  return (
    <Container className="py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Badge tone="blue" className="mb-2">
            {user.role.name}
          </Badge>
          <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{t.lead}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            href={
              user.role.key === "ADMIN"
                ? "/admin"
                : user.role.key === "OFFICIAL"
                  ? "/official"
                  : "/resident"
            }
            variant="outline"
            size="sm"
          >
            {t.back}
          </Button>
          <LogoutButton size="sm" />
        </div>
      </div>

      <div className="mt-8 grid items-start gap-4 lg:grid-cols-2">
        <Card title={t.details}>
          <ProfileForm
            locale={locale}
            user={{
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              phone: user.phone,
              address: user.address,
            }}
          />
        </Card>
        <Card title={t.password}>
          <PasswordForm locale={locale} />
        </Card>
      </div>

      <div className="mt-4">
        <NativeServerUrlCard />
      </div>
    </Container>
  );
}