import { Controller, Param, Post } from '@nestjs/common';
import { ThingService } from '../../domain/services/thing.service';

@Controller('things')
export class DoThingAction {
  constructor(private readonly thingService: ThingService) {}

  @Post(':id')
  async apply(@Param('id') id: number): Promise<void> {
    await this.thingService.run(id);
  }
}
