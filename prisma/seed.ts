import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ------------------------------------------------------------------
// Development / test seed data only.
// Contains no real residents or sensitive personal information.
// ------------------------------------------------------------------

async function main() {
  const resetDemoPasswords = process.env.RESET_DEMO_PASSWORDS === "true";
  if (resetDemoPasswords && process.env.NODE_ENV === "production") {
    throw new Error(
      "RESET_DEMO_PASSWORDS is for development/testing only and cannot be used in production."
    );
  }

  console.log("Seeding BarangayResolve database...");
  if (resetDemoPasswords) {
    console.warn(
      "RESET_DEMO_PASSWORDS=true: existing seeded demo-account passwords will be reset; inactive accounts will remain inactive."
    );
  }

  // ---- Roles -----------------------------------------------------
  const [resident, official, admin, treasurer, captain, crew] =
    await Promise.all([
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
    prisma.role.upsert({
      where: { key: "TREASURER" },
      update: {},
      create: {
        key: "TREASURER",
        name: "Barangay Treasurer",
        description:
          "Manages COA-coded budgets, earmarks, disbursements and approvals.",
      },
    }),
    prisma.role.upsert({
      where: { key: "CAPTAIN" },
      update: {},
      create: {
        key: "CAPTAIN",
        name: "Barangay Captain",
        description:
          "Approving official: budget approvals, escalations and overrides.",
      },
    }),
    prisma.role.upsert({
      where: { key: "CREW" },
      update: {},
      create: {
        key: "CREW",
        name: "Maintenance Crew",
        description:
          "Field worker assigned to cases; sees only their own assignments.",
      },
    }),
  ]);
  console.log(
    "  roles: RESIDENT, OFFICIAL, ADMIN, TREASURER, CAPTAIN, CREW"
  );

  // ---- Offices ----------------------------------------------------
  const officeData = [
    {
      code: "INFRA",
      name: "Committee on Infrastructure",
      description: "Roads, drainage, streetlights, and public works.",
      headOfficer: "Councilor R. Dela Cruz",
      contact: "0917-000-0001",
    },
    {
      code: "ENV",
      name: "Committee on Environment & Sanitation",
      description: "Waste management, cleanliness, and sanitation.",
      headOfficer: "Councilor M. Reyes",
      contact: "0917-000-0002",
    },
    {
      code: "PEACE",
      name: "Committee on Peace and Order",
      description: "Community safety, noise, and dispute concerns.",
      headOfficer: "Councilor A. Santos",
      contact: "0917-000-0003",
    },
    {
      code: "SECRETARY",
      name: "Office of the Barangay Secretary",
      description: "Documents, certificates, and records requests.",
      headOfficer: "Sec. L. Villanueva",
      contact: "0917-000-0004",
    },
    {
      code: "HEALTH",
      name: "Committee on Health",
      description: "Health and medical-related community concerns.",
      headOfficer: "Councilor J. Garcia",
      contact: "0917-000-0005",
    },
    // Revamp workflow destinations: Ayuda -> Social Services, Repair ->
    // Maintenance/Engineering, Documents -> Secretary (above), Budget ->
    // Treasurer / Authorized Approving Official.
    {
      code: "SOCIAL_SERVICES",
      name: "Social Services / Assistance Committee",
      description: "Financial and in-kind assistance to residents.",
      headOfficer: "Councilor E. Bautista",
      contact: "0917-000-0006",
    },
    {
      code: "ENGINEERING",
      name: "Maintenance Team / Engineering Office",
      description: "Repairs, public works, and maintenance crews.",
      headOfficer: "Engr. F. Aquino",
      contact: "0917-000-0007",
    },
    {
      code: "TREASURY",
      name: "Office of the Barangay Treasurer",
      description: "Budgets, disbursements, and financial reporting.",
      headOfficer: "Treas. G. Mercado",
      contact: "0917-000-0008",
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

  // ---- Concern types ----------------------------------------------
  // The four service types and the office each one belongs to. Every case
  // passes through AWAITING_BUDGET; REPAIR cases additionally need a crew.
  const typeData = [
    {
      key: "AYUDA",
      name: "Assistance (Ayuda)",
      description: "Financial or in-kind assistance to a resident.",
      office: "SOCIAL_SERVICES",
      requiresBudget: true,
      requiresCrew: false,
      displayOrder: 1,
    },
    {
      key: "REPAIR",
      name: "Repair / Public Works",
      description: "Repairs and maintenance of public facilities.",
      office: "ENGINEERING",
      requiresBudget: true,
      requiresCrew: true,
      displayOrder: 2,
    },
    {
      key: "DOCUMENTS",
      name: "Documents and Records",
      description: "Barangay documents, certificates, and records.",
      office: "SECRETARY",
      requiresBudget: true,
      requiresCrew: false,
      displayOrder: 3,
    },
    {
      key: "BUDGET",
      name: "Budget / Fund Release",
      description: "Funded programs and budget releases.",
      office: "TREASURY",
      requiresBudget: true,
      requiresCrew: false,
      displayOrder: 4,
    },
  ];

  const types = new Map<string, { id: number; key: string }>();
  for (const t of typeData) {
    const defaultOfficeId = offices.get(t.office)!.id;
    const concernType = await prisma.concernType.upsert({
      where: { key: t.key },
      // Re-running the seed corrects the destination office and the money flag
      // of existing types.
      update: { defaultOfficeId, requiresBudget: t.requiresBudget },
      create: {
        key: t.key,
        name: t.name,
        description: t.description,
        defaultOfficeId,
        requiresBudget: t.requiresBudget,
        requiresCrew: t.requiresCrew,
        slaHours: 48,
        displayOrder: t.displayOrder,
      },
    });
    types.set(t.key, concernType);
  }
  console.log(`  concern types: ${typeData.length}`);

  // Which service type each descriptive category rolls up to. NOISE and OTHER
  // stay untyped (null) on purpose: the admin cleanup queue is where an
  // untyped concern gets categorized before it can be routed.
  const categoryType: Record<string, string | null> = {
    ROAD: "REPAIR",
    DRAINAGE: "REPAIR",
    STREETLIGHT: "REPAIR",
    WASTE: "REPAIR",
    NOISE: null,
    DOC_REQUEST: "DOCUMENTS",
    HEALTH: "AYUDA",
    OTHER: null,
  };

  const categories = new Map<string, { id: number }>();
  for (const c of categoryData) {
    const typeKey = categoryType[c.code] ?? null;
    const typeId = typeKey ? types.get(typeKey)!.id : null;
    const category = await prisma.concernCategory.upsert({
      where: { code: c.code },
      update: { typeId },
      create: { ...c, typeId },
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
  // Preserve existing credentials by default. The one-time recovery flag is
  // explicit because these upserts may target an existing database.
  const demoUserUpdate = resetDemoPasswords
    ? { passwordHash, tokenVersion: { increment: 1 } }
    : {};

  // Default administrator
  await prisma.user.upsert({
    where: { email: "admin@barangayresolve.dev" },
    update: demoUserUpdate,
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
      update: demoUserUpdate,
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
      update: demoUserUpdate,
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
  const sampleResident = await prisma.user.upsert({
    where: { email: "resident@barangayresolve.dev" },
    update: demoUserUpdate,
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
  // The consent signup would have recorded. Submitting a concern needs DATA_PROCESSING.
  for (const purpose of ["DATA_PROCESSING", "PRIVACY_NOTICE"]) {
    const existing = await prisma.consentRecord.findFirst({
      where: { userId: sampleResident.id, purpose },
    });
    if (!existing) {
      await prisma.consentRecord.create({
        data: {
          userId: sampleResident.id,
          purpose,
          status: "GRANTED",
          policyVersion: "2026-10-12",
          method: "WEB",
        },
      });
    }
  }

  // Demo staff for the revamp roles: a treasurer, the captain as approving
  // official, and two maintenance crew members with crew profiles.
  const treasurerUser = await prisma.user.upsert({
    where: { email: "treasurer@barangayresolve.dev" },
    update: demoUserUpdate,
    create: {
      email: "treasurer@barangayresolve.dev",
      passwordHash,
      firstName: "Gloria",
      lastName: "Mercado",
      position: "Barangay Treasurer",
      roleId: treasurer.id,
      officeId: offices.get("TREASURY")!.id,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: "captain@barangayresolve.dev" },
    update: demoUserUpdate,
    create: {
      email: "captain@barangayresolve.dev",
      passwordHash,
      firstName: "Ramon",
      lastName: "Villanueva",
      position: "Barangay Captain",
      roleId: captain.id,
      isActive: true,
    },
  });

  const crewSeed = [
    {
      email: "crew1@barangayresolve.dev",
      firstName: "Danilo",
      lastName: "Soriano",
      trade: "MASONRY",
      employmentType: "JOB_ORDER",
      dailyRate: 610,
    },
    {
      email: "crew2@barangayresolve.dev",
      firstName: "Ernesto",
      lastName: "Padilla",
      trade: "PLUMBING",
      employmentType: "CASUAL",
      dailyRate: 590,
    },
  ];

  const engineeringOfficeId = offices.get("ENGINEERING")!.id;
  for (const c of crewSeed) {
    const crewUser = await prisma.user.upsert({
      where: { email: c.email },
      update: demoUserUpdate,
      create: {
        email: c.email,
        passwordHash,
        firstName: c.firstName,
        lastName: c.lastName,
        position: "Maintenance Crew",
        roleId: crew.id,
        officeId: engineeringOfficeId,
        isActive: true,
      },
    });
    await prisma.crewProfile.upsert({
      where: { userId: crewUser.id },
      update: {},
      create: {
        userId: crewUser.id,
        trade: c.trade,
        employmentType: c.employmentType,
        dailyRate: c.dailyRate,
        availability: "AVAILABLE",
        // Two so a repair case can demonstrate a 2-of-3 crew assignment.
        maxConcurrentCases: 2,
        officeId: engineeringOfficeId,
        isActive: true,
      },
    });
  }
  console.log(`  demo treasurer: ${treasurerUser.email}`);

  // ---- App settings ---------------------------------------------
  await prisma.appSetting.upsert({
    where: { key: "feedback.resubmission_allowed" },
    update: {},
    create: {
      key: "feedback.resubmission_allowed",
      value: "false",
    },
  });

  // Identity gate. The code treats a missing row as "on", so the seed writes
  // it explicitly to make the current policy visible in the admin desk.
  await prisma.appSetting.upsert({
    where: { key: "resident.identity_verification_required" },
    update: {},
    create: {
      key: "resident.identity_verification_required",
      value: "true",
    },
  });

  console.log(
    `  demo users: 1 admin, ${offices.size + extraOfficials.length} officials, 1 resident, 1 treasurer, 1 captain, 2 crew`
  );
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