import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { h5pAjaxExpressRouter } from '@lumieducation/h5p-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { H5PService } from './h5p/h5p.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: true, credentials: true });

  // Initialize the H5P editor before Nest finalizes its route layer, then
  // mount the Lumi H5P Ajax router for: /h5p/ajax, /h5p/libraries/:uberName/*,
  // /h5p/content/:id/*, /h5p/params/:id, /h5p/core/*, /h5p/editor/*,
  // /h5p/download/:id, /h5p/temp-files/*. Nest controller routes are disjoint
  // (/h5p/libraries bare, /h5p/content bare, /h5p/editor-model/:id?, etc.).
  // The middleware must be registered before app.init() — Nest's express
  // adapter installs a catch-all 404 on init() that swallows later app.use().
  const h5p = app.get(H5PService);
  await h5p.init();
  app.use('/h5p', (req: Request, _res: Response, next: NextFunction) => {
    console.log('[h5p]', req.method, req.originalUrl);
    (req as any).user = h5p.currentUser();
    (req as any).language = (req.query.language as string) || 'en';
    (req as any).t = (key: string) => key;
    next();
  });
  app.use(
    '/h5p',
    h5pAjaxExpressRouter(h5p.getEditor(), h5p.getCorePath(), h5p.getEditorLibraryPath()),
  );

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`H5P backend listening on http://localhost:${port}`);
}
bootstrap();
