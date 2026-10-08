import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ------------------------------------------------------------------
// Development / test seed data only.
// Contains no real residents or sensitive personal information.
// ------------------------------------------------------------------

async function main() {
  console.log("Seeding BarangayResolve database...");

  // ---- Roles -----------------------------------------------------
  const [resident, official, admin] = await Promise.all([
    prisma.role.upsert({
      where: { key: "RESIDENT" },
      update: {},
      create: {
        key: "RESIDENT",
        name: "Resident",
        description: "Community member who submits and tracks concerns.",
      },
    }),
    prisma.role.upsert({
      where: { key: "OFFICIAL" },
      update: {},
      create: {
        key: "OFFICIAL",
        name: "Barangay Official",
        description: "Barangay staff who processes assigned concerns.",
      },
    }),
    prisma.role.upsert({
      where: { key: "ADMIN" },
      update: {},
      create: {
        key: "ADMIN",
        name: "Administrator",
        description: "System administrator with full configuration access.",
      },
    }),
  ]);
  console.log("  roles: RESIDENT, OFFICIAL, ADMIN");

  // ---- Offices ----------------------------------------------------
  const officeData = [
    {
      code: "INFRA",
      name: "Committee on Infrastructure",
      description: "Roads, drainage, streetlights, and public works.",
      headOfficer: "Councilor R. Dela Cruz",
      contact: "0917-000-0001",
      location: "Barangay Hall, Barangay Sample, Philippines",
    },
    {
      code: "ENV",
      name: "Committee on Environment & Sanitation",
      description: "Waste management, cleanliness, and sanitation.",
      headOfficer: "Councilor M. Reyes",
      contact: "0917-000-0002",
      location: "Barangay Hall, Barangay Sample, Philippines",
    },
    {
      code: "PEACE",
      name: "Committee on Peace and Order",
      description: "Community safety, noise, and dispute concerns.",
      headOfficer: "Councilor A. Santos",
      contact: "0917-000-0003",
      location: "Barangay Hall, Barangay Sample, Philippines",
    },
    {
      code: "SECRETARY",
      name: "Office of the Barangay Secretary",
      description: "Documents, certificates, and records requests.",
      headOfficer: "Sec. L. Villanueva",
      contact: "0917-000-0004",
      location: "Barangay Hall, Barangay Sample, Philippines",
    },
    {
      code: "HEALTH",
      name: "Committee on Health",
      description: "Health and medical-related community concerns.",
      headOfficer: "Councilor J. Garcia",
      contact: "0917-000-0005",
      location: "Barangay Hall, Barangay Sample, Philippines",
    },
  ];

  const offices = new Map<string, { id: number; name: string; code: string }>();
  for (const o of officeData) {
    const office = await prisma.office.upsert({
      where: { code: o.code },
      update: {},
      create: o,
    });
    offices.set(o.code, office);
  }
  console.log(`  offices: ${officeData.length}`);

  // ---- Concern categories -----------------------------------------
  const categoryData = [
    { code: "ROAD", name: "Road Damage", description: "Potholes, damaged roads, and right-of-way issues." },
    { code: "DRAINAGE", name: "Drainage / Flooding", description: "Clogged canals, flooding, and drainage problems." },
    { code: "STREETLIGHT", name: "Streetlight Outage", description: "Non-functional streetlights and dark areas." },
    { code: "WASTE", name: "Waste and Sanitation", description: "Garbage collection, illegal dumping, and cleanliness." },
    { code: "NOISE", name: "Community Noise", description: "Excessive noise and public disturbances." },
    { code: "DOC_REQUEST", name: "Barangay Document Request", description: "Certificates and other barangay documents." },
    { code: "HEALTH", name: "Health Concern", description: "Health-related community concerns." },
    { code: "OTHER", name: "Other Concern", description: "Concerns that do not fit existing categories." },
  ];

  const categories = new Map<string, { id: number }>();
  for (const c of categoryData) {
    const category = await prisma.concernCategory.upsert({
      where: { code: c.code },
      update: {},
      create: c,
    });
    categories.set(c.code, category);
  }
  console.log(`  categories: ${categoryData.length}`);

  // ---- Routing rules ----------------------------------------------
  const routingData = [
    { category: "ROAD", office: "INFRA" },
    { category: "DRAINAGE", office: "INFRA" },
    { category: "STREETLIGHT", office: "INFRA" },
    { category: "WASTE", office: "ENV" },
    { category: "NOISE", office: "PEACE" },
    { category: "DOC_REQUEST", office: "SECRETARY" },
    { category: "HEALTH", office: "HEALTH" },
    { category: "OTHER", office: "SECRETARY" },
  ];

  for (const r of routingData) {
    const categoryId = categories.get(r.category)!.id;
    const officeId = offices.get(r.office)!.id;
    await prisma.routingRule.upsert({
      where: { categoryId_officeId: { categoryId, officeId } },
      update: {},
      create: { categoryId, officeId, priorityOrder: 1, isActive: true },
    });
  }
  console.log(`  routing rules: ${routingData.length}`);

  // ---- Priority configuration -------------------------------------
  // Factor scores are 1-5 each, so total ranges 4-20.
  const levelData = [
    { level: "LOW", minScore: 4, maxScore: 8, label: "Low Priority" },
    { level: "MEDIUM", minScore: 9, maxScore: 12, label: "Medium Priority" },
    { level: "HIGH", minScore: 13, maxScore: 16, label: "High Priority" },
    { level: "CRITICAL", minScore: 17, maxScore: 20, label: "Critical Priority" },
  ];

  for (const l of levelData) {
    await prisma.priorityConfig.upsert({
      where: { level: l.level },
      update: {},
      create: l,
    });
  }
  console.log("  priority config: LOW, MEDIUM, HIGH, CRITICAL");

  // ---- Priority factor configuration ------------------------------
  // Rule-based engine inputs. Each raw score is multiplied by its weight;
  // with the default weights of 1 the total ranges 4-20.
  const factorData = [
    {
      key: "URGENCY",
      label: "Urgency",
      description: "How quickly does this concern need attention?",
      displayOrder: 1,
    },
    {
      key: "IMPACT",
      label: "Community impact",
      description: "How much does it disrupt the community?",
      displayOrder: 2,
    },
    {
      key: "AFFECTED_POPULATION",
      label: "Number of people affected",
      description: "How many residents are affected?",
      displayOrder: 3,
    },
    {
      key: "SAFETY",
      label: "Safety implication",
      description: "How severe is the risk to health or safety?",
      displayOrder: 4,
    },
  ];

  for (const f of factorData) {
    await prisma.priorityFactorConfig.upsert({
      where: { key: f.key },
      update: {},
      create: { ...f, weight: 1, minScore: 1, maxScore: 5, isActive: true },
    });
  }
  console.log("  priority factors: URGENCY, IMPACT, AFFECTED_POPULATION, SAFETY");

  // ---- Demo users (development/testing only) ----------------------
  const passwordHash = await bcrypt.hash("BarangayResolve123!", 12);

  // Default administrator
  await prisma.user.upsert({
    where: { email: "admin@barangayresolve.dev" },
    update: {},
    create: {
      email: "admin@barangayresolve.dev",
      passwordHash,
      firstName: "System",
      lastName: "Administrator",
      roleId: admin.id,
      isActive: true,
    },
  });

  // One official per office
  for (const [code, office] of offices) {
    await prisma.user.upsert({
      where: { email: `official.${code.toLowerCase()}@barangayresolve.dev` },
      update: {},
      create: {
        email: `official.${code.toLowerCase()}@barangayresolve.dev`,
        passwordHash,
        firstName: "Officer",
        lastName: office.name,
        roleId: official.id,
        officeId: office.id,
        isActive: true,
      },
    });
  }

  // Additional officials so an office can have more than one member
  // (used to verify office-wide assignment notifications).
  const extraOfficials = [
    {
      email: "official.infra2@barangayresolve.dev",
      firstName: "Officer",
      lastName: "Infrastructure II",
      code: "INFRA",
    },
    {
      email: "official.env2@barangayresolve.dev",
      firstName: "Officer",
      lastName: "Environment II",
      code: "ENV",
    },
  ];
  for (const e of extraOfficials) {
    const office = offices.get(e.code)!;
    await prisma.user.upsert({
      where: { email: e.email },
      update: {},
      create: {
        email: e.email,
        passwordHash,
        firstName: e.firstName,
        lastName: e.lastName,
        roleId: official.id,
        officeId: office.id,
        isActive: true,
      },
    });
  }

  // Sample resident
  await prisma.user.upsert({
    where: { email: "resident@barangayresolve.dev" },
    update: {},
    create: {
      email: "resident@barangayresolve.dev",
      passwordHash,
      firstName: "Juan",
      lastName: "Dela Cruz",
      phone: "0917-123-4567",
      address: "Purok 3, Barangay Sample, Philippines",
      roleId: resident.id,
      isActive: true,
    },
  });

  // ---- App settings ---------------------------------------------
  await prisma.appSetting.upsert({
    where: { key: "feedback.resubmission_allowed" },
    update: {},
    create: {
      key: "feedback.resubmission_allowed",
      value: "false",
    },
  });

  console.log("  demo users: 1 admin, 7 officials, 1 resident");
  console.log("Seeding complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });