import { Controller, All, Head, Options, Get } from '@nestjs/common';

@Controller('probe')
export class ExtraVerbsController {
  @All('any')
  handleAll(): void {}

  @Head('h')
  handleHead(): void {}

  @Options('o')
  handleOptions(): void {}

  @Get(['array', 'routes'])
  arrayRoute(): void {}
}
