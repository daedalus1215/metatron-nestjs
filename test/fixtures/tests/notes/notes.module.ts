import { Module } from '@nestjs/common';
import { CreateNoteAction } from './apps/actions/create-note.action';
import { NoteService } from './domain/services/note.service';
import { NoteRepository } from './infra/repositories/note.repository';

@Module({ controllers: [CreateNoteAction], providers: [NoteService, NoteRepository] })
export class NotesModule {}
