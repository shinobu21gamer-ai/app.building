"use client";

import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="antialiased flex min-h-screen items-center justify-center bg-white text-slate-900">
        <Container className="py-16 text-center">
          <p className="text-sm font-semibold text-brand-600">Something went wrong</p>
          <h1 className="mt-2 text-2xl font-bold">System error</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            An unexpected error occurred while rendering this page.
            {error.digest ? ` Reference: ${error.digest}` : ""}
          </p>
          <Button className="mt-6" onClick={reset}>
            Try again
          </Button>
        </Container>
      </body>
    </html>
  );
}