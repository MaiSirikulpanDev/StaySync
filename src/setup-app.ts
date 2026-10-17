import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { httpTracing } from './tracing/http-tracing';

export function configureApp(app: INestApplication) {
  app.useLogger(app.get(Logger));
  app.use(httpTracing);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('StaySync')
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .addSecurityRequirements('api-key')
      .build(),
  );
  SwaggerModule.setup('docs', app, doc);
}
