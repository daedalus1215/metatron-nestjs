import { Body, Controller, Delete, Param } from '@nestjs/common';
import { ThingService } from '../../domain/services/thing.service';

@Controller('things')
export class DeleteThingAction {
  constructor(private readonly things: ThingService) {}

  @Delete(':id')
  execute(@Param('id') id: number, @Body() body: { name: string }) {
    return this.things.remove(id);
  }
}
