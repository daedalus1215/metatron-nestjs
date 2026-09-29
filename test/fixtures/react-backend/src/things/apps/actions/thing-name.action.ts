import { Body, Controller, Get, Param } from '@nestjs/common';
import { ThingService } from '../../domain/services/thing.service';

@Controller('things')
export class ThingNameAction {
  constructor(private readonly things: ThingService) {}

  @Get(':id/name')
  execute(@Param('id') id: number, @Body() body: { name: string }) {
    return this.things.one(id);
  }
}
