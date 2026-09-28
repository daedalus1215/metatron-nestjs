import { Outlet } from 'react-router-dom';
import { Box } from '@mui/material';
import { Header } from '../Header/Header';
import { Slots } from '../Slots/Slots';

export const Layout = () => (
  <Box>
    <Header title="Things" />
    <Slots />
    <Outlet />
  </Box>
);
