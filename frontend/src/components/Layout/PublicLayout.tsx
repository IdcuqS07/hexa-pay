import { Outlet, Link } from "react-router-dom";

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="border-b border-slate-800 bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link
              to="/"
              className="flex items-center gap-2 text-xl font-bold text-white hover:text-cyan-400 transition-colors"
            >
              <span>🔐</span>
              <span>HexaPay</span>
            </Link>

            <div className="flex items-center gap-6">
              <Link
                to="/create"
                className="text-slate-300 hover:text-white transition-colors"
              >
                Create Quote
              </Link>
              <Link
                to="/private-quotes"
                className="text-slate-300 hover:text-white transition-colors"
              >
                Private Quotes
              </Link>
              <a
                href="https://github.com/yourusername/hexapay"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-slate-300 transition-colors"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>
      </nav>

      <main>
        <Outlet />
      </main>

      <footer className="mt-auto border-t border-slate-800 bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-slate-400 text-sm">
            <p>Built with Fhenix FHE • Bootstrap Phase</p>
            <div className="mt-2 flex items-center justify-center gap-4">
              <a
                href="https://docs.fhenix.zone"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Fhenix Docs
              </a>
              <span className="text-slate-600">•</span>
              <a
                href="https://github.com/FhenixProtocol"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Fhenix GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
