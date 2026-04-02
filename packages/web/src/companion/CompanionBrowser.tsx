import type { ReactNode } from 'react';
import { cx } from '../components/ui';

export function CompanionCardStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx('space-y-2 px-4', className)}>{children}</div>;
}

export function CompanionSection({
  title,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('pt-5 first:pt-0', className)}>
      <h2 className="px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <CompanionCardStack className={cx('mt-2', bodyClassName)}>{children}</CompanionCardStack>
    </section>
  );
}
