import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';
import type { SavedViewDto } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { Trim } from '../../common/dto';
import { Errors } from '../../common/errors';

class SaveViewDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsObject()
  filters: Record<string, unknown>;
}

/** Saved task-list filters per user (PRD §41). Filters are re-applied through the normal, access-checked list API. */
@Injectable()
export class SavedViewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<SavedViewDto[]> {
    const rows = await this.prisma.savedView.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      filters: r.filters as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async save(userId: string, dto: SaveViewDto): Promise<SavedViewDto> {
    if (JSON.stringify(dto.filters).length > 4000) throw Errors.validation('فیلتر ذخیره‌شده بیش از حد بزرگ است.');
    const count = await this.prisma.savedView.count({ where: { userId } });
    if (count >= 30) throw Errors.validation('حداکثر ۳۰ نمای ذخیره‌شده مجاز است.');
    const r = await this.prisma.savedView.upsert({
      where: { userId_name: { userId, name: dto.name } },
      create: { userId, name: dto.name, filters: dto.filters as Prisma.InputJsonValue },
      update: { filters: dto.filters as Prisma.InputJsonValue },
    });
    return {
      id: r.id,
      name: r.name,
      filters: r.filters as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.prisma.savedView.deleteMany({ where: { id, userId } });
    if (!res.count) throw Errors.notFound('نمای ذخیره‌شده');
  }
}

@ApiTags('saved-views')
@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly views: SavedViewsService) {}

  @Get()
  list(@CurrentUser() ctx: AuthContext) {
    return this.views.list(ctx.userId);
  }

  @Post()
  save(@CurrentUser() ctx: AuthContext, @Body() dto: SaveViewDto) {
    return this.views.save(ctx.userId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.remove(ctx.userId, id);
  }
}

@Module({ controllers: [SavedViewsController], providers: [SavedViewsService] })
export class SavedViewsModule {}
