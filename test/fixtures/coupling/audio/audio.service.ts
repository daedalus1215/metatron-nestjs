import { Injectable } from '@nestjs/common';
import { AudioEntity } from './audio.entity';

@Injectable()
export class AudioService {
  constructor(private readonly audio: AudioEntity) {}

  play() {
    return this.audio.id;
  }
}
