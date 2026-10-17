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
}
