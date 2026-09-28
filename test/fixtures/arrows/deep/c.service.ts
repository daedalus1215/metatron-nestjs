import { DService } from './d.service';

export class CService {
  constructor(private readonly dService: DService) {}

  deep = () => {
    return this.dService.deep();
  };
}
