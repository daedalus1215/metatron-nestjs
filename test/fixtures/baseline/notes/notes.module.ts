import { Module } from '@nestjs/common';
import { CreateNoteAction } from './apps/actions/create-note/create-note.action';
import { NoteRepository } from './infra/repositories/note.repository';

@Module({ controllers: [CreateNoteAction], providers: [NoteRepository] })
export class NotesModule {}
