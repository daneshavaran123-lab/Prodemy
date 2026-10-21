import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RecordStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Permission, type ProjectDto } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RequirePermissions } from '../../common/decorators';
import { Trim } from '../../common/dto';
import { Errors } from '../../common/errors';

class CreateProjectDto {
  @Trim()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,23}$/, { message: 'کد پروژه باید لاتین و با حروف بزرگ باشد' })
  code: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

class UpdateProjectDto {
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  departmentId?: string | null;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

class ProjectsQuery {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

/** Lightweight project grouping for tasks (PRD §17 optional "Project"); not full PM. */
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ProjectsQuery): Promise<ProjectDto[]> {
    const rows = await this.prisma.project.findMany({
      where: { departmentId: q.departmentId, status: q.status },
      orderBy: { name: 'asc' },
      include: { department: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      department: p.department,
      status: p.status,
      taskCount: p._count.tasks,
    }));
  }

  async create(dto: CreateProjectDto): Promise<ProjectDto> {
    const p = await this.prisma.project.create({ data: dto });
    return (await this.list({})).find((x) => x.id === p.id)!;
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectDto> {
    if (!(await this.prisma.project.count({ where: { id } }))) throw Errors.notFound('پروژه');
    await this.prisma.project.update({ where: { id }, data: dto });
    return (await this.list({})).find((x) => x.id === id)!;
  }
}

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Query() q: ProjectsQuery) {
    return this.projects.list(q);
  }

  @Post()
  @RequirePermissions(Permission.PROJECT_MANAGE)
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PROJECT_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(id, dto);
  }
}

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
