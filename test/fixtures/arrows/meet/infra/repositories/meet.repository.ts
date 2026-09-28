export class MeetRepository {
  findById = (id: string): string => {
    return id;
  };

  save = (input: { userId: string }): string => {
    return input.userId;
  };
}
