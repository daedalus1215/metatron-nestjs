import { Injectable } from '@nestjs/common';

// One class injecting another declared in the same file: never imported, so
// the import index alone cannot resolve it.
@Injectable()
export class PairFirst {
  run(): number {
    return 1;
  }
}

@Injectable()
export class PairSecond {
  constructor(private readonly first: PairFirst) {}

  go(): number {
    return this.first.run();
  }
}
