import { startTracing } from './tracing/start';

startTracing('staysync-agent');
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AgentRootModule } from './agent.root';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AgentRootModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks(); // SIGTERM leaves the consumer group cleanly, as in the worker
}
void bootstrap();
