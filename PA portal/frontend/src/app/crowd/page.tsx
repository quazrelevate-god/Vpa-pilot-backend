import CrowdApp from "./_components/CrowdApp";

// The floor-operator PWA. Auth is enforced by middleware (display_session) and
// by the backend /crowd/api/* endpoints (401). This is the single app shell.
export default function CrowdPage() {
  return <CrowdApp />;
}
