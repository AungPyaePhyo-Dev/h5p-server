import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import * as H5P from '@lumieducation/h5p-server';
import { ContentRecord } from './content-record.entity';

@Injectable()
export class H5PService implements OnModuleInit {
  private editor!: H5P.H5PEditor;
  private player!: H5P.H5PPlayer;

  constructor(
    @InjectRepository(ContentRecord)
    private readonly contentRepo: Repository<ContentRecord>,
  ) {}

  async onModuleInit() {
    const dataDir = path.resolve(process.env.H5P_DATA_DIR || './h5p-data');
    const config = new H5P.H5PConfig(undefined, {
      baseUrl: '/h5p',
      contentTypeCacheRefreshInterval: 24 * 60 * 60 * 1000,
    });
    await config.load();

    this.editor = H5P.fs(
      config,
      path.join(dataDir, 'libraries'),
      path.join(dataDir, 'temp'),
      path.join(dataDir, 'content'),
    );
    this.player = new H5P.H5PPlayer(
      this.editor.libraryStorage,
      this.editor.contentStorage,
      config,
    );
  }

  getEditor() {
    return this.editor;
  }

  getPlayer() {
    return this.player;
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
    return this.contentRepo.find({ order: { updatedAt: 'DESC' } });
  }

  async saveContentRecord(id: string, title: string, mainLibrary: string) {
    await this.contentRepo.save({ id, title, mainLibrary });
  }

  async getContentRecord(id: string) {
    return this.contentRepo.findOne({ where: { id } });
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
