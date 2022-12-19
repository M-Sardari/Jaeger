import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const Jaeger = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const { jaeger } = request;
  return  jaeger ;
});
