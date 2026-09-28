import { Injectable } from '@nestjs/common';

@Injectable()
export class PlainService {
  async hello(): Promise<void> {
    return;
  }
}
