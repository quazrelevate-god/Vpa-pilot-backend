// Shared open/close state for the mobile sidebar drawer.
//
// The hamburger button lives in TopBar (rendered per-page inside the layout's
// children) while the drawer itself is the Sidebar (a sibling of children in
// the dashboard layout). They're far apart in the tree, so a tiny external
// store — read via useSyncExternalStore — lets both sides share one boolean
// without threading a context provider through the layout. Mirrors the
// loading-bar store pattern already used in this codebase.

type Listener = () => void;

let open = false;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function set(v: boolean) {
  if (open === v) return;
  open = v;
  emit();
}

export function openSidebar() {
  set(true);
}
export function closeSidebar() {
  set(false);
}
export function toggleSidebar() {
  set(!open);
}

export function subscribeSidebar(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getSidebarSnapshot(): boolean {
  return open;
}
