import { NavLink, Outlet } from "react-router-dom";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🚁</span>
          <span className="brand-name">Book My Drone</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end className="nav-link">
            Home
          </NavLink>
          <NavLink to="/book" className="nav-link">
            Book
          </NavLink>
          <NavLink to="/stock" className="nav-link">
            Stock
          </NavLink>
          <NavLink to="/book/new" className="nav-link nav-link--cta">
            + New Booking
          </NavLink>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
