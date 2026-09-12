// Router/data fixture for the local lab only. No Next server or backend.
import React, { createContext, useContext, useEffect, useMemo, useState, use } from 'react';

const Context = createContext(null);
export const usePathname = () => useContext(Context).path;
export const useSearchParams = () => new URLSearchParams(useContext(Context).search);
export const useRouter = () => useContext(Context).router;
export const useFixtureData = () => use(useContext(Context).data);

export function Provider({ children }) {
  const [state, setState] = useState(() => ({
    path: location.pathname, search: location.search, data: Promise.resolve('Datos simulados listos'),
  }));
  const router = useMemo(() => {
    function navigate(href, refresh = false) {
      const url = new URL(href, location.href);
      if (url.host !== location.host || !['/', '/buscar', '/chat', '/perfil'].includes(url.pathname)) return;
      const delay = Number(document.querySelector('#lab-delay')?.value ?? 800);
      const data = new Promise(resolve => setTimeout(() => resolve('Datos simulados actualizados'), delay));
      if (!refresh) history.pushState(null, '', url.pathname + url.search);
      setState({ path: url.pathname, search: url.search, data });
    }
    return { push: href => navigate(href), refresh: () => navigate(location.href, true), prefetch() {} };
  }, []);
  useEffect(() => {
    const original = history.pushState;
    const update = () => setState(previous => ({ ...previous, path: location.pathname, search: location.search }));
    history.pushState = function (...args) { original.apply(this, args); update(); };
    window.addEventListener('popstate', update);
    return () => { history.pushState = original; window.removeEventListener('popstate', update); };
  }, []);
  return <Context.Provider value={{ ...state, router }}>{children}</Context.Provider>;
}

export function Link({ href, children, prefetch: _prefetch, ...props }) {
  const router = useRouter();
  return <a {...props} href={href} onClick={event => {
    event.preventDefault();
    React.startTransition(() => router.push(href));
  }}>{children}</a>;
}
