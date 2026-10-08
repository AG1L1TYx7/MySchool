import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { randomBytes } from 'node:crypto';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  ChecklistTickDto,
  CollegePlanDto,
  CreateCodeLessonDto,
  CreateSkillDto,
  EndorseDto,
  InventoryDto,
  ProjectDto,
  ReviewProjectDto,
  RunCodeDto,
  SetSkillDto,
  UpdateCareerDto,
  UpdatePortfolioDto,
  UpdateProjectDto,
} from './dto/careers.dto';
import {
  CAREER_CLUSTERS,
  canSeePortfolio,
  checklistFor,
  INVENTORY,
  isValidSlug,
  matchClusters,
  readinessPercent,
  resumeSections,
  RIASEC_NAMES,
  scoreInventory,
  SKILL_LEVELS,
  slugFor,
  summarizeRun,
  type CodeTest,
  type Riasec,
} from './careers-rules';
import { CodeRunnerService } from './code-runner.service';

type StudentRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  gradeLevel: string | null;
  email: string | null;
};
const PROJECT_INCLUDE = {
  media: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      file: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
    },
  },
  reviews: {
    where: { hidden: false },
    include: {
      reviewer: { select: { firstName: true, lastName: true, role: true } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  sourceSubmission: {
    select: { id: true, assignment: { select: { title: true } } },
  },
};

/** Portfolios, skills and endorsements, career and college readiness, resumes, and code lessons (docs/02 sections 28 and 34). */
@Injectable()
export class CareersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly runner: CodeRunnerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Portfolio
  // ---------------------------------------------------------------------------

  async portfolio(studentId: string, actor: AuthenticatedUser) {
    const student = await this.visibleStudent(studentId, actor, {
      portfolioOnly: true,
    });
    const p = await this.ensurePortfolio(student);
    const own = student.userId === actor.id;
    const [projects, skills] = await Promise.all([
      this.prisma.portfolioProject.findMany({
        where: {
          portfolioId: p.id,
          ...(own || this.isStaffOf(student, actor)
            ? {}
            : { status: 'published' }),
        },
        include: PROJECT_INCLUDE,
        orderBy: [
          { featured: 'desc' },
          { sortOrder: 'asc' },
          { createdAt: 'desc' },
        ],
      }),
      this.studentSkills(student.id),
    ]);
    return {
      ...this.toPublicPortfolio(p, student),
      own,
      canReview: !own && actor.role !== 'PARENT',
      projects: projects.map((pr) => this.toPublicProject(pr, actor)),
      skills,
    };
  }

  async myPortfolio(actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    return this.portfolio(student.id, actor);
  }

  /** The public page: a published portfolio by its address, without signing in. */
  async publicPortfolio(slug: string) {
    const p = await this.prisma.portfolio.findFirst({
      where: { slug, visibility: 'public' },
      include: {
        student: {
          select: {
            firstName: true,
            lastName: true,
            gradeLevel: true,
            organization: { select: { name: true } },
          },
        },
        projects: {
          where: { status: 'published' },
          include: {
            media: {
              orderBy: { sortOrder: 'asc' },
              include: {
                file: {
                  select: { id: true, originalName: true, mimeType: true },
                },
              },
            },
          },
          orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }],
        },
      },
    });
    if (!p)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'No public portfolio at this address.',
      });
    const skills = await this.studentSkills(p.studentId);
    return {
      name: `${p.student.firstName} ${p.student.lastName}`,
      gradeLevel: p.student.gradeLevel,
      school: p.student.organization.name,
      headline: p.headline,
      about: p.about,
      projects: p.projects.map((pr) => ({
        id: pr.id,
        title: pr.title,
        summary: pr.summary,
        description: pr.description,
        kind: pr.kind,
        skills: parseList(pr.skills),
        completedOn: pr.completedOn,
        externalUrl: pr.externalUrl,
        media: pr.media.map((m) => ({
          fileId: m.fileId,
          name: m.file.originalName,
          mimeType: m.file.mimeType,
          caption: m.caption,
        })),
      })),
      skills: skills.map((s) => ({
        name: s.name,
        level: s.level,
        levelName: s.levelName,
        endorsements: s.endorsements.length,
      })),
    };
  }

  async updatePortfolio(dto: UpdatePortfolioDto, actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    const p = await this.ensurePortfolio(student);
    let slug = p.slug;
    if (dto.slug !== undefined && dto.slug !== '') {
      const s = dto.slug.toLowerCase();
      if (!isValidSlug(s))
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'Use 3 to 63 lower-case letters, digits and hyphens.',
        });
      const taken = await this.prisma.portfolio.findFirst({
        where: { slug: s, id: { not: p.id } },
      });
      if (taken)
        throw new ConflictException({
          code: 'resource.conflict',
          detail: 'That address is taken.',
        });
      slug = s;
    }
    if (
      (dto.visibility === 'public' ||
        (dto.visibility === undefined && p.visibility === 'public')) &&
      !slug
    )
      slug = slugFor(
        student.firstName,
        student.lastName,
        randomBytes(2).toString('hex'),
      );
    const updated = await this.prisma.portfolio.update({
      where: { id: p.id },
      data: {
        ...(dto.headline !== undefined ? { headline: dto.headline } : {}),
        ...(dto.about !== undefined ? { about: dto.about } : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        slug,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'portfolio.update',
      entityType: 'Portfolio',
      entityId: p.id,
      details: { fields: Object.keys(dto) },
    });
    return this.toPublicPortfolio(updated, student);
  }

  async createProject(dto: ProjectDto, actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    const p = await this.ensurePortfolio(student);
    await this.checkProjectRefs(dto, student, actor);
    const last = await this.prisma.portfolioProject.aggregate({
      where: { portfolioId: p.id },
      _max: { sortOrder: true },
    });
    const project = await this.prisma.portfolioProject.create({
      data: {
        id: newId(),
        portfolioId: p.id,
        title: dto.title,
        summary: dto.summary ?? null,
        description: dto.description ?? null,
        kind: dto.kind ?? 'project',
        status: dto.status ?? 'draft',
        featured: dto.featured ?? false,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        skills: JSON.stringify(dto.skills ?? []),
        reflection: dto.reflection ?? null,
        externalUrl: dto.externalUrl ?? null,
        completedOn: dto.completedOn ? new Date(dto.completedOn) : null,
        sourceSubmissionId: dto.sourceSubmissionId ?? null,
        media: {
          create: (dto.fileIds ?? []).map((fileId, i) => ({
            id: newId(),
            fileId,
            sortOrder: i + 1,
          })),
        },
      },
      include: PROJECT_INCLUDE,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'portfolio.project.create',
      entityType: 'PortfolioProject',
      entityId: project.id,
    });
    return this.toPublicProject(project, actor);
  }

  async updateProject(
    id: string,
    dto: UpdateProjectDto,
    actor: AuthenticatedUser,
  ) {
    const student = await this.ownStudent(actor);
    const row = await this.ownProject(id, student);
    await this.checkProjectRefs(dto, student, actor);
    if (dto.fileIds) {
      await this.prisma.portfolioMedia.deleteMany({ where: { projectId: id } });
      await this.prisma.portfolioMedia.createMany({
        data: dto.fileIds.map((fileId, i) => ({
          id: newId(),
          projectId: id,
          fileId,
          sortOrder: i + 1,
        })),
      });
    }
    const project = await this.prisma.portfolioProject.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.featured !== undefined ? { featured: dto.featured } : {}),
        ...(dto.skills !== undefined
          ? { skills: JSON.stringify(dto.skills) }
          : {}),
        ...(dto.reflection !== undefined ? { reflection: dto.reflection } : {}),
        ...(dto.externalUrl !== undefined
          ? { externalUrl: dto.externalUrl }
          : {}),
        ...(dto.completedOn !== undefined
          ? { completedOn: dto.completedOn ? new Date(dto.completedOn) : null }
          : {}),
        ...(dto.sourceSubmissionId !== undefined
          ? { sourceSubmissionId: dto.sourceSubmissionId }
          : {}),
      },
      include: PROJECT_INCLUDE,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'portfolio.project.update',
      entityType: 'PortfolioProject',
      entityId: row.id,
      details: { fields: Object.keys(dto) },
    });
    return this.toPublicProject(project, actor);
  }

  async removeProject(id: string, actor: AuthenticatedUser): Promise<void> {
    const student = await this.ownStudent(actor);
    await this.ownProject(id, student);
    await this.prisma.portfolioProject.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'portfolio.project.delete',
      entityType: 'PortfolioProject',
      entityId: id,
    });
  }

  /** Feedback from a teacher, counselor or classmate who may see the portfolio; the owner may hide it. */
  async reviewProject(
    id: string,
    dto: ReviewProjectDto,
    actor: AuthenticatedUser,
  ) {
    const project = await this.prisma.portfolioProject.findUnique({
      where: { id },
      include: { portfolio: { include: { student: true } } },
    });
    if (!project || project.status !== 'published')
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Project not found.',
      });
    const student = project.portfolio.student;
    if (student.userId === actor.id)
      throw new BadRequestException({
        code: 'portfolio.own_project',
        detail: 'You cannot review your own project.',
      });
    if (actor.role === 'PARENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Family members read portfolios; feedback comes from teachers and classmates.',
      });
    await this.visibleStudent(student.id, actor, { portfolioOnly: true });
    await this.prisma.portfolioReview.upsert({
      where: { projectId_reviewerId: { projectId: id, reviewerId: actor.id } },
      create: {
        id: newId(),
        projectId: id,
        reviewerId: actor.id,
        comment: dto.comment,
        stars: dto.stars ?? null,
      },
      update: { comment: dto.comment, stars: dto.stars ?? null, hidden: false },
    });
    const fresh = await this.prisma.portfolioProject.findUniqueOrThrow({
      where: { id },
      include: PROJECT_INCLUDE,
    });
    return this.toPublicProject(fresh, actor);
  }

  async hideReview(
    projectId: string,
    reviewId: string,
    actor: AuthenticatedUser,
  ) {
    const student = await this.ownStudent(actor);
    await this.ownProject(projectId, student);
    await this.prisma.portfolioReview.updateMany({
      where: { id: reviewId, projectId },
      data: { hidden: true },
    });
    const fresh = await this.prisma.portfolioProject.findUniqueOrThrow({
      where: { id: projectId },
      include: PROJECT_INCLUDE,
    });
    return this.toPublicProject(fresh, actor);
  }

  /** The submissions a student may show as evidence: their own graded or submitted work. */
  async evidence(actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    const rows = await this.prisma.assignmentSubmission.findMany({
      where: { studentId: student.id },
      include: {
        assignment: {
          select: { title: true, class: { select: { name: true } } },
        },
        grade: { select: { percentage: true, letterGrade: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.assignment.title,
      className: r.assignment.class.name,
      submittedAt: r.submittedAt,
      grade: r.grade
        ? {
            percentage: Number(r.grade.percentage),
            letter: r.grade.letterGrade,
          }
        : null,
    }));
  }

  // ---------------------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------------------

  async skillCatalogue(actor: AuthenticatedUser) {
    const rows = await this.prisma.skill.findMany({
      where: {
        OR: [
          { organizationId: null },
          ...(actor.organizationId
            ? [{ organizationId: actor.organizationId }]
            : []),
        ],
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      description: s.description,
      schoolOwned: !!s.organizationId,
    }));
  }

  async createSkill(dto: CreateSkillDto, actor: AuthenticatedUser) {
    if (!actor.organizationId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your account is not attached to a school.',
      });
    const row = await this.prisma.skill.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        name: dto.name,
        category: dto.category,
        description: dto.description ?? null,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'skills.create',
      entityType: 'Skill',
      entityId: row.id,
      details: { name: dto.name },
    });
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      schoolOwned: true,
    };
  }

  async setSkill(dto: SetSkillDto, actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    const skill = await this.prisma.skill.findFirst({
      where: {
        id: dto.skillId,
        OR: [
          { organizationId: null },
          { organizationId: student.organizationId },
        ],
      },
    });
    if (!skill)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Skill not found.',
      });
    await this.prisma.studentSkill.upsert({
      where: {
        studentId_skillId: { studentId: student.id, skillId: dto.skillId },
      },
      create: {
        id: newId(),
        studentId: student.id,
        skillId: dto.skillId,
        level: dto.level,
        note: dto.note ?? null,
      },
      update: { level: dto.level, note: dto.note ?? null },
    });
    return this.studentSkills(student.id);
  }

  async removeSkill(skillId: string, actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    await this.prisma.studentSkill.deleteMany({
      where: { studentId: student.id, skillId },
    });
    return this.studentSkills(student.id);
  }

  /** Teachers, counselors, administrators and classmates vouch for a skill once each. */
  async endorse(
    studentId: string,
    skillId: string,
    dto: EndorseDto,
    actor: AuthenticatedUser,
  ) {
    const student = await this.visibleStudent(studentId, actor, {
      portfolioOnly: true,
    });
    if (student.userId === actor.id)
      throw new BadRequestException({
        code: 'portfolio.own_skill',
        detail: 'You cannot endorse your own skill.',
      });
    if (actor.role === 'PARENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Endorsements come from teachers and classmates.',
      });
    const ss = await this.prisma.studentSkill.findUnique({
      where: { studentId_skillId: { studentId, skillId } },
    });
    if (!ss)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'The student has not added this skill.',
      });
    await this.prisma.skillEndorsement.upsert({
      where: {
        studentSkillId_endorserId: {
          studentSkillId: ss.id,
          endorserId: actor.id,
        },
      },
      create: {
        id: newId(),
        studentSkillId: ss.id,
        endorserId: actor.id,
        comment: dto.comment ?? null,
      },
      update: { comment: dto.comment ?? null },
    });
    return this.studentSkills(studentId);
  }

  private async studentSkills(studentId: string) {
    const rows = await this.prisma.studentSkill.findMany({
      where: { studentId },
      include: {
        skill: true,
        endorsements: {
          include: {
            endorser: {
              select: { firstName: true, lastName: true, role: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ level: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map((r) => ({
      skillId: r.skillId,
      name: r.skill.name,
      category: r.skill.category,
      level: r.level,
      levelName: SKILL_LEVELS[r.level as 1 | 2 | 3 | 4] ?? 'emerging',
      note: r.note,
      endorsements: r.endorsements.map((e) => ({
        by: `${e.endorser.firstName} ${e.endorser.lastName}`.trim(),
        role: e.endorser.role.toLowerCase(),
        comment: e.comment,
        at: e.createdAt,
      })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Career and college readiness
  // ---------------------------------------------------------------------------

  inventoryQuestions() {
    return {
      questions: INVENTORY.map((q) => ({ id: q.id, text: q.text })),
      scale: [1, 2, 3, 4, 5],
      codes: RIASEC_NAMES,
    };
  }

  clusters() {
    return CAREER_CLUSTERS.map((c) => ({
      id: c.id,
      name: c.name,
      codes: c.codes,
      examples: c.examples,
    }));
  }

  async career(studentId: string, actor: AuthenticatedUser) {
    const student = await this.visibleStudent(studentId, actor, {
      portfolioOnly: false,
    });
    const row = await this.prisma.careerProfile.upsert({
      where: { studentId: student.id },
      create: { id: newId(), studentId: student.id },
      update: {},
    });
    const interests = row.interests
      ? (JSON.parse(row.interests) as {
          scores: Record<Riasec, number>;
          top: Riasec[];
          code: string;
        })
      : null;
    const checklist = checklistFor(
      student.gradeLevel,
      row.checklist
        ? (JSON.parse(row.checklist) as Array<{
            key: string;
            doneAt: string;
            byId: string | null;
          }>)
        : [],
    );
    const pathways = parseList(row.pathways);
    return {
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        gradeLevel: student.gradeLevel,
      },
      goals: row.goals,
      interests: interests
        ? {
            ...interests,
            names: interests.top.map((c) => RIASEC_NAMES[c]),
            takenAt: row.inventoryAt,
            clusters: matchClusters(interests.top),
          }
        : null,
      pathways: pathways.map((id) => ({
        id,
        name: CAREER_CLUSTERS.find((c) => c.id === id)?.name ?? id,
      })),
      collegePlans: row.collegePlans
        ? (JSON.parse(row.collegePlans) as CollegePlanDto[])
        : [],
      checklist,
      readiness: readinessPercent(checklist),
      canCounsel: this.canCounsel(student, actor),
      own: student.userId === actor.id,
    };
  }

  async myCareer(actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    return this.career(student.id, actor);
  }

  async updateCareer(
    studentId: string,
    dto: UpdateCareerDto,
    actor: AuthenticatedUser,
  ) {
    const student = await this.visibleStudent(studentId, actor, {
      portfolioOnly: false,
    });
    if (student.userId !== actor.id && !this.canCounsel(student, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the student and their counselor change the career profile.',
      });
    if (dto.pathways) {
      const unknown = dto.pathways.filter(
        (p) => !CAREER_CLUSTERS.some((c) => c.id === p),
      );
      if (unknown.length)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: `Unknown pathways: ${unknown.join(', ')}.`,
        });
    }
    await this.prisma.careerProfile.upsert({
      where: { studentId: student.id },
      create: {
        id: newId(),
        studentId: student.id,
        goals: dto.goals ?? null,
        pathways: JSON.stringify(dto.pathways ?? []),
        collegePlans: JSON.stringify(dto.collegePlans ?? []),
      },
      update: {
        ...(dto.goals !== undefined ? { goals: dto.goals } : {}),
        ...(dto.pathways !== undefined
          ? { pathways: JSON.stringify(dto.pathways) }
          : {}),
        ...(dto.collegePlans !== undefined
          ? { collegePlans: JSON.stringify(dto.collegePlans) }
          : {}),
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'career.update',
      entityType: 'CareerProfile',
      entityId: student.id,
      details: { fields: Object.keys(dto) },
    });
    await this.autoTick(
      student.id,
      'pathways',
      (dto.pathways?.length ?? 0) >= 2,
      actor.id,
    );
    await this.autoTick(
      student.id,
      'college-list',
      (dto.collegePlans?.length ?? 0) >= 1,
      actor.id,
    );
    return this.career(student.id, actor);
  }

  async takeInventory(dto: InventoryDto, actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    let result;
    try {
      result = scoreInventory(dto.answers);
    } catch (err) {
      throw new BadRequestException({
        code: 'request.invalid',
        detail: (err as Error).message,
      });
    }
    await this.prisma.careerProfile.upsert({
      where: { studentId: student.id },
      create: {
        id: newId(),
        studentId: student.id,
        interests: JSON.stringify(result),
        inventoryAt: new Date(),
      },
      update: { interests: JSON.stringify(result), inventoryAt: new Date() },
    });
    await this.autoTick(student.id, 'interests', true, actor.id);
    return this.career(student.id, actor);
  }

  /** Counselors tick the counselor items; students tick their own; both are recorded with who and when. */
  async tickChecklist(
    studentId: string,
    dto: ChecklistTickDto,
    actor: AuthenticatedUser,
  ) {
    const student = await this.visibleStudent(studentId, actor, {
      portfolioOnly: false,
    });
    const item = checklistFor(null, []).find((i) => i.key === dto.key);
    if (!item)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Unknown checklist item.',
      });
    const own = student.userId === actor.id;
    if (!own && !this.canCounsel(student, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the student and their counselor update the checklist.',
      });
    if (own && item.who === 'counselor')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your counselor ticks this one.',
      });
    await this.autoTick(student.id, dto.key, dto.done, actor.id, true);
    return this.career(student.id, actor);
  }

  private async autoTick(
    studentId: string,
    key: string,
    done: boolean,
    byId: string,
    force = false,
  ) {
    const row = await this.prisma.careerProfile.findUnique({
      where: { studentId },
    });
    const stored = row?.checklist
      ? (JSON.parse(row.checklist) as Array<{
          key: string;
          doneAt: string;
          byId: string | null;
        }>)
      : [];
    const has = stored.some((s) => s.key === key);
    let next = stored;
    if (done && !has)
      next = [...stored, { key, doneAt: new Date().toISOString(), byId }];
    else if (!done && has && force) next = stored.filter((s) => s.key !== key);
    else return;
    await this.prisma.careerProfile.upsert({
      where: { studentId },
      create: { id: newId(), studentId, checklist: JSON.stringify(next) },
      update: { checklist: JSON.stringify(next) },
    });
  }

  // ---------------------------------------------------------------------------
  // Resume
  // ---------------------------------------------------------------------------

  async resumeData(studentId: string, actor: AuthenticatedUser) {
    const student = await this.visibleStudent(studentId, actor, {
      portfolioOnly: true,
    });
    const [p, skills, badges, cards, career, org] = await Promise.all([
      this.ensurePortfolio(student).then((pf) =>
        this.prisma.portfolio.findUniqueOrThrow({
          where: { id: pf.id },
          include: {
            projects: {
              where: { status: 'published' },
              orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }],
            },
          },
        }),
      ),
      this.studentSkills(student.id),
      this.prisma.studentBadge.findMany({
        where: { studentId: student.id },
        include: { badge: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.reportCard.findMany({
        where: {
          studentId: student.id,
          status: 'PUBLISHED',
          kind: 'REPORT_CARD',
        },
        include: {
          lines: true,
          gradingPeriod: {
            select: {
              term: { select: { academicYear: { select: { name: true } } } },
            },
          },
        },
        orderBy: { publishedAt: 'desc' },
        take: 8,
      }),
      this.prisma.careerProfile.findUnique({
        where: { studentId: student.id },
      }),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: student.organizationId },
        select: { name: true, address: true },
      }),
    ]);
    const seen = new Set<string>();
    const courses: Array<{
      title: string;
      year: string;
      letter: string | null;
    }> = [];
    for (const c of cards)
      for (const l of c.lines) {
        const key = `${l.courseTitle}|${c.gradingPeriod.term.academicYear.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        courses.push({
          title: l.courseTitle,
          year: c.gradingPeriod.term.academicYear.name,
          letter: l.letter,
        });
      }
    return {
      student: {
        firstName: student.firstName,
        lastName: student.lastName,
        gradeLevel: student.gradeLevel,
        email: student.email,
      },
      school: org,
      headline: p.headline,
      about: p.about,
      projects: p.projects.map((pr) => ({
        title: pr.title,
        summary: pr.summary,
        kind: pr.kind,
        completedOn: pr.completedOn,
        skills: parseList(pr.skills),
      })),
      skills: skills.map((s) => ({
        name: s.name,
        level: s.level,
        endorsements: s.endorsements.length,
      })),
      badges: badges.map((b) => ({
        name: b.badge.name,
        awardedAt: b.createdAt,
      })),
      courses,
      pathways: parseList(career?.pathways).map(
        (id) => CAREER_CLUSTERS.find((c) => c.id === id)?.name ?? id,
      ),
    };
  }

  async resumePdf(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const data = await this.resumeData(studentId, actor);
    const sections = resumeSections(data);
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 54,
      info: {
        Title: `${data.student.firstName} ${data.student.lastName} resume`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );
    doc.fontSize(20).text(`${data.student.firstName} ${data.student.lastName}`);
    doc
      .moveDown(0.2)
      .fontSize(10)
      .fillColor('#555555')
      .text([data.school.name, data.student.email].filter(Boolean).join(' · '));
    doc.fillColor('#000000');
    for (const s of sections) {
      doc.moveDown(0.8).fontSize(13).text(s.title, { underline: false });
      doc.moveDown(0.2).fontSize(10);
      for (const line of s.lines) doc.text(line, { indent: 0 });
    }
    doc
      .moveDown(1)
      .fontSize(8)
      .fillColor('#777777')
      .text(
        `Generated by SmartSchool on ${new Date().toISOString().slice(0, 10)}. Courses and recognition come from school records; projects and skills from the student's portfolio.`,
      );
    doc.end();
    const buffer = await done;
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'resume.pdf',
      entityType: 'Student',
      entityId: studentId,
    });
    await this.autoTick(studentId, 'resume', true, actor.id);
    return {
      buffer,
      fileName: `resume-${data.student.lastName.toLowerCase()}-${data.student.firstName.toLowerCase()}.pdf`,
    };
  }

  // ---------------------------------------------------------------------------
  // Code lessons
  // ---------------------------------------------------------------------------

  async codeLessons(actor: AuthenticatedUser) {
    const rows = await this.prisma.codeLesson.findMany({
      where: {
        OR: [
          { organizationId: null },
          ...(actor.organizationId
            ? [{ organizationId: actor.organizationId }]
            : []),
        ],
      },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });
    const student =
      actor.role === 'STUDENT'
        ? await this.prisma.student.findFirst({
            where: { userId: actor.id, deletedAt: null },
            select: { id: true },
          })
        : null;
    const best = student
      ? await this.prisma.codeSubmission.groupBy({
          by: ['lessonId'],
          where: { studentId: student.id },
          _max: { passed: true },
          _count: { _all: true },
        })
      : [];
    const byLesson = new Map(best.map((b) => [b.lessonId, b]));
    return {
      available: this.runner.available(),
      lessons: rows.map((l) => ({
        id: l.id,
        title: l.title,
        level: l.level,
        language: l.language,
        tests: (JSON.parse(l.tests) as CodeTest[]).length,
        schoolOwned: !!l.organizationId,
        bestPassed: byLesson.get(l.id)?._max.passed ?? null,
        attempts: byLesson.get(l.id)?._count._all ?? 0,
      })),
    };
  }

  async codeLesson(id: string, actor: AuthenticatedUser) {
    const l = await this.prisma.codeLesson.findFirst({
      where: {
        id,
        OR: [
          { organizationId: null },
          ...(actor.organizationId
            ? [{ organizationId: actor.organizationId }]
            : []),
        ],
      },
    });
    if (!l)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Lesson not found.',
      });
    const student =
      actor.role === 'STUDENT'
        ? await this.prisma.student.findFirst({
            where: { userId: actor.id, deletedAt: null },
            select: { id: true },
          })
        : null;
    const last = student
      ? await this.prisma.codeSubmission.findFirst({
          where: { studentId: student.id, lessonId: id },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    const tests = JSON.parse(l.tests) as CodeTest[];
    return {
      id: l.id,
      title: l.title,
      description: l.description,
      language: l.language,
      level: l.level,
      starter: l.starter,
      tests: tests.map((t) => ({
        label: t.label ?? t.expr,
        expected: t.expected,
      })),
      lastSubmission: last
        ? {
            source: last.source,
            status: last.status,
            passed: last.passed,
            total: last.total,
            output: last.output,
            createdAt: last.createdAt,
          }
        : null,
      available: this.runner.available(),
    };
  }

  async runCode(id: string, dto: RunCodeDto, actor: AuthenticatedUser) {
    const l = await this.prisma.codeLesson.findFirst({
      where: {
        id,
        OR: [
          { organizationId: null },
          ...(actor.organizationId
            ? [{ organizationId: actor.organizationId }]
            : []),
        ],
      },
    });
    if (!l)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Lesson not found.',
      });
    if (!this.runner.available()) throw new NotImplementedError();
    const tests = JSON.parse(l.tests) as CodeTest[];
    const run = await this.runner.run(dto.source, tests);
    const summary = summarizeRun(run.outcomes, run.error);
    const student = await this.prisma.student.findFirst({
      where: { userId: actor.id, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    if (student) {
      await this.prisma.codeSubmission.create({
        data: {
          id: newId(),
          lessonId: id,
          studentId: student.id,
          source: dto.source,
          status: summary.status,
          passed: summary.passed,
          total: summary.total,
          output:
            [run.error, run.output].filter(Boolean).join('\n').slice(0, 4000) ||
            null,
          runtimeMs: run.runtimeMs,
        },
      });
    }
    return {
      ...summary,
      outcomes: run.outcomes,
      output: run.output,
      error: run.error,
      runtimeMs: run.runtimeMs,
    };
  }

  async createCodeLesson(dto: CreateCodeLessonDto, actor: AuthenticatedUser) {
    if (!actor.organizationId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your account is not attached to a school.',
      });
    for (const t of dto.tests) {
      if (typeof t.expr !== 'string' || typeof t.expected !== 'string')
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'Each test needs expr and expected (JSON text).',
        });
      try {
        JSON.parse(t.expected);
      } catch {
        throw new BadRequestException({
          code: 'request.invalid',
          detail: `Expected value for "${t.expr}" is not valid JSON.`,
        });
      }
    }
    const last = await this.prisma.codeLesson.aggregate({
      where: { organizationId: actor.organizationId },
      _max: { sortOrder: true },
    });
    const row = await this.prisma.codeLesson.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        title: dto.title,
        description: dto.description,
        level: dto.level ?? 1,
        sortOrder: (last._max.sortOrder ?? 100) + 1,
        starter: dto.starter,
        tests: JSON.stringify(dto.tests),
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'code.lesson.create',
      entityType: 'CodeLesson',
      entityId: row.id,
    });
    return { id: row.id, title: row.title, level: row.level };
  }

  async codeProgress(studentId: string, actor: AuthenticatedUser) {
    const student = await this.visibleStudent(studentId, actor, {
      portfolioOnly: true,
    });
    const rows = await this.prisma.codeSubmission.findMany({
      where: { studentId: student.id },
      include: { lesson: { select: { title: true, level: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const byLesson = new Map<
      string,
      {
        title: string;
        level: number;
        attempts: number;
        bestPassed: number;
        total: number;
        solved: boolean;
      }
    >();
    for (const r of rows) {
      const cur = byLesson.get(r.lessonId) ?? {
        title: r.lesson.title,
        level: r.lesson.level,
        attempts: 0,
        bestPassed: 0,
        total: r.total,
        solved: false,
      };
      cur.attempts += 1;
      cur.bestPassed = Math.max(cur.bestPassed, r.passed);
      cur.solved = cur.solved || r.status === 'passed';
      byLesson.set(r.lessonId, cur);
    }
    const lessons = [...byLesson.entries()].map(([lessonId, v]) => ({
      lessonId,
      ...v,
    }));
    return {
      solved: lessons.filter((l) => l.solved).length,
      attempted: lessons.length,
      lessons,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async ensurePortfolio(student: StudentRow) {
    return this.prisma.portfolio.upsert({
      where: { studentId: student.id },
      create: {
        id: newId(),
        studentId: student.id,
        organizationId: student.organizationId,
      },
      update: {},
    });
  }

  private async ownProject(id: string, student: StudentRow) {
    const row = await this.prisma.portfolioProject.findFirst({
      where: { id, portfolio: { studentId: student.id } },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Project not found.',
      });
    return row;
  }

  private async checkProjectRefs(
    dto: ProjectDto | UpdateProjectDto,
    student: StudentRow,
    actor: AuthenticatedUser,
  ) {
    if (dto.sourceSubmissionId) {
      const n = await this.prisma.assignmentSubmission.count({
        where: { id: dto.sourceSubmissionId, studentId: student.id },
      });
      if (!n)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'That submission is not yours.',
        });
    }
    if (dto.fileIds?.length) {
      const n = await this.prisma.fileUpload.count({
        where: {
          id: { in: dto.fileIds },
          uploaderId: actor.id,
          deletedAt: null,
        },
      });
      if (n !== new Set(dto.fileIds).size)
        throw new BadRequestException({
          code: 'file.not_owned',
          detail: 'One or more files are missing or were not uploaded by you.',
        });
    }
    if (dto.externalUrl && !/^https?:\/\//.test(dto.externalUrl))
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Links must start with http:// or https://.',
      });
  }

  async ownStudent(actor: AuthenticatedUser): Promise<StudentRow> {
    const student = await this.prisma.student.findFirst({
      where: { userId: actor.id, deletedAt: null },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'No student record is attached to your account.',
      });
    return student;
  }

  private isStaffOf(student: StudentRow, actor: AuthenticatedUser): boolean {
    return (
      isDistrictRole(actor) ||
      (actor.organizationId === student.organizationId &&
        actor.role !== 'STUDENT' &&
        actor.role !== 'PARENT')
    );
  }

  private canCounsel(student: StudentRow, actor: AuthenticatedUser): boolean {
    if (isDistrictRole(actor)) return true;
    return (
      actor.organizationId === student.organizationId &&
      (actor.role === 'COUNSELOR' || actor.role === 'PRINCIPAL')
    );
  }

  /**
   * Who may open a student's portfolio or career page: the student, guardians, and school staff; teachers of the
   * student always, other staff and classmates by the portfolio's visibility (portfolioOnly) or never (career).
   */
  private async visibleStudent(
    studentId: string,
    actor: AuthenticatedUser,
    opts: { portfolioOnly: boolean },
  ): Promise<StudentRow> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: {
        guardians: { select: { guardianUserId: true } },
        portfolio: { select: { visibility: true } },
      },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    const isGuardian = student.guardians.some(
      (g) => g.guardianUserId === actor.id,
    );
    if (student.userId === actor.id || isGuardian) return student;
    if (actor.role === 'PARENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Not available for your account.',
      });
    if (actor.role !== 'STUDENT' && !isDistrictRole(actor))
      assertOrganizationAccess(actor, student.organizationId);
    const teaches =
      actor.role === 'TEACHER' || actor.role === 'ASSISTANT'
        ? (await this.prisma.classEnrollment.count({
            where: {
              studentId,
              status: { in: ['ENROLLED', 'COMPLETED'] },
              class: { teachers: { some: { teacherId: actor.id } } },
            },
          })) > 0
        : false;
    if (opts.portfolioOnly) {
      const ok = canSeePortfolio(
        {
          studentUserId: student.userId,
          organizationId: student.organizationId,
          visibility: student.portfolio?.visibility ?? 'private',
        },
        {
          id: actor.id,
          role: actor.role,
          organizationId: actor.organizationId,
          isGuardian,
          teaches,
        },
      );
      if (!ok)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'This portfolio is not shared with you.',
        });
      return student;
    }
    if (actor.role === 'STUDENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Not available for your account.',
      });
    if ((actor.role === 'TEACHER' || actor.role === 'ASSISTANT') && !teaches)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You do not teach this student.',
      });
    return student;
  }

  private toPublicPortfolio(
    p: {
      id: string;
      studentId: string;
      headline: string | null;
      about: string | null;
      visibility: string;
      slug: string | null;
      updatedAt: Date;
    },
    student: StudentRow,
  ) {
    return {
      id: p.id,
      studentId: p.studentId,
      student: {
        firstName: student.firstName,
        lastName: student.lastName,
        gradeLevel: student.gradeLevel,
      },
      headline: p.headline,
      about: p.about,
      visibility: p.visibility,
      slug: p.slug,
      publicPath: p.visibility === 'public' && p.slug ? `/p/${p.slug}` : null,
      updatedAt: p.updatedAt,
    };
  }

  private toPublicProject(
    pr: {
      id: string;
      title: string;
      summary: string | null;
      description: string | null;
      kind: string;
      status: string;
      featured: boolean;
      sortOrder: number;
      skills: string | null;
      reflection: string | null;
      externalUrl: string | null;
      completedOn: Date | null;
      createdAt: Date;
      updatedAt: Date;
      media: Array<{
        id: string;
        fileId: string;
        caption: string | null;
        file: { originalName: string; mimeType: string; sizeBytes: number };
      }>;
      reviews: Array<{
        id: string;
        comment: string;
        stars: number | null;
        createdAt: Date;
        reviewerId: string;
        reviewer: { firstName: string; lastName: string; role: string };
      }>;
      sourceSubmission: { id: string; assignment: { title: string } } | null;
    },
    actor: AuthenticatedUser,
  ) {
    return {
      id: pr.id,
      title: pr.title,
      summary: pr.summary,
      description: pr.description,
      kind: pr.kind,
      status: pr.status,
      featured: pr.featured,
      sortOrder: pr.sortOrder,
      skills: parseList(pr.skills),
      reflection: pr.reflection,
      externalUrl: pr.externalUrl,
      completedOn: pr.completedOn,
      evidence: pr.sourceSubmission
        ? {
            submissionId: pr.sourceSubmission.id,
            title: pr.sourceSubmission.assignment.title,
          }
        : null,
      media: pr.media.map((m) => ({
        id: m.id,
        fileId: m.fileId,
        name: m.file.originalName,
        mimeType: m.file.mimeType,
        sizeBytes: m.file.sizeBytes,
        caption: m.caption,
      })),
      reviews: pr.reviews.map((r) => ({
        id: r.id,
        by: `${r.reviewer.firstName} ${r.reviewer.lastName}`.trim(),
        role: r.reviewer.role.toLowerCase(),
        comment: r.comment,
        stars: r.stars,
        mine: r.reviewerId === actor.id,
        createdAt: r.createdAt,
      })),
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    };
  }
}

class NotImplementedError extends BadRequestException {
  constructor() {
    super({
      code: 'code.sandbox_unavailable',
      detail: 'Code runs are switched off on this server (ADR-013).',
    });
  }
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}
