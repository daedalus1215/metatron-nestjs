import { NoteRepository } from './note.repository';

describe('NoteRepository', () => {
  it('finds notes', () => {
    expect(new NoteRepository().find()).toEqual([]);
  });
});
