import { Controller, Post } from '@nestjs/common';
import { TagService } from '../../../domain/services/tag.service';

@Controller('tags')
export class CreateTagAction {
  constructor(private readonly service: TagService) {}

  @Post()
  async apply(): Promise<void> {
    await this.service.create();
  }
}
