import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthContextLoader } from './auth-context.loader';
import { SessionService } from './session.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, AuthContextLoader],
  exports: [SessionService, AuthContextLoader],
})
export class AuthModule {}
