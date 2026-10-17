import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

/**
 * Call first thing in each entrypoint. Spans are exported over OTLP/HTTP when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set (e.g. Jaeger); without it, trace context still flows
 * through the outbox and Kafka headers, it is just not exported anywhere.
 */
export function startTracing(serviceName: string) {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    spanProcessors: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? [new BatchSpanProcessor(new OTLPTraceExporter())]
      : [],
  });
  provider.register();
  return provider;
}
