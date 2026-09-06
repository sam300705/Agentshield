import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import { LiveDashboard } from "./components/LiveDashboard";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthGate>{import.meta.env.VITE_APP_MODE === "live" ? <LiveDashboard /> : <App />}</AuthGate>
    </BrowserRouter>
  </React.StrictMode>,
);
