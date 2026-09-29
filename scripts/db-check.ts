import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const roles = await prisma.role.findMany({
    include: { _count: { select: { users: true } } },
  });
  const offices = await prisma.office.findMany();
  const categories = await prisma.concernCategory.findMany();
  const routing = await prisma.routingRule.findMany({
    include: { category: true, office: true },
    orderBy: [{ categoryId: "asc" }, { priorityOrder: "asc" }],
  });
  const assignmentCount = await prisma.caseAssignment.count();
  const priorityConfig = await prisma.priorityConfig.findMany();
  const priorityFactors = await prisma.priorityFactorConfig.findMany({
    orderBy: { displayOrder: "asc" },
  });
  const appSettings = await prisma.appSetting.findMany();
  const feedbackCount = await prisma.feedback.count();
  const users = await prisma.user.findMany({
    select: {
      email: true,
      role: { select: { key: true } },
      office: { select: { code: true } },
    },
  });

  console.log(
    JSON.stringify(
      {
        roles: roles.map((r) => ({ key: r.key, users: r._count.users })),
        offices: offices.map((o) => o.code),
        categories: categories.map((c) => c.code),
        routing: routing.map(
          (r) =>
            `${r.category.code} -> ${r.office.code} (order ${r.priorityOrder}${
              r.isActive ? "" : ", disabled"
            })`
        ),
        assignments: assignmentCount,
        priorityConfig: priorityConfig.map(
          (p) => `${p.level}:${p.minScore}-${p.maxScore}`
        ),
        priorityFactors: priorityFactors.map(
          (f) => `${f.key}(w${f.weight}):${f.minScore}-${f.maxScore}`
        ),
        appSettings: appSettings.map((s) => `${s.key}=${s.value}`),
        feedbackCount,
        users,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });