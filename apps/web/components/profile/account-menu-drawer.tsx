"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  User, Store, BadgeCheck, ShoppingBag, Calendar, Heart, Star,
  Bell, Lock, Sun, Moon, HelpCircle, MessageCircle, FileText,
  Shield, Info, Settings, ChevronRight, X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

interface AccountMenuDrawerProps {
  trigger: React.ReactNode;
  userName?: string;
  userAvatar?: string | null;
  userId?: string;
}

export function AccountMenuDrawer({ trigger, userName, userAvatar, userId }: AccountMenuDrawerProps) {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- next-themes hydration pattern; refactor pendiente como follow-up tecnico
  useEffect(() => setMounted(true), []);

  useBodyScrollLock(open);

  return (
    <>
      <div onClick={() => setOpen(true)}>{trigger}</div>

      {/* Backdrop + Drawer */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[85vw] max-w-sm bg-background border-l border-border flex flex-col animate-slide-in-right">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">Mi cuenta</h2>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* User summary */}
            {userName && (
              <Link href="/perfil" onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-5 py-4 hover:bg-muted transition-colors border-b border-border">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  {userAvatar ? (
                    <img src={userAvatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg font-semibold">{userName[0]?.toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">{userName}</p>
                  {userId && <p className="text-xs text-muted-foreground">@{userId}</p>}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </Link>
            )}

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)_+_5rem)]">
              <Section label="Cuenta">
                <Item href="/perfil/editar" icon={User} label="Editar perfil" onClose={() => setOpen(false)} />
                <Item href="/seller" icon={Store} label="Mi tienda" onClose={() => setOpen(false)} />
                <Item href="/seller/verificacion" icon={BadgeCheck} label="Verificación" onClose={() => setOpen(false)} />
              </Section>

              <Section label="Actividad">
                <Item href="/historial" icon={ShoppingBag} label="Compras y ventas" onClose={() => setOpen(false)} />
                <Item href="/citas" icon={Calendar} label="Mis citas" onClose={() => setOpen(false)} />
                <Item href="/favoritos" icon={Heart} label="Favoritos" onClose={() => setOpen(false)} />
              </Section>

              <Section label="Configuración">
                <Item href="/configuracion" icon={Settings} label="Configuración" onClose={() => setOpen(false)} />
                {/* Theme toggle inline */}
                <div className="flex items-center gap-3 px-5 py-3 hover:bg-muted transition-colors">
                  {mounted && theme === "dark" ? <Moon className="w-5 h-5 text-foreground shrink-0" /> : <Sun className="w-5 h-5 text-foreground shrink-0" />}
                  <span className="flex-1 text-foreground text-sm">Modo oscuro</span>
                  {mounted && (
                    <button
                      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                      className={`w-11 h-6 rounded-full transition-colors relative ${theme === "dark" ? "bg-primary" : "bg-muted"}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${theme === "dark" ? "translate-x-5" : ""}`} />
                    </button>
                  )}
                </div>
              </Section>

              <Section label="Soporte">
                <Item href="/terminos" icon={FileText} label="Términos y condiciones" onClose={() => setOpen(false)} />
                <Item href="/privacidad" icon={Shield} label="Política de privacidad" onClose={() => setOpen(false)} />
                <Item href="/proximamente" icon={HelpCircle} label="Centro de ayuda" onClose={() => setOpen(false)} />
                <Item href="/proximamente" icon={Info} label="Acerca de VICINO" onClose={() => setOpen(false)} />
              </Section>
            </div>

          </div>
        </div>
      )}
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <h3 className="px-5 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</h3>
      {children}
    </div>
  );
}

function Item({ href, icon: Icon, label, onClose }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; onClose: () => void }) {
  return (
    <Link href={href} onClick={onClose}
      className="flex items-center gap-3 px-5 py-3 hover:bg-muted transition-colors text-foreground text-sm">
      <Icon className="w-5 h-5 shrink-0" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
