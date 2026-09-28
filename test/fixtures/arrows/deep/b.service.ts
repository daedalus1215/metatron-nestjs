import { CService } from './c.service';

export class BService {
  constructor(private readonly cService: CService) {}

  deep = () => {
    return this.cService.deep();
  };
}
