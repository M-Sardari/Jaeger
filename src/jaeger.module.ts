import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { JaegerConfigDto } from './jaeger.dto';
import { CustomExceptionFilter } from './exception.filter';
import { JaegerInterceptor } from './jaeger.interceptor';

@Global()
@Module({})
export class JaegerModule {
  static register(jaegerConfig: JaegerConfigDto): DynamicModule {
    return {
      global: true,
      module: JaegerModule,
      imports: [],
      providers: [
        {
          provide: APP_FILTER,
          useClass: CustomExceptionFilter,
        },
        {
          provide: 'JAEGER_CONFIG',
          useValue: jaegerConfig,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: JaegerInterceptor,
        },
        JaegerInterceptor,
      ]
    };
  }
}
