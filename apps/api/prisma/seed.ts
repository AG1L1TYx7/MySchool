/**
 * Idempotent baseline seed. Safe to run repeatedly.
 *   pnpm --filter @smartschool/api db:seed
 *
 * Creates: the feature catalogue with default role assignments, feature flags, the demo
 * organisation, and demo accounts for every role. Demo passwords are development-only.
 */
import { PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { FEATURE_CATALOG } from '../src/modules/access/feature-catalog';

const prisma = new PrismaClient();

export const DEMO_PASSWORD = 'SmartSchool!Demo2026';

const DEMO_USERS: Array<{
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}> = [
  {
    email: 'superadmin@smartschool.local',
    firstName: 'Sam',
    lastName: 'Admin',
    role: 'SUPER_ADMIN',
  },
  {
    email: 'superintendent@smartschool.local',
    firstName: 'Dana',
    lastName: 'Rivera',
    role: 'SUPERINTENDENT',
  },
  {
    email: 'principal@smartschool.local',
    firstName: 'Jordan',
    lastName: 'Lee',
    role: 'PRINCIPAL',
  },
  {
    email: 'teacher@smartschool.local',
    firstName: 'Jane',
    lastName: 'Teacher',
    role: 'TEACHER',
  },
  {
    email: 'student@smartschool.local',
    firstName: 'Emma',
    lastName: 'Johnson',
    role: 'STUDENT',
  },
  {
    email: 'parent@smartschool.local',
    firstName: 'Michael',
    lastName: 'Johnson',
    role: 'PARENT',
  },
  {
    email: 'assistant@smartschool.local',
    firstName: 'Alex',
    lastName: 'Aide',
    role: 'ASSISTANT',
  },
];

const FLAGS: Array<{ name: string; isEnabled: boolean; description: string }> =
  [
    {
      name: 'ai.tutor',
      isEnabled: true,
      description: 'Student-facing AI tutor',
    },
    {
      name: 'ai.content-generation',
      isEnabled: true,
      description: 'Teacher AI content generation',
    },
    {
      name: 'self-registration',
      isEnabled: true,
      description:
        'Allow students, parents and teachers to register themselves',
    },
  ];

async function seedFeatures(): Promise<void> {
  for (const def of FEATURE_CATALOG) {
    const feature = await prisma.feature.upsert({
      where: { code: def.code },
      update: {
        name: def.name,
        category: def.category,
        description: def.description ?? null,
      },
      create: {
        id: uuidv7(),
        code: def.code,
        name: def.name,
        category: def.category,
        description: def.description ?? null,
      },
    });
    for (const role of def.roles) {
      await prisma.roleFeature.upsert({
        where: { role_featureId: { role, featureId: feature.id } },
        update: {},
        create: { id: uuidv7(), role, featureId: feature.id },
      });
    }
  }
  console.log(
    `features: ${FEATURE_CATALOG.length} present with default role assignments`,
  );
}

async function seedFlags(): Promise<void> {
  for (const flag of FLAGS) {
    await prisma.featureFlag.upsert({
      where: { name: flag.name },
      update: { description: flag.description },
      create: { id: uuidv7(), ...flag },
    });
  }
  console.log(`feature flags: ${FLAGS.length} present`);
}

async function seedOrganization(): Promise<string> {
  const existing = await prisma.organization.findFirst({
    where: { name: 'Demo School', deletedAt: null },
  });
  if (existing) return existing.id;
  const org = await prisma.organization.create({
    data: {
      id: uuidv7(),
      name: 'Demo School',
      description: 'A demo school for development and evaluation',
      email: 'office@demo.smartschool.local',
      phone: '+1 555 0100',
      address: '123 Demo Street, Demo City',
      timezone: 'America/New_York',
    },
  });
  console.log('organization: Demo School created');
  return org.id;
}

async function seedUsers(organizationId: string): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        organizationId: u.role === 'SUPER_ADMIN' ? null : organizationId,
      },
      create: {
        id: uuidv7(),
        email: u.email,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        organizationId: u.role === 'SUPER_ADMIN' ? null : organizationId,
        emailVerifiedAt: new Date(),
      },
    });
  }
  console.log(
    `users: ${DEMO_USERS.length} demo accounts present (password: ${DEMO_PASSWORD})`,
  );
}

async function main(): Promise<void> {
  await seedFeatures();
  await seedFlags();
  const orgId = await seedOrganization();
  await seedUsers(orgId);
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
