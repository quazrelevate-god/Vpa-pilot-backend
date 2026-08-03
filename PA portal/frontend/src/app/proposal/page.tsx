import App from "./_app/App";

// The Nam Kural proposal site, ported from the standalone Vite app. All of the
// experience lives in the client component tree under ./_app; this route entry
// just mounts it (mirrors the /events route's page.tsx → EventsApp pattern).
export default function ProposalPage() {
  return <App />;
}
