import type { ComponentProps } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

/** Resizable split (react-resizable-panels v4). Layout persists to
 *  localStorage under `herdr.split.<id>`. Children: SplitPane / SplitHandle.
 *  Give each SplitPane a stable `id` — it's the persistence key. */
export function Split({
  id,
  ...props
}: { id: string } & Omit<ComponentProps<typeof Group>, 'id' | 'defaultLayout' | 'onLayoutChanged'>) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `herdr.split.${id}`,
    onlySaveAfterUserInteractions: true,
  });
  return (
    <Group id={id} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} {...props} />
  );
}

export function SplitPane(props: ComponentProps<typeof Panel>) {
  return <Panel {...props} className={`split-cell ${props.className ?? ''}`} />;
}

/** Drag/keyboard divider. Double-click resets to default sizes. */
export function SplitHandle(props: ComponentProps<typeof Separator>) {
  return <Separator {...props} className="split-handle" />;
}
