import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permission } from '@karban/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { UsersService } from './users.service';
import { CreateUserDto, DisableUserDto, ListUsersQuery, UpdateUserDto } from './users.dto';

@ApiTags('users')
@Controller('users')
@RequirePermissions(Permission.USER_MANAGE)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() q: ListUsersQuery) {
    return this.users.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateUserDto) {
    return this.users.create(ctx, dto);
  }

  @Patch(':id')
  update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(ctx, id, dto);
  }

  @Post(':id/approve')
  approve(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.approve(ctx, id);
  }

  @Post(':id/disable')
  disable(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisableUserDto) {
    return this.users.disable(ctx, id, dto.terminated);
  }

  @Post(':id/enable')
  enable(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.enable(ctx, id);
  }

  @Post(':id/reset-password')
  resetPassword(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.resetPassword(ctx, id);
  }
}
