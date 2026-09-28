import { Outlet } from 'react-router-dom';
import { Box } from '@mui/material';
import { Header } from '../Header/Header';

export const Layout = () => (
  <Box>
    <Header title="Things" />
    <Outlet />
  </Box>
);
