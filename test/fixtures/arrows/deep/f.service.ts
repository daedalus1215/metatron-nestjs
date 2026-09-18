import { GService } from './g.service';

export class FService {
  constructor(private readonly gService: GService) {}

  deep = () => {
    return this.gService.deep();
  };
}
