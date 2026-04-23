import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { H5PService } from './h5p.service';

@Controller('h5p')
export class H5PController {
  constructor(private readonly h5p: H5PService) {}

  // GET /h5p/libraries — list installed H5P libraries (custom summary).
  // Note: the Lumi router also binds /h5p/libraries/:uberName/:file* for
  // static files, but this bare path doesn't collide with that pattern.
  @Get('libraries')
  async listLibraries() {
    return this.h5p.listInstalledLibraries();
  }

  // GET /h5p/content — list saved content records (title + id).
  @Get('content')
  async listContent() {
    return this.h5p.listContent();
  }

  // GET /h5p/editor-model/:contentId? — payload for <H5PEditorUI>.
  // Pass contentId='new' (or omit) to open the editor for fresh content.
  @Get(['editor-model', 'editor-model/:contentId'])
  async editorModel(
    @Param('contentId') contentId?: string,
    @Query('language') language?: string,
  ) {
    const id =
      !contentId || contentId === 'new' || contentId === 'undefined'
        ? undefined
        : contentId;
    return this.h5p.renderEditorModel(id, language ?? 'en');
  }

  // GET /h5p/player-model/:contentId — payload for <H5PPlayerUI>.
  @Get('player-model/:contentId')
  async playerModel(
    @Param('contentId') contentId: string,
    @Query('language') language?: string,
  ) {
    return this.h5p.renderPlayerModel(contentId, language ?? 'en');
  }

  // POST /h5p/content/:contentId? — save content from the editor.
  // Body shape matches what @lumieducation/h5p-react's saveContentCallback emits.
  @Post(['content', 'content/:contentId'])
  async saveContent(
    @Param('contentId') contentId: string | undefined,
    @Body()
    body: {
      library: string;
      params: { params: unknown; metadata: { title?: string } };
    },
  ) {
    const id = !contentId || contentId === 'new' ? undefined : contentId;
    const editor = this.h5p.getEditor();
    const user = this.h5p.currentUser();

    const result = await editor.saveOrUpdateContentReturnMetaData(
      id as any,
      body.params.params as any,
      body.params.metadata as any,
      body.library,
      user,
    );

    const title = body.params.metadata?.title || 'Untitled';
    await this.h5p.saveContentRecord(String(result.id), title, body.library);

    return { contentId: String(result.id), metadata: result.metadata };
  }
}
