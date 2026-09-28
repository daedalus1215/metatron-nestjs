import { DataTable } from '@mui/x-data-grid';
import { Header } from '../Header/Header';

// Passes Header as a value: used, though never written as a tag. Unused is
// only named in this comment, which is not a use.
export const Slots = () => <DataTable slots={{ header: Header }} caption="Unused, again" />;
