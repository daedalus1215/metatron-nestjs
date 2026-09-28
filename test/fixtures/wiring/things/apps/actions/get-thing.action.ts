import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ThingService } from '../../domain/services/thing.service';
import { THING_PORT, ThingPort } from '../../domain/ports/thing.port';

@Controller('things')
export class GetThingAction {
  constructor(
    private readonly thingService: ThingService,
    @Inject(THING_PORT) private readonly thingPort: ThingPort,
  ) {}

  @Get(':id')
  async execute(@Param('id') id: number) {
    this.thingPort.ping();
    return this.thingService.find(id);
  }
}
