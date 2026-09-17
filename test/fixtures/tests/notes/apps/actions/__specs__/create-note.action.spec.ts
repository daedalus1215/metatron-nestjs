import { CreateNoteAction } from '../create-note.action';

describe('CreateNoteAction', () => {
  it('lists notes', () => {
    expect(new CreateNoteAction(null).list()).toBeDefined();
  });
});
