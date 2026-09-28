import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class NoteEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  text: string;
}
