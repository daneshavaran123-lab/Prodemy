import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Permission } from '@karban/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { Trim } from '../../common/dto';
import { RolesService } from './roles.service';

class CreateRoleDto {
  @Trim()
  @Matches(/^[a-z][a-z0-9_]{2,31}$/, { message: 'کد نقش باید لاتین و با حروف کوچک باشد' })
  code: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}

class UpdateRoleDto {
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

@ApiTags('roles')
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @RequirePermissions(Permission.USER_MANAGE)
  list() {
    return this.roles.list();
  }

  @Get('permissions')
  @RequirePermissions(Permission.ROLE_MANAGE)
  permissions() {
    return this.roles.listPermissions();
  }

  @Post('roles')
  @RequirePermissions(Permission.ROLE_MANAGE)
  create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateRoleDto) {
    return this.roles.create(ctx, dto);
  }

  @Patch('roles/:id')
  @RequirePermissions(Permission.ROLE_MANAGE)
  update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(ctx, id, dto);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.ROLE_MANAGE)
  remove(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(ctx, id);
  }
}
