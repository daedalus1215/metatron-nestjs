import { Controller, Get } from '@nestjs/common';

@Controller('dangling')
export class DanglingController {
  private readonly notAMethod: string = 'x';

  @Get('lost')
}
