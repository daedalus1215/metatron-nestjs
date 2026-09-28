import { Controller, Post } from '@nestjs/common';
import { NoteService } from '../../../domain/services/note.service';
import { NoteRepository } from '../../../infra/repositories/note.repository';

@Controller('notes')
export class CreateNoteAction {
  constructor(private readonly service: NoteService, private readonly repo: NoteRepository) {}

  @Post()
  async apply(): Promise<void> {
    await this.service.createNote();
    await this.repo.save();
  }
}
