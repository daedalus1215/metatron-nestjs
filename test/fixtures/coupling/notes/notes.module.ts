import { Module } from '@nestjs/common';
import { NoteService } from './domain/services/note.service';
import { NoteEntity } from './domain/entities/note.entity';

@Module({ providers: [NoteService, NoteEntity] })
export class NotesModule {}
