import { Injectable } from '@nestjs/common';
import { TagEntity } from './tag.entity';

@Injectable()
export class TagService {
  constructor(private readonly tag: TagEntity) {}

  list() {
    return this.tag.id;
  }
}
