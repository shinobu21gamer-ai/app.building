import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Reset password",
};

export default function ResetPasswordPage() {
  return (
    <Container className="flex justify-center py-12">
      <div className="w-full max-w-md">
        <Card
          title="Reset your password"
          description="Use the one-time code provided by your administrator."
        >
          <ResetPasswordForm />
          <p className="mt-4 text-center text-sm text-slate-600">
            Remembered it?{" "}
            <Link
              href="/login"
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              Back to sign in
            </Link>
          </p>
        </Card>
      </div>
    </Container>
  );
}