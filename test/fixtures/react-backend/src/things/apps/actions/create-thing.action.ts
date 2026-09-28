import { Body, Controller, Post, Param } from '@nestjs/common';
import { ThingService } from '../../domain/services/thing.service';

@Controller('things')
export class CreateThingAction {
  constructor(private readonly things: ThingService) {}

  @Post()
  execute(@Param('id') id: number, @Body() body: { name: string }) {
    return this.things.create(body.name);
  }
}
