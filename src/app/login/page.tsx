import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoginForm } from "@/components/auth/login-form";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextPath =
    next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const locale = await getLocale();
  const t = copy[locale].login;

  return (
    <Container className="flex justify-center py-12">
      <div className="w-full max-w-md">
        <Card title={t.title} description={t.description}>
          <LoginForm nextPath={nextPath} locale={locale} />
          <Button href="/" variant="ghost" size="sm" className="mt-4 w-full">
            {t.back}
          </Button>
          <p className="mt-4 text-center text-sm text-slate-600">
            <Link
              href="/reset-password"
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              {t.forgot}
            </Link>
          </p>
          <p className="mt-2 text-center text-sm text-slate-600">
            {t.newHere}{" "}
            <Link
              href="/register"
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              {t.createAccount}
            </Link>
          </p>
        </Card>
      </div>
    </Container>
  );
}
