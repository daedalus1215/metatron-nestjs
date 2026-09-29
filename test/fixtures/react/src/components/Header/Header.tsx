import { useSidebar } from '../../hooks/useSidebar';

type HeaderProps = { title: string; subtitle?: string };

export const Header = ({ title, subtitle }: HeaderProps) => {
  const { open, toggle } = useSidebar();
  return (
    <header>
      <button aria-label="menu" onClick={toggle}>{open ? 'close' : 'open'}</button>
      <h1>{title}</h1>
      {subtitle && <p>It's {subtitle}</p>}
    </header>
  );
};
