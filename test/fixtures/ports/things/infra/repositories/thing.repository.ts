import { Injectable } from '@nestjs/common';

@Injectable()
export class ThingRepository {
  async persist(id: number): Promise<void> {
    return;
  }
}
