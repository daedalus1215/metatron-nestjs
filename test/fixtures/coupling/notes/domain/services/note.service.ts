import { Injectable } from '@nestjs/common';
import { NoteEntity } from '../entities/note.entity';

@Injectable()
export class NoteService {
  constructor(private readonly note: NoteEntity) {}

  list() {
    return this.note.id;
  }
}
