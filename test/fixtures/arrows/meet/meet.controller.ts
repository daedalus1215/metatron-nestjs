import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MeetService } from './domain/services/meet.service';

@Controller('meets')
export class MeetController {
  constructor(private readonly meetService: MeetService) {}

  @Post('start')
  start(@Body() body: { userId: string }): string {
    return this.meetService.startMeet(body.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string): string {
    return this.meetService.findOne(id);
  }

  @Get('cost')
  cost(): string {
    return this.meetService.calculateCost('u1');
  }

  @Get('lazy')
  lazy(): string {
    return this.meetService.helper();
  }
}
