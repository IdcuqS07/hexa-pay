import { Link, useLocation } from "react-router-dom";

interface MenuItem {
  label: string;
  href: string;
  icon: string;
}

const menuItems: MenuItem[] = [
  {
    label: "Home",
    href: "/",
    icon: "🏠",
  },
  {
    label: "Create Quote",
    href: "/create",
    icon: "➕",
  },
  {
    label: "Private Quotes",
    href: "/private-quotes",
    icon: "🔐",
  },
  {
    label: "Payment Intent Demo",
    href: "/payment-intent-demo",
    icon: "⚡",
  },
];

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside className="app-sidebar flex min-h-screen w-64 flex-col bg-slate-900 border-r border-slate-800">
      <div className="p-6">
        <Link
          to="/"
          className="flex items-center gap-2 text-xl font-bold text-white hover:text-cyan-400 transition-colors"
        >
          <span>🔐</span>
          <span>HexaPay</span>
        </Link>
      </div>

      <nav className="px-3 flex-1">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.href;
          
          return (
            <Link
              key={item.href}
              to={item.href}
              className={`
                flex items-center gap-3 px-4 py-3 mb-1 rounded-lg
                transition-colors
                ${
                  isActive
                    ? "bg-cyan-500/20 text-cyan-400 font-medium"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }
              `}
            >
              <span className="text-xl">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto p-4 border-t border-slate-800">
        <div className="text-xs text-slate-500 text-center">
          <p>Built with Fhenix FHE</p>
          <p className="mt-1">Bootstrap Phase</p>
        </div>
      </div>
    </aside>
  );
}
