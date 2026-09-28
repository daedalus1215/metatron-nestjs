import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Thing } from '../../domain/entities/thing.entity';

@Injectable()
export class ThingRepository {
  constructor(@InjectRepository(Thing) private readonly repo: Repository<Thing>) {}

  findById(id: number) {
    return this.repo.findOne({ where: { id } });
  }

  count(): number {
    return 0;
  }
}
