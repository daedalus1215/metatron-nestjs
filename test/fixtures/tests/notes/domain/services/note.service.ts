import { Injectable } from '@nestjs/common';
import { NoteAggregator } from '../aggregators/note.aggregator';

@Injectable()
export class NoteService {
  constructor(private readonly aggregate: NoteAggregator) {}

  list() {
    return this.aggregate.list();
  }
}
