import { StartMeetTransactionScript } from '../transaction-scripts/start-meet.transaction.script';
import { MeetRepository } from '../../infra/repositories/meet.repository';

export class MeetService {
  constructor(
    private readonly ts: StartMeetTransactionScript,
    private readonly repo: MeetRepository,
  ) {}

  private cache = {
    warm: (_id: string) => {},
  };

  startMeet = async (userId: string) => {
    return this.ts.apply({ userId });
  };

  findOne = (id: string) => {
    this.cache.warm(id);
    return this.repo.findById(id);
  };

  private calculateCost = (userId: string) => {
    return this.repo.findById(userId);
  };

  get helper() {
    return () => this.repo.findById('x');
  }
}
