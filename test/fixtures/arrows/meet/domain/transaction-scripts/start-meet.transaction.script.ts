import { MeetRepository } from '../../infra/repositories/meet.repository';

export class StartMeetTransactionScript {
  constructor(private readonly repo: MeetRepository) {}

  apply = (input: { userId: string }): string => {
    return this.repo.save(input);
  };
}
