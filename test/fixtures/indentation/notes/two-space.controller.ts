import { Controller, Get, Post, Param } from '@nestjs/common';

@Controller('notes')
export class TwoSpaceController {
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<string> {
    return id;
  }

  @Post()
  create(): Promise<void> {
    return Promise.resolve();
  }
}
