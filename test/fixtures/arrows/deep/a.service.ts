import { BService } from './b.service';

export class AService {
  constructor(private readonly bService: BService) {}

  deep = () => {
    return this.bService.deep();
  };
}
