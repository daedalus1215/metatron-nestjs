import { Module } from '@nestjs/common';
import { CreateNoteAction } from './apps/actions/create-note/create-note.action';
import { ListNotesAction } from './apps/actions/list-notes/list-notes.action';
import { NoteService } from './domain/services/note.service';
import { NoteRepository } from './infra/repositories/note.repository';

@Module({ controllers: [CreateNoteAction, ListNotesAction], providers: [NoteService, NoteRepository] })
export class NotesModule {}
