import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAuthUser, roleHome } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Home",
};

const features = [
  {
    title: "Submit & Track",
    description:
      "Residents file community concerns online and get a unique case number they can track from submission to resolution.",
  },
  {
    title: "Smart Prioritization",
    description:
      "Every concern is scored with a transparent, configurable rule-based priority (urgency, impact, affected population, safety).",
  },
  {
    title: "Automatic Routing",
    description:
      "Concerns are routed to the right barangay office using configurable routing rules maintained by administrators.",
  },
  {
    title: "Transparent Processing",
    description:
      "Every status change, progress remark, and resolution is recorded in an auditable case history.",
  },
];

const workflow = [
  "Submit",
  "Prioritize",
  "Route",
  "Process",
  "Resolve",
  "Track",
];

export default async function Home() {
  const user = await getAuthUser();

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-50 to-white">
        <Container className="py-16 sm:py-24">
          <div className="max-w-3xl">
            <Badge tone="blue" className="mb-4">
              Barangay Community Platform
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              BarangayResolve
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              A web-based smart community concern prioritization, routing, and
              resolution management system. Residents submit concerns, the
              system prioritizes and routes them to the right barangay office,
              and officials process them — all in one transparent workflow.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {user ? (
                <Button href={roleHome(user.role.key)}>Go to your dashboard</Button>
              ) : (
                <>
                  <Button href="/register">Create an account</Button>
                  <Button href="/login" variant="outline">
                    Sign in
                  </Button>
                </>
              )}
            </div>
          </div>
        </Container>
      </section>

      {/* Workflow */}
      <section>
        <Container className="py-12 sm:py-16">
          <h2 className="text-2xl font-semibold text-slate-900">
            How it works
          </h2>
          <ol className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {workflow.map((step, index) => (
              <li
                key={step}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <span className="text-sm font-bold text-brand-600">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="mt-1 font-semibold text-slate-900">{step}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Features */}
      <section className="border-t border-slate-200 bg-slate-50">
        <Container className="py-12 sm:py-16">
          <h2 className="text-2xl font-semibold text-slate-900">
            What the system provides
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {features.map((feature) => (
              <Card key={feature.title} title={feature.title}>
                <p className="text-sm leading-relaxed text-slate-600">
                  {feature.description}
                </p>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      {/* Roles */}
      <section>
        <Container className="py-12 sm:py-16">
          <h2 className="text-2xl font-semibold text-slate-900">
            Built for every part of the barangay
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "Residents",
                body: "Submit concerns, track case status, view resolution details, and give feedback.",
              },
              {
                title: "Barangay Officials",
                body: "Process assigned concerns, update status, record resolutions, and reassign when needed.",
              },
              {
                title: "Administrators",
                body: "Manage users, offices, categories, routing rules, priorities, and view analytics.",
              },
            ].map((role) => (
              <Card key={role.title} title={role.title}>
                <p className="text-sm leading-relaxed text-slate-600">
                  {role.body}
                </p>
              </Card>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}