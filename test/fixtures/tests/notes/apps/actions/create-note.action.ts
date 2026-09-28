import { Controller, Get } from '@nestjs/common';
import { NoteService } from '../../domain/services/note.service';

@Controller('notes')
export class CreateNoteAction {
  constructor(private readonly notes: NoteService) {}

  @Get()
  list() {
    return this.notes.list();
  }
}
