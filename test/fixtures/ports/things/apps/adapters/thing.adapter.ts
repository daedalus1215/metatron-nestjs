import { Injectable } from '@nestjs/common';
import { ThingPort } from '../../domain/ports/things.port';
import { ThingRepository } from '../../infra/repositories/thing.repository';

@Injectable()
export class ThingAdapter implements ThingPort {
  constructor(private readonly thingRepository: ThingRepository) {}

  async save(id: number): Promise<void> {
    await this.thingRepository.persist(id);
  }
}
