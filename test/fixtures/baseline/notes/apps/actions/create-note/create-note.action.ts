import { Controller, Post } from '@nestjs/common';
import { NoteRepository } from '../../../infra/repositories/note.repository';

@Controller('notes')
export class CreateNoteAction {
  constructor(private readonly repo: NoteRepository) {}

  @Post()
  async apply(): Promise<void> {
    await this.repo.save();
  }
}
