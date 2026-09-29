import { Injectable } from '@nestjs/common';

@Injectable()
export class ThingService {
  list() { return []; }
  one(id: number) { return { id }; }
  remove(id: number) { return id; }
  rename(id: number, name: string) { return { id, name }; }
  create(name: string) { return { name }; }
}
