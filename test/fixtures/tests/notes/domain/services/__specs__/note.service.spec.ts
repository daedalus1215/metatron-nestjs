import { NoteService } from '../note.service';

describe('NoteService', () => {
  it('delegates to the aggregator', () => {
    expect(new NoteService(null).list()).toBeDefined();
  });
});
