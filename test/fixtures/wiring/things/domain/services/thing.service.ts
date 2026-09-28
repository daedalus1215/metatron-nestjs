import { Injectable } from '@nestjs/common';
import { Clock } from '@acme/clock';
import { ThingRepository } from '../../infra/repositories/thing.repository';
import { formatDate } from '../utils/date.utils';

// Two injectable classes in one file. Each has its own constructor, and
// neither may borrow the other's sockets.
@Injectable()
export class ThingService {
  private cached = 0;

  constructor(
    private readonly thingRepository: ThingRepository,
    private readonly clock: Clock,
  ) {}

  static create(): ThingService {
    return undefined as unknown as ThingService;
  }

  async find(id: number) {
    this.onlyFromInside();
    this.helper();
    formatDate(new Date());
    return this.thingRepository.findById(id);
  }

  onlyFromInside(): void {}

  private helper(): number {
    return this.cached;
  }

  get size(): number {
    return this.cached;
  }

  set size(v: number) {
    this.cached = v;
  }
}

@Injectable()
export class ThingAuditor {
  constructor(private readonly repo: ThingRepository) {}

  audit(): number {
    ThingService.create();
    return this.repo.count();
  }
}
