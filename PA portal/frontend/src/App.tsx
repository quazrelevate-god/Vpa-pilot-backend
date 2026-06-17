import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./shared/components/Layout";
import { QueuePage } from "./queue/QueuePage";
import { SchedulerPage } from "./scheduler/SchedulerPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/queue" replace />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/scheduler" element={<SchedulerPage />} />
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Routes>
    </Layout>
  );
}
