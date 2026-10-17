import { startTracing } from './tracing/start';

startTracing('staysync-worker');
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerRootModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerRootModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks(); // SIGTERM leaves the consumer group cleanly, so partitions move at once
}
void bootstrap();
