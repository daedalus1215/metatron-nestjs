import { EService } from './e.service';

export class DService {
  constructor(private readonly eService: EService) {}

  deep = () => {
    return this.eService.deep();
  };
}
