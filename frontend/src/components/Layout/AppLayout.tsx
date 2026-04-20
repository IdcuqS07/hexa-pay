import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function AppLayout() {
  return (
    <div className="app-layout flex min-h-screen bg-slate-950">
      <Sidebar />
      <main className="app-content flex-1">
        <Outlet />
      </main>
    </div>
  );
}
