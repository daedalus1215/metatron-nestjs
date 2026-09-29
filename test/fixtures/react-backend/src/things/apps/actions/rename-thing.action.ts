import { Body, Controller, Patch, Param } from '@nestjs/common';
import { ThingService } from '../../domain/services/thing.service';

@Controller('things')
export class RenameThingAction {
  constructor(private readonly things: ThingService) {}

  @Patch(':id/name')
  execute(@Param('id') id: number, @Body() body: { name: string }) {
    return this.things.rename(id, body.name);
  }
}
