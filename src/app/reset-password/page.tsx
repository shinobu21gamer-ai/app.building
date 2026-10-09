import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Reset password",
};

export default async function ResetPasswordPage() {
  const locale = await getLocale();
  const t = copy[locale].reset;

  return (
    <Container className="flex justify-center py-12">
      <div className="w-full max-w-md">
        <Card title={t.title} description={t.description}>
          <ResetPasswordForm locale={locale} />
          <p className="mt-4 text-center text-sm text-slate-600">
            {t.remembered}{" "}
            <Link
              href="/login"
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              {t.back}
            </Link>
          </p>
        </Card>
      </div>
    </Container>
  );
}
