"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./Icons";
import { Logo } from "./Brand";
import { CompanySwitcher } from "./CompanySwitcher";
import { createClient } from "@/lib/supabase/client";

const items = [
  { href: "/dashboard",  t: "Dashboard IVA", icon: <Icon.Dashboard /> },
  { href: "/bank",       t: "Conciliación",  icon: <Icon.Bank /> },
  { href: "/accounting", t: "Contabilidad",  icon: <Icon.File /> },
  { href: "/documents",  t: "Documentación", icon: <Icon.Folder /> },
  { href: "/balances",   t: "Balances",      icon: <Icon.File /> },
  { href: "/settings",   t: "Configuración", icon: <Icon.Cog /> }
];

export function Sidebar({ user }: { user: { email: string; name: string; role: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Cerrar drawer al navegar
  useEffect(() => { setOpen(false); }, [pathname]);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Top bar visible solo en mobile */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-white">
        <button
          aria-label="Menú"
          onClick={() => setOpen(true)}
          className="w-10 h-10 -ml-2 rounded-xl flex items-center justify-center hover:bg-[#fafafb] shrink-0"
        >
          <Icon.Menu />
        </button>
        <div className="flex-1 min-w-0">
          <Logo size="sm" subtitle="Panel Contable · esImportar" />
        </div>
      </div>

      {/* Backdrop del drawer */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40"
          style={{ background: "rgba(20,20,25,.35)", backdropFilter: "blur(6px)" }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar/Drawer */}
      <aside
        className={[
          "md:w-[240px] md:shrink-0 md:h-screen md:sticky md:top-0 md:translate-x-0 md:flex md:flex-col md:border-r md:border-line md:z-auto",
          "fixed inset-y-0 left-0 z-50 w-[280px] flex flex-col p-4 border-r border-line transition-transform",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        ].join(" ")}
        style={{ background: "var(--surface-2)" }}
      >
        <div className="flex items-center justify-between md:block">
          <div className="px-2 py-3">
            <Logo size="md" subtitle="esImportar · v1.0" />
          </div>
          <button
            aria-label="Cerrar"
            onClick={() => setOpen(false)}
            className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[#ececf0]"
          >
            <Icon.Close />
          </button>
        </div>
        <div className="px-1 mt-2">
          <CompanySwitcher />
        </div>
        <div className="mt-4 space-y-1">
          {items.map(it => (
            <Link key={it.href} href={it.href} className={`nav-item ${pathname.startsWith(it.href) ? "active" : ""}`}>
              {it.icon}<span>{it.t}</span>
            </Link>
          ))}
        </div>
        <div className="mt-auto">
          <div className="divider my-3" />
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "#ececf0" }}><Icon.User /></div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">{user.name}</div>
              <div className="text-[11px] truncate text-ink-3">{user.email}</div>
            </div>
          </div>
          <button onClick={logout} className="nav-item w-full">
            <Icon.Logout /><span>Cerrar sesión</span>
          </button>
        </div>
      </aside>
    </>
  );
}
