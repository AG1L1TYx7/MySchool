import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';
import { ServiceTokenGuard } from './service-token.guard';
import { ageBandFor } from './age-band';

/**
 * Read-only context for the AI service (docs/10 section 4). Returns the minimum the agents need:
 * never emails, addresses, guardians or other students.
 */
@ApiExcludeController()
@Public()
@UseGuards(ServiceTokenGuard)
@Controller('internal/ai')
export class InternalAiController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('lessons/:id')
  async lesson(@Param('id', ParseUUIDPipe) id: string) {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id,
        isPublished: true,
        module: { isPublished: true, course: { deletedAt: null } },
      },
      include: {
        module: {
          include: {
            course: { select: { id: true, title: true, organizationId: true } },
          },
        },
      },
    });
    if (!lesson)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Lesson not found.',
      });
    return {
      id: lesson.id,
      title: lesson.title,
      lessonType: lesson.lessonType.toLowerCase(),
      content: (lesson.content ?? '').slice(0, 6000),
      contentUrl: lesson.contentUrl,
      moduleTitle: lesson.module.title,
      courseId: lesson.module.course.id,
      courseTitle: lesson.module.course.title,
      organizationId: lesson.module.course.organizationId,
    };
  }

  @Get('courses/:id/outline')
  async outline(@Param('id', ParseUUIDPipe) id: string) {
    const course = await this.prisma.course.findFirst({
      where: { id, deletedAt: null },
      include: {
        modules: {
          where: { isPublished: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            lessons: {
              where: { isPublished: true },
              orderBy: { sortOrder: 'asc' },
              select: { id: true, title: true },
            },
          },
        },
      },
    });
    if (!course)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Course not found.',
      });
    return {
      id: course.id,
      title: course.title,
      subject: course.subject,
      gradeLevel: course.gradeLevel,
      organizationId: course.organizationId,
      modules: course.modules.map((m) => ({
        id: m.id,
        title: m.title,
        lessons: m.lessons,
      })),
    };
  }

  @Get('students/:id/context')
  async student(@Param('id', ParseUUIDPipe) id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, deletedAt: null },
      include: {
        enrollments: {
          where: { status: 'ENROLLED' },
          include: {
            class: {
              select: {
                id: true,
                name: true,
                course: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    return {
      id: student.id,
      firstName: student.firstName,
      gradeLevel: student.gradeLevel,
      ageBand: ageBandFor(student.dateOfBirth, student.gradeLevel),
      learningStyle: student.preferredLearningStyle?.toLowerCase() ?? null,
      accessibilityNeeds: student.accessibilityNeeds,
      classes: student.enrollments.map((e) => ({
        id: e.class.id,
        name: e.class.name,
        courseId: e.class.course.id,
        courseTitle: e.class.course.title,
      })),
    };
  }

  @Get('organizations/:id/lessons')
  async lessons(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.prisma.lesson.findMany({
      where: {
        isPublished: true,
        lessonType: 'TEXT',
        content: { not: null },
        module: {
          isPublished: true,
          course: { organizationId: id, deletedAt: null, isPublished: true },
        },
      },
      include: {
        module: {
          select: {
            title: true,
            course: { select: { id: true, title: true } },
          },
        },
      },
      take: 5000,
    });
    return {
      data: rows.map((l) => ({
        docId: `lesson:${l.id}`,
        lessonId: l.id,
        courseId: l.module.course.id,
        title: `${l.module.course.title} / ${l.module.title} / ${l.title}`,
        text: l.content ?? '',
      })),
    };
  }
}
