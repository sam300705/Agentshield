import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { Approvals } from "./pages/Approvals";
import { ScanResults } from "./pages/ScanResults";
import { FindingDetail } from "./pages/FindingDetail";

import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import { LiveDashboard } from "./components/LiveDashboard";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthGate>
        {import.meta.env.VITE_APP_MODE === "live" ? (
          <Routes>
            <Route path="/" element={<LiveDashboard />} />
            <Route path="/scans/:scanId" element={<ScanResults />} />
            <Route path="/scans" element={<LiveDashboard />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/scans/:scanId/findings/:findingId" element={<FindingDetail />} />
          </Routes>
        ) : (
          <App />
        )}
      </AuthGate>
    </BrowserRouter>
  </React.StrictMode>,
);
