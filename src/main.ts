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
  await app.listen(
    app.get<ConfigService<Env, true>>(ConfigService).get('PORT'),
  );
}
void bootstrap();
