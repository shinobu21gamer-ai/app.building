import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProfileForm } from "@/components/auth/profile-form";
import { PasswordForm } from "@/components/auth/password-form";
import { LogoutButton } from "@/components/auth/logout-button";
import { NativeServerUrlCard } from "@/components/settings/native-server-url-card";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title={t.title}
        description={t.lead}
        actions={
          <>
            <Badge tone="blue">{user.role.name}</Badge>
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
          </>
        }
      />

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