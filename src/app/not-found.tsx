import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Container className="py-16 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Page not found</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
        The page you are looking for does not exist or may have moved.
      </p>
      <Button className="mt-6" href="/">
        Back to home
      </Button>
    </Container>
  );
}