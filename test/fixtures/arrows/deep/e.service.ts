import { FService } from './f.service';

export class EService {
  constructor(private readonly fService: FService) {}

  deep = () => {
    return this.fService.deep();
  };
}
