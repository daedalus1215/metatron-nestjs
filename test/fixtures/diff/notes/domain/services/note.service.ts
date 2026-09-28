import { NoteRepository } from '../../infra/repositories/note.repository';
import { NoteEntity } from '../entities/note.entity';

export class NoteService {
  constructor(private readonly repo: NoteRepository) {}

  async createNote(): Promise<void> {
    const n = new NoteEntity();
    await this.repo.save(n);
  }

  async findAll(): Promise<void> {
    await this.repo.find();
  }
}
