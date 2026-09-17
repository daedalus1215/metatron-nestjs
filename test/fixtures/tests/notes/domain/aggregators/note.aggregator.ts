import { Injectable } from '@nestjs/common';
import { NoteRepository } from '../../infra/repositories/note.repository';

@Injectable()
export class NoteAggregator {
  constructor(private readonly repo: NoteRepository) {}

  list() {
    return this.repo.find();
  }
}
