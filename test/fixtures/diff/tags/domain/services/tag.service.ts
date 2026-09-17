import { NoteService } from '../../../notes/domain/services/note.service';

export class TagService {
  constructor(private readonly noteService: NoteService) {}

  async create(): Promise<void> {
    await this.noteService.findAll();
  }
}
