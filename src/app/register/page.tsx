import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { RegisterForm } from "@/components/auth/register-form";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Create an account",
};

export default async function RegisterPage() {
  const locale = await getLocale();
  const t = copy[locale].register;

  return (
    <Container className="flex justify-center py-12">
      <div className="w-full max-w-lg">
        <Card title={t.title} description={t.description}>
          <RegisterForm locale={locale} />
          <p className="mt-4 text-center text-sm text-slate-600">
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
