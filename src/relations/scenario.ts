import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  ManyToManyConfigMap,
  OneToManyConfigMap,
  ResolvedRelationConfig,
} from './relation-config';

/**
 * Scenario / relation request plumbing — the port of Laravel's `inject`
 * middleware (`inject:_relation=…,_scenario=…`) and the bulk-scenario detection
 * used by `ManagesRelations`.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */

/** Request keys carrying the active validation scenario / relation name. */
export const SCENARIO_PARAM = '_scenario';
export const RELATION_PARAM = '_relation';

/**
 * Express-style middleware that injects fixed values into `req.query` so the
 * generic controller / validation pipe can read them, mirroring Laravel's
 * `inject:` middleware. Use it at route registration time:
 *
 *   consumer.apply(injectParams({ _scenario: 'bulk_update' })).forRoutes(...)
 */
export function injectParams(values: Record<string, string>) {
  return (req: { query?: Record<string, unknown>; body?: Record<string, unknown> }, _res: unknown, next: () => void): void => {
    // Express 5 exposes query through a getter without a setter. Shadow it on
    // this request while retaining the parsed query and middleware overrides.
    Object.defineProperty(req, 'query', {
      value: { ...(req.query ?? {}), ...values },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    next();
  };
}

/** True when the scenario denotes a bulk operation (matches "bulk" anywhere). */
export function isBulkScenario(scenario: string | undefined | null): boolean {
  return typeof scenario === 'string' && scenario.includes('bulk');
}

/** Param decorator: pulls `_scenario` from query/body (default 'none'). */
export const Scenario = createParamDecorator((fallback: string | undefined, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  return (req.query?.[SCENARIO_PARAM] ?? req.body?.[SCENARIO_PARAM] ?? fallback ?? 'none') as string;
});

/** Param decorator: pulls `_relation` from route params/query/body. */
export const RelationName = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined => {
  const req = ctx.switchToHttp().getRequest();
  return (req.params?.relation ?? req.query?.[RELATION_PARAM] ?? req.body?.[RELATION_PARAM]) as string | undefined;
});

/**
 * Resolve a relation name against the controller's O2M/M2M config maps,
 * tagging the result with `_type`. Throws 400 when unconfigured — same contract
 * as `ManagesRelations::resolveRelationConfig()`.
 */
export function resolveRelationConfig(
  relationName: string | undefined,
  oneToMany: OneToManyConfigMap | undefined,
  manyToMany: ManyToManyConfigMap | undefined,
  controllerName = 'controller',
): ResolvedRelationConfig {
  if (relationName) {
    if (oneToMany && oneToMany[relationName]) {
      return { ...oneToMany[relationName], _type: 'o2m' };
    }
    if (manyToMany && manyToMany[relationName]) {
      return { ...manyToMany[relationName], _type: 'm2m' };
    }
  }
  throw new BadRequestException(`Relation '${relationName ?? ''}' is not configured on ${controllerName}.`);
}

/** Extract the related payload from a body, trying the configured dataKey(s). */
export function extractMutationData(
  body: Record<string, unknown>,
  dataKey: string | string[] | undefined,
): Record<string, unknown> | Record<string, unknown>[] {
  const keys = dataKey ? (Array.isArray(dataKey) ? dataKey : [dataKey]) : [];
  for (const key of keys) {
    if (body[key] !== undefined) return body[key] as Record<string, unknown> | Record<string, unknown>[];
  }
  const clone: Record<string, unknown> = { ...body };
  delete clone[SCENARIO_PARAM];
  delete clone[RELATION_PARAM];
  return clone;
}
