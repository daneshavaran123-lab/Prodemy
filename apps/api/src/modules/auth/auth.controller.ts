import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser, Public } from '../../common/decorators';
import { CredentialRoute } from '../../common/guards/throttler.guard';
import type { AuthContext } from '../../common/auth-context';
import { AuthService } from './auth.service';
import { CSRF_COOKIE, SessionService } from './session.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './auth.dto';

const client = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** Issues the double-submit CSRF cookie; the SPA calls this before its first mutation. */
  @Get('csrf')
  @Public()
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const existing = req.cookies?.[CSRF_COOKIE];
    return { csrfToken: existing ?? this.sessions.issueCsrf(res) };
  }

  @Get('registration-options')
  @Public()
  registrationOptions() {
    return this.auth.registrationOptions();
  }

  @Post('register')
  @Public()
  @CredentialRoute()
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, client(req));
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @CredentialRoute()
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token } = await this.auth.login(dto, client(req));
    this.sessions.setSessionCookie(res, token);
    // Rotate the CSRF token on privilege change.
    this.sessions.issueCsrf(res);
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() ctx: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx);
    this.sessions.clearSessionCookie(res);
  }

  @Get('me')
  me(@CurrentUser() ctx: AuthContext) {
    return this.auth.me(ctx);
  }

  @Post('change-password')
  @HttpCode(204)
  changePassword(@CurrentUser() ctx: AuthContext, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(ctx, dto);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(202)
  @CredentialRoute()
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.auth.forgotPassword(dto, client(req));
    return { ok: true };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(204)
  @CredentialRoute()
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto, client(req));
  }
}
