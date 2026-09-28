import { Controller, Get } from '@nestjs/common';
import { NoteService } from '../../../domain/services/note.service';

@Controller('notes')
export class ListNotesAction {
  constructor(private readonly service: NoteService) {}

  @Get()
  async list(): Promise<void> {
    await this.service.findAll();
  }
}
