import { Body, Controller, Get, Param } from '@nestjs/common';
import { ThingService } from '../../domain/services/thing.service';

@Controller('things')
export class ListThingsAction {
  constructor(private readonly things: ThingService) {}

  @Get()
  execute(@Param('id') id: number, @Body() body: { name: string }) {
    return this.things.list();
  }
}
