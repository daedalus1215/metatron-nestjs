import { formatDate } from './things/domain/utils/date.utils';

const bootstrap = async (): Promise<void> => {
  formatDate(new Date());
};

bootstrap();
