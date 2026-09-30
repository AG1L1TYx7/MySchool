/**
 * Idempotent baseline seed (replaces the previous DbSeeder + FeatureSeeder).
 * Phase 0 seeds roles and the demo organisation; Phase 1 adds users (with argon2 hashes)
 * and the feature catalogue; later phases add students, courses, classes and gamification.
 * Run: pnpm --filter @smartschool/api db:seed
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const ROLES = [
  'SuperAdmin',
  'Superintendent',
  'Principal',
  'Teacher',
  'Student',
  'Parent',
  'Assistant',
];

async function seedRoles(): Promise<void> {
  for (const name of ROLES) {
    const normalized = name.toUpperCase();
    await prisma.aspNetRoles.upsert({
      where: { NormalizedName: normalized },
      update: {},
      create: {
        Id: randomUUID(),
        Name: name,
        NormalizedName: normalized,
        ConcurrencyStamp: randomUUID(),
      },
    });
  }
  console.log(`roles: ${ROLES.length} present`);
}

async function seedDemoOrganization(): Promise<void> {
  const existing = await prisma.organizations.findFirst({
    where: { Name: 'Demo School' },
  });
  if (existing) {
    console.log('organization: Demo School present');
    return;
  }
  await prisma.organizations.create({
    data: {
      Name: 'Demo School',
      Description: 'A demo school organization for testing',
      Email: 'demo@smartschool.local',
      Phone: '+1234567890',
      Address: '123 Demo Street, Demo City',
      IsActive: true,
    },
  });
  console.log('organization: Demo School created');
}

async function main(): Promise<void> {
  await seedRoles();
  await seedDemoOrganization();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('seed complete');
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
