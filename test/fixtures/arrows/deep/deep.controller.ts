import { Controller, Get } from '@nestjs/common';
import { AService } from './a.service';

@Controller('deep')
export class DeepController {
  constructor(private readonly aService: AService) {}

  @Get()
  go(): any {
    return this.aService.deep();
  }
}
