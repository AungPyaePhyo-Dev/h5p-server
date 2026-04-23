import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { Writable } from 'stream';
import * as H5P from '@lumieducation/h5p-server';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class H5PService {
  private editor!: H5P.H5PEditor;
  private player!: H5P.H5PPlayer;
  private readonly dataDir = path.resolve(process.env.H5P_DATA_DIR || './h5p-data');

  constructor(private readonly prisma: PrismaService) {}

  async init() {
    if (this.editor) return;
    const config = new H5P.H5PConfig(undefined, {
      baseUrl: '/h5p',
      contentTypeCacheRefreshInterval: 24 * 60 * 60 * 1000,
    });
    await config.load();

    this.editor = H5P.fs(
      config,
      path.join(this.dataDir, 'libraries'),
      path.join(this.dataDir, 'temp'),
      path.join(this.dataDir, 'content'),
    );
    this.player = new H5P.H5PPlayer(
      this.editor.libraryStorage,
      this.editor.contentStorage,
      config,
    );

    // Default renderers return HTML; we want raw models for the React client.
    this.editor.setRenderer((model) => model);
    this.player.setRenderer((model) => model);
  }

  getEditor() {
    return this.editor;
  }

  getPlayer() {
    return this.player;
  }

  getCorePath() {
    return path.join(this.dataDir, 'core');
  }

  getEditorLibraryPath() {
    return path.join(this.dataDir, 'editor');
  }

  async listInstalledLibraries() {
    const libs = await this.editor.libraryManager.libraryStorage.getInstalledLibraryNames();
    return libs.map((l) => ({
      machineName: l.machineName,
      majorVersion: l.majorVersion,
      minorVersion: l.minorVersion,
    }));
  }

  async listContent() {
    return this.prisma.contentRecord.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async saveContentRecord(id: string, title: string, mainLibrary: string) {
    await this.prisma.contentRecord.upsert({
      where: { id },
      create: { id, title, mainLibrary },
      update: { title, mainLibrary },
    });
  }

  async getContentRecord(id: string) {
    return this.prisma.contentRecord.findUnique({ where: { id } });
  }

  async renderEditorModel(contentId: string | undefined, language = 'en') {
    const user = this.currentUser();
    const model = (await this.editor.render(contentId as any, language, user)) as any;
    if (contentId) {
      const content = await this.editor.getContent(contentId, user);
      return { ...model, ...content };
    }
    return model;
  }

  async renderPlayerModel(contentId: string, language = 'en') {
    const user = this.currentUser();
    return this.player.render(contentId, user, language);
  }

  async exportToStream(contentId: string, out: Writable) {
    await this.editor.exportContent(contentId, out, this.currentUser());
  }

  currentUser(): H5P.IUser {
    return {
      id: 'local',
      name: 'Local User',
      type: 'local',
      email: 'local@example.com',
    } as H5P.IUser;
  }
}
