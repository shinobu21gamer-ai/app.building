"use client";

import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container className="py-16 text-center">
      <p className="text-sm font-semibold text-brand-600">Something went wrong</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">
        We couldn&apos;t load this page
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
        An unexpected error occurred. You can try again, or go back to the home
        page.
        {error.digest ? <> Reference: {error.digest}</> : null}
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
        <Button href="/">Back to home</Button>
      </div>
    </Container>
  );
}