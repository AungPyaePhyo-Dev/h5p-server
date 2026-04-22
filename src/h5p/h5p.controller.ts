import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { H5PService } from './h5p.service';

@Controller('h5p')
export class H5PController {
  constructor(private readonly h5p: H5PService) {}

  // GET /h5p/libraries — list installed H5P libraries (content types)
  @Get('libraries')
  async listLibraries() {
    return this.h5p.listInstalledLibraries();
  }

  // POST /h5p/content — save new content produced by the editor
  // Body: { title, library, params } — params is the H5P editor payload
  @Post('content')
  async saveContent(
    @Body()
    body: {
      contentId?: string;
      title: string;
      library: string;
      params: { params: unknown; metadata: unknown };
    },
  ) {
    const editor = this.h5p.getEditor();
    const user = this.h5p.currentUser();
    const contentId = await editor.saveOrUpdateContent(
      body.contentId ?? undefined,
      body.params.params as any,
      body.params.metadata as any,
      body.library,
      user,
    );
    await this.h5p.saveContentRecord(String(contentId), body.title, body.library);
    return { contentId };
  }

  // GET /h5p/play/:id — return init data the player needs to render content
  @Get('play/:id')
  async play(@Param('id') id: string) {
    const player = this.h5p.getPlayer();
    const user = this.h5p.currentUser();
    return player.render(id, user);
  }

  @Get('content')
  async listContent() {
    return this.h5p.listContent();
  }
}
