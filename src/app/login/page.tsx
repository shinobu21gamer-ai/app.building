import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoginForm } from "@/components/auth/login-form";

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

  return (
    <Container className="flex justify-center py-12">
      <div className="w-full max-w-md">
        <Card title="Sign in" description="Access your BarangayResolve account.">
          <LoginForm nextPath={nextPath} />
          <Button href="/" variant="ghost" size="sm" className="mt-4 w-full">
            Back to landing page
          </Button>
          <p className="mt-4 text-center text-sm text-slate-600">
            <Link
              href="/reset-password"
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              Forgot your password?
            </Link>
          </p>
          <p className="mt-2 text-center text-sm text-slate-600">
            New to BarangayResolve?{" "}
            <Link
              href="/register"
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              Create an account
            </Link>
          </p>
        </Card>
      </div>
    </Container>
  );
}