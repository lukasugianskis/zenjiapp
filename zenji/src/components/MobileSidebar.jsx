import React from "react";
import { NavLink } from "react-router-dom";

export default function MobileSidebar() {
  const navItems = [
    { path: "/home", icon: "/house.png", label: "Home" },
    { path: "/progress", icon: "/streak.png", label: "Progress" },
    { path: "/packs", icon: "/pack.png", label: "Packs" },
    { path: "/community-packs", icon: "/globe.png", label: "Community" },
    { path: "/chat", icon: "/tutor.png", label: "Chat" },
  ];

  return (
    <nav className="mobile-sidebar" role="navigation" aria-label="Mobile navigation">
      <ul className="mobile-sidebar__nav">
        {navItems.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              aria-label={item.label}
              className={({ isActive }) =>
                `mobile-sidebar__link ${isActive ? "is-active" : ""}`
              }
            >
              <span className="mobile-sidebar__icon" aria-hidden="true">
                <img src={item.icon} alt={item.label} className="mobile-sidebar__img" />
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
