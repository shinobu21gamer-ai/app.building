import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Create an account",
};

export default async function RegisterPage() {
  return (
    <Container className="flex justify-center py-12">
      <div className="w-full max-w-lg">
        <Card
          title="Create a resident account"
          description="Register to submit and track community concerns."
        >
          <RegisterForm />
          <p className="mt-4 text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </Container>
  );
}