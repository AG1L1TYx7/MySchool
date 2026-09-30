import { PermissionService } from './permission.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';

function prismaWith(
  roleCodes: string[],
  overrides: Array<{ code: string; granted: boolean; active?: boolean }>,
) {
  return {
    roleFeature: {
      findMany: jest
        .fn()
        .mockResolvedValue(roleCodes.map((code) => ({ feature: { code } }))),
    },
    userFeatureOverride: {
      findMany: jest.fn().mockResolvedValue(
        overrides.map((o) => ({
          isGranted: o.granted,
          feature: { code: o.code, isActive: o.active ?? true },
        })),
      ),
    },
  } as unknown as PrismaService;
}

describe('PermissionService', () => {
  it('combines role features with grants and revocations', async () => {
    const svc = new PermissionService(
      prismaWith(
        ['students.view', 'students.create'],
        [
          { code: 'students.create', granted: false },
          { code: 'ai.tutor.chat', granted: true },
          { code: 'reports.view', granted: true, active: false },
        ],
      ),
    );
    const features = await svc.effectiveFeatures('u1', 'TEACHER');
    expect([...features].sort()).toEqual(['ai.tutor.chat', 'students.view']);
    expect(await svc.has('u1', 'TEACHER', 'students.create')).toBe(false);
  });

  it('caches per user and invalidates on demand', async () => {
    const prisma = prismaWith(['a.b'], []);
    const svc = new PermissionService(prisma);
    await svc.effectiveFeatures('u1', 'STUDENT');
    await svc.effectiveFeatures('u1', 'STUDENT');
    expect((prisma.roleFeature.findMany as jest.Mock).mock.calls).toHaveLength(
      1,
    );
    svc.invalidateUser('u1');
    await svc.effectiveFeatures('u1', 'STUDENT');
    expect((prisma.roleFeature.findMany as jest.Mock).mock.calls).toHaveLength(
      2,
    );
  });
});
