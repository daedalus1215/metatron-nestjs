import { Controller, Get } from '@nestjs/common';

@Controller('views')
export class ViewsAction {
  @Get('archived')
  archived() { return []; }

  @Get('recent')
  recent() { return []; }
}
