import { startTracing } from './tracing/start';

startTracing('staysync-api');
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';
import { configureApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(
    app.get<ConfigService<Env, true>>(ConfigService).get('PORT'),
  );
}
void bootstrap();
