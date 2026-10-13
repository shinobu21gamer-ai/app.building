import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { RegisterForm } from "@/components/auth/register-form";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { piiKeyStatus } from "@/lib/privacy/crypto";

export const metadata: Metadata = {
  title: "Create an account",
};

export default async function RegisterPage() {
  const locale = await getLocale();
  const t = copy[locale].register;
  // A registration that includes a phone number is refused when the server has
  // no encryption key; saying so up front beats a failed signup. The technical
  // reason is logged at build time and shown on the admin verification desk.
  const keyStatus = piiKeyStatus();

  return (
    <Container className="flex justify-center py-12">
      <div className="w-full max-w-lg">
        <Card title={t.title} description={t.description}>
          {!keyStatus.ready && (
            <p className="mb-4 rounded-control border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-700">
              {t.phoneUnavailable}
            </p>
          )}
          <RegisterForm locale={locale} />
          <p className="mt-4 text-center text-sm text-ink-muted">
            {t.haveAccount}{" "}
            <Link
              href="/login"
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              {t.signIn}
            </Link>
          </p>
        </Card>
      </div>
    </Container>
  );
}
