import { memo } from 'react';
import { deleteThing, type Thing } from '../../../api/requests/things.requests';

type ThingRowProps = { thing: Thing; onPick: (id: number) => void };

// Calls the request layer directly: the component>request skip rule.
export const ThingRow = memo(({ thing, onPick }: ThingRowProps) => (
  <li onClick={() => onPick(thing.id)}>
    {thing.name} <button onClick={() => deleteThing(thing.id)}>Don't</button>
  </li>
));
