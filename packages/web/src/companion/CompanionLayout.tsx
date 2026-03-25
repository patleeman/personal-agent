import { Outlet } from 'react-router-dom';

export function CompanionLayout() {
  return (
    <div className="flex h-screen flex-col bg-base text-primary">
      <Outlet />
    </div>
  );
}
