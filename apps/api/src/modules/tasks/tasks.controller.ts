import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { TasksService } from './tasks.service';
import { TaskActivityService, type UploadedFile as Upload } from './task-activity.service';
import {
  BlockerInputDto,
  BulkManagerDto,
  ChangeStatusDto,
  CollaboratorsDto,
  CommentInputDto,
  CompleteTaskDto,
  CreateSubtaskDto,
  CreateTaskDto,
  DelayReasonInputDto,
  ListTasksQuery,
  ProgressDto,
  ReasonDto,
  ReassignDto,
  ReopenDto,
  ResolveBlockerDto,
  UpdateSubtaskDto,
  UpdateTaskDto,
} from './tasks.dto';

/** Hard upper bound for multipart bodies; the configurable limit is enforced in the service. */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

@ApiTags('tasks')
@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly activity: TaskActivityService,
  ) {}

  @Get('tasks')
  list(@CurrentUser() ctx: AuthContext, @Query() q: ListTasksQuery) {
    return this.tasks.list(ctx, q);
  }

  @Post('tasks')
  create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateTaskDto) {
    return this.tasks.create(ctx, dto);
  }

  @Post('tasks/bulk/manager')
  @HttpCode(200)
  bulkManager(@CurrentUser() ctx: AuthContext, @Body() dto: BulkManagerDto) {
    return this.tasks.bulkReassignManager(ctx, dto);
  }

  @Get('tasks/:id')
  get(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(ctx, id);
  }

  @Patch('tasks/:id')
  update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(ctx, id, dto);
  }

  @Post('tasks/:id/status')
  @HttpCode(200)
  status(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeStatusDto) {
    return this.tasks.changeStatus(ctx, id, dto);
  }

  @Post('tasks/:id/progress')
  @HttpCode(200)
  progress(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProgressDto) {
    return this.tasks.updateProgress(ctx, id, dto);
  }

  @Post('tasks/:id/complete')
  @HttpCode(200)
  complete(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteTaskDto) {
    return this.tasks.complete(ctx, id, dto);
  }

  @Post('tasks/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.accept(ctx, id);
  }

  @Post('tasks/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReopenDto) {
    return this.tasks.reopen(ctx, id, dto);
  }

  @Post('tasks/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.tasks.cancel(ctx, id, dto);
  }

  @Post('tasks/:id/reassign')
  @HttpCode(200)
  reassign(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReassignDto) {
    return this.tasks.reassign(ctx, id, dto);
  }

  @Put('tasks/:id/collaborators')
  collaborators(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollaboratorsDto,
  ) {
    return this.tasks.setCollaborators(ctx, id, dto);
  }

  @Post('tasks/:id/blockers')
  addBlocker(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockerInputDto) {
    return this.tasks.addBlocker(ctx, id, dto);
  }

  @Post('blockers/:id/resolve')
  @HttpCode(200)
  resolveBlocker(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveBlockerDto,
  ) {
    return this.tasks.resolveBlocker(ctx, id, dto.resolutionNote);
  }

  @Post('tasks/:id/delay-reasons')
  addDelayReason(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DelayReasonInputDto,
  ) {
    return this.tasks.addDelayReason(ctx, id, dto);
  }

  @Get('tasks/:id/timeline')
  timeline(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.activity.timeline(ctx, id);
  }

  @Get('tasks/:id/comments')
  comments(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.activity.listComments(ctx, id);
  }

  @Post('tasks/:id/comments')
  addComment(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentInputDto) {
    return this.activity.addComment(ctx, id, dto);
  }

  @Post('tasks/:id/subtasks')
  addSubtask(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSubtaskDto) {
    return this.activity.addSubtask(ctx, id, dto);
  }

  @Patch('subtasks/:id')
  updateSubtask(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubtaskDto,
  ) {
    return this.activity.updateSubtask(ctx, id, dto);
  }

  @Delete('subtasks/:id')
  removeSubtask(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.activity.removeSubtask(ctx, id);
  }

  @Post('tasks/:id/attachments')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
  ) {
    return this.activity.upload(ctx, id, file);
  }

  @Get('attachments/:id/download')
  async download(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.activity.download(ctx, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Cache-Control', 'private, no-store');
    file.stream.pipe(res);
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  removeAttachment(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.activity.removeAttachment(ctx, id);
  }
}
