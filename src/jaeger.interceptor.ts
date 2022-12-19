import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, throwError } from "rxjs";
import { catchError, map } from "rxjs/operators";

import * as openTracing from "opentracing";
import * as jaegerClient from "jaeger-client";
import { JaegerConfigDto } from "./jaeger.dto";

function initJaeger(serviceName: string, agentHost: string) {
  const initJaegerTracer = jaegerClient.initTracer;
  const config = {
    serviceName,
    sampler: {
      type: "const",
      param: 1,
    },
    reporter: {
      agentHost,
    },
  };

  return initJaegerTracer(config);
}

@Injectable()
export class JaegerInterceptor implements NestInterceptor {
  tracer;

  constructor(@Inject("JAEGER_CONFIG") config: JaegerConfigDto) {
    this.tracer = initJaeger(config.serviceName, config.agentHost);
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler<any>
  ): Observable<any> | Promise<Observable<any>> {
    const type = context.getType();
    if (type !== "ws") {
      const http = context.switchToHttp();
      const req = http.getRequest();
      if (req.httpVersion) {
        return this.handleHttp(context, next);
      } else {
        return this.handleRMQ(context, next);
      }
    }
  }

  handleHttp(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const wireCtx = this.tracer.extract(
      openTracing.FORMAT_HTTP_HEADERS,
      request.headers
    );

    const span = this.tracer.startSpan(request["path"], { childOf: wireCtx });
    span.log({ event: "request_received" });
    span.setTag(openTracing.Tags.HTTP_METHOD, request.method);
    span.setTag(
      openTracing.Tags.SPAN_KIND,
      openTracing.Tags.SPAN_KIND_RPC_SERVER
    );
    span.setTag(openTracing.Tags.HTTP_URL, request["path"]);
    const responseHeaders = {};
    this.tracer.inject(span, openTracing.FORMAT_HTTP_HEADERS, responseHeaders);
    request["jaeger"] = responseHeaders;

    Object.assign(request, { span });

    return next.handle().pipe(
      map((value) => {
        span.setTag(openTracing.Tags.HTTP_STATUS_CODE, value.statusCode);
        span.log({ event: "request_end" });
        span.finish();
        return value;
      }),
      catchError((err) => {
        const { response } = err;
        span.setTag(openTracing.Tags.SAMPLING_PRIORITY, 1);
        span.setTag(openTracing.Tags.ERROR, true);
        span.log({ event: "error", message: err });
        span.setTag(
          openTracing.Tags.HTTP_STATUS_CODE,
          err?.response?.statusCode || 500
        );
        span.log({ event: "request_end" });
        span.finish();
        if (response) {
          return throwError(() => err);
        }
      })
    );
  }

  handleRMQ(context: ExecutionContext, next: CallHandler): Observable<any> {
    const rmqHeaders = context.getArgByIndex(0).jaeger;
    const rmqFields = context.getArgByIndex(1).fields;
    let span;
    if (rmqHeaders !== undefined) {
      const wireCtx = this.tracer.extract(
        openTracing.FORMAT_HTTP_HEADERS,
        rmqHeaders
      );

      span = this.tracer.startSpan(rmqFields.routingKey, { childOf: wireCtx });
      span.log({ event: "request_received" });
      span.setTag(openTracing.Tags.HTTP_METHOD, "rmq");
      span.setTag(
        openTracing.Tags.SPAN_KIND,
        openTracing.Tags.SPAN_KIND_RPC_SERVER
      );
      span.setTag(openTracing.Tags.HTTP_URL, rmqFields.routingKey);
      const responseHeaders = {};
      this.tracer.inject(
        span,
        openTracing.FORMAT_HTTP_HEADERS,
        responseHeaders
      );
      context.getArgByIndex(0).jaeger = responseHeaders;
    }

    return next.handle().pipe(
      map((value) => {
        if (rmqHeaders !== undefined) {
          span.setTag(openTracing.Tags.HTTP_STATUS_CODE, value.statusCode);
          span.log({ event: "request_end" });
          span.finish();
        }
        return value;
      }),
      catchError((error) => {
        if (rmqHeaders !== undefined) {
          span.setTag(openTracing.Tags.SAMPLING_PRIORITY, 1);
          span.setTag(openTracing.Tags.ERROR, true);
          span.log({ event: "error", message: error });
          span.setTag(
            openTracing.Tags.HTTP_STATUS_CODE,
            error.statusCode || 500
          );
          span.log({ event: "request_end" });
          span.finish();
        }
        return throwError(() => error);
      })
    );
  }
}
