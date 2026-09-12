import React, { Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, Link, usePathname, useFixtureData } from './router.jsx';
import { PageSwipeWrapper } from '../../apps/web/components/layout/page-swipe-wrapper';
import { PullToRefreshWrapper } from '../../apps/web/components/layout/pull-to-refresh-wrapper';
import { HomeCategoryOrder } from '../../apps/web/components/home/home-category-order';
import { SkeletonLista } from '../../apps/web/components/shared/loading-skeletons';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';

const tabs = [['/', 'Inicio'], ['/buscar', 'Buscar'], ['/chat', 'Chat'], ['/perfil', 'Perfil']];
const products = [['Mochila verde', '$450'], ['Camisa de lino', '$320'], ['Pan artesanal', '$80']];

function Cards({ category }) {
  return <section data-row={category}><h2>{category}</h2>
    <div className="lab-carousel">{products.map(([name, price], index) => <article key={name}>
      <div className="lab-photo" aria-hidden="true">{['🎒', '👕', '🥖'][index]}</div>
      <h3>{name}</h3><p>{price} MXN</p><small>Publicación simulada</small>
    </article>)}</div>
    <label>Nota de {category}<input aria-label={`Nota de ${category}`} placeholder="Escribe y cambia el orden" /></label>
  </section>;
}

function Content() {
  const path = usePathname();
  const data = useFixtureData();
  const [messages, setMessages] = useState(['Hola, ¿sigue disponible?', 'Sí, podemos acordar la entrega.']);
  const [draft, setDraft] = useState('');
  return <main data-testid="lab-content">
    <h1>{tabs.find(([href]) => href === path)?.[1] ?? 'Inicio'}</h1>
    <p className="lab-status">{data}</p>
    {path === '/' && <HomeCategoryOrder
      rows={['Ropa', 'Comida'].map(name => ({ slug: name.toLowerCase(), name, content: <Cards category={name} /> }))}
      intro={<p className="lab-hint">Desliza para cambiar de pestaña. Arrastra hacia abajo desde el inicio para actualizar.</p>}
      recent={<Cards category="Recientes" />} tail={<p>Fin de los datos simulados.</p>} empty={null} />}
    {path === '/buscar' && <><label>Buscar en la muestra<input placeholder="Mochila, camisa, pan…" /></label><Cards category="Resultados de muestra" /></>}
    {path === '/chat' && <><ul>{messages.map((message, index) => <li key={index}>{message}</li>)}</ul>
      <form onSubmit={event => { event.preventDefault(); if (draft.trim()) { setMessages([...messages, draft]); setDraft(''); } }}>
        <label>Mensaje simulado<input value={draft} onChange={event => setDraft(event.target.value)} /></label>
        <button type="submit">Enviar a la muestra</button>
      </form></>}
    {path === '/perfil' && <><h2>María · Cuenta de muestra</h2><label>Nombre de muestra<input defaultValue="María" /></label>
      <p>Los datos de esta página se descartan al recargar.</p><Cards category="Mis publicaciones" /></>}
    <div className="lab-scroll">Zona para comprobar desplazamiento vertical</div>
  </main>;
}

function Lab() {
  return <Provider><header>
    <strong>VICINO · Prueba local</strong><p>Datos simulados · fluidez</p>
    <label>Espera simulada <select id="lab-delay" defaultValue="800">
      <option value="100">100 ms</option><option value="800">800 ms</option><option value="2500">2.5 s</option>
    </select></label>
    <button onClick={() => document.documentElement.classList.toggle('dark')}>Cambiar tema</button>
  </header><Suspense fallback={<SkeletonLista n={3} />}>
    <PullToRefreshWrapper><PageSwipeWrapper isVendedor={false}><Content /></PageSwipeWrapper></PullToRefreshWrapper>
  </Suspense><nav aria-label="Pestañas">{tabs.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</nav></Provider>;
}

createRoot(document.getElementById('root')).render(<Lab />);
if (Capacitor.isNativePlatform()) requestAnimationFrame(() => { void SplashScreen.hide().catch(console.error); });
