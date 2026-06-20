import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { extractUserRoles, isSuperuser, RoleAwareUser } from './field-access';

/**
 * Endpoint-level role protection — the NestJS analogue of Laravel's
 * Spatie/`SpatieAuthorize` middleware. Pair `@Roles(...)` with `RolesGuard`.
 *
 *   @Roles('admin', 'editor')
 *   @UseGuards(RolesGuard)
 *   @Post() create(...) { ... }
 *
 * The guard reads the authenticated user from `request.user` (populate it with
 * your auth guard/strategy beforehand). A superuser bypasses every check.
 *
 * @author Charlietyn (TypeScript port)
 */
export const ROLES_KEY = 'rgc:roles';

/** Declare the roles allowed to access a handler or controller. */
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: RoleAwareUser }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Authentication required.');
    if (isSuperuser(user)) return true;

    const userRoles = extractUserRoles(user);
    const granted = required.some((role) => userRoles.includes(role));
    if (!granted) {
      throw new ForbiddenException(
        `Insufficient role. Required one of: ${required.join(', ')}.`,
      );
    }
    return true;
  }
}
