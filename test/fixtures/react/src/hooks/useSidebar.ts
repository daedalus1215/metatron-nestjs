import { useContext } from 'react';
import { SidebarContext } from '../contexts/SidebarContext';

export const useSidebar = () => {
  const value = useContext(SidebarContext);
  if (!value) throw new Error('useSidebar outside its provider');
  return value;
};
