import { Injectable } from '@nestjs/common';
import { ThingRepository } from '../../infra/repositories/thing.repository';

@Injectable()
export class ThingArrowService {
  constructor(private readonly repo: ThingRepository) {}

  load = async (id: number) => {
    return this.repo.findById(id);
  };
}
