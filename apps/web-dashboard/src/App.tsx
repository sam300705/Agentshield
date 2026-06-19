import { Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { Approvals } from "./pages/Approvals";
import { AuditLog } from "./pages/AuditLog";
import { Dashboard } from "./pages/Dashboard";
import { FindingDetail } from "./pages/FindingDetail";
import { ScanResults } from "./pages/ScanResults";
import { Scans } from "./pages/Scans";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="scans" element={<Scans />} />
        <Route path="scans/:scanId" element={<ScanResults />} />
        <Route path="scans/:scanId/findings/:findingId" element={<FindingDetail />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
