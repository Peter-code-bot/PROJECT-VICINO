// Challenger 2 Adversarial Stress Test Suite for R3 (V01)
// Rigorous verification of SellLink burst handling, synthetic bridge events,
// and NavigationPrefetch network/gate/rate-limiting contracts.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const esbuild = require(require.resolve('esbuild', { paths: [require.resolve('tsx')] }));
const { chromium } = require('@playwright/test');
const web = fileURLToPath(new URL('../apps/web', import.meta.url));

console.log('Building bundle for NavigationPrefetch adversarial testing...');

const prefetchBundle = await esbuild.build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { NavigationPrefetch } from './components/layout/navigation-prefetch';

      window.renderPrefetch = (auth, seller, pathname = '/') => {
        window.__currentPathname = pathname;
        if (!window.__root) {
          window.__root = createRoot(document.getElementById('root'));
        }
        window.__root.render(<NavigationPrefetch authenticated={auth} isVendedor={seller} />);
      };
    `,
    resolveDir: web,
    loader: 'tsx',
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  jsx: 'automatic',
  tsconfig: web + '/tsconfig.json',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'router-boundary',
    setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'router', namespace: 'fake' }));
      build.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
        contents: `
          const router = {
            prefetch: (href, options) => {
              if (window.__throwOnPrefetch) {
                throw new Error('Simulated prefetch network failure');
              }
              window.calls.push({ href, kind: options?.kind, time: performance.now() });
              if (window.__triggerInvalidateImmediate && options?.onInvalidate) {
                options.onInvalidate();
              }
              if (options?.onInvalidate) {
                window.__registeredInvalidators = window.__registeredInvalidators || [];
                window.__registeredInvalidators.push(options.onInvalidate);
              }
            }
          };
          export const useRouter = () => router;
          export const usePathname = () => window.__currentPathname || '/';
        `
      }));
    }
  }]
});

console.log('Building bundle for SellLink burst testing...');

const sellLinkBundle = await esbuild.build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { SellLink } from './components/layout/sell-link';

      window.renderSellLink = () => {
        const root = createRoot(document.getElementById('root'));
        root.render(
          <SellLink id="nav-vender">
            <span>Vender</span>
          </SellLink>
        );
      };
    `,
    resolveDir: web,
    loader: 'tsx',
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  jsx: 'automatic',
  tsconfig: web + '/tsconfig.json',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'haptics-mock',
      setup(build) {
        build.onResolve({ filter: /@\/lib\/haptics/ }, () => ({ path: 'haptics', namespace: 'haptics-mock' }));
        build.onLoad({ filter: /.*/, namespace: 'haptics-mock' }, () => ({
          contents: `
            export const hapticLight = async () => {
              window.__hapticCalls = (window.__hapticCalls || 0) + 1;
            };
          `
        }));
      }
    },
    {
      name: 'next-link-mock',
      setup(build) {
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'link-mock' }));
        build.onLoad({ filter: /.*/, namespace: 'link-mock' }, () => ({
          resolveDir: web,
          loader: 'tsx',
          contents: `
            import React, { createContext, useContext, useState } from 'react';
            
            const LinkStatusContext = createContext({ pending: false });
            export const useLinkStatus = () => useContext(LinkStatusContext);

            export default function Link({ children, href, prefetch, onClick, onNavigate, ...rest }) {
              const [pending, setPending] = useState(false);
              window.__finishPending = () => {
                setPending(false);
                window.__navigationFinishedCount = (window.__navigationFinishedCount || 0) + 1;
              };

              const handleClick = (e) => {
                e.preventDefault();
                window.__linkClickEvents = (window.__linkClickEvents || 0) + 1;
                if (onClick) onClick(e);

                let prevented = false;
                const fakeNavEvent = {
                  preventDefault: () => {
                    prevented = true;
                    window.__navPreventedCount = (window.__navPreventedCount || 0) + 1;
                  }
                };

                if (onNavigate) {
                  onNavigate(fakeNavEvent);
                }

                if (!prevented) {
                  window.__navigationCommitCount = (window.__navigationCommitCount || 0) + 1;
                  setPending(true);
                }
              };

              return (
                <LinkStatusContext.Provider value={{ pending }}>
                  <a href={href} onClick={handleClick} data-prefetch-prop={String(prefetch)} {...rest}>
                    {children}
                  </a>
                </LinkStatusContext.Provider>
              );
            }
          `
        }));
      }
    }
  ]
});

const browser = await chromium.launch();
const testResults = [];

function record(name, pass, details = '') {
  testResults.push({ name, pass, details });
  console.log(pass ? `[PASS] ${name}` : `[FAIL] ${name}: ${details}`);
  if (!pass) throw new Error(`Test failed: ${name} - ${details}`);
}

try {
  // ==========================================
  // SECTION 1: SellLink Burst & Synthetic Events
  // ==========================================
  console.log('\n--- Section 1: SellLink Burst & iOS Synthetic Bridge Events ---');
  {
    const page = await browser.newPage();
    page.on('pageerror', err => console.error('PAGE ERROR:', err));
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('https://fixture.invalid');
    await page.addScriptTag({ content: sellLinkBundle.outputFiles[0].text });
    await page.evaluate(() => window.renderSellLink());

    const link = page.locator('#nav-vender');
    await link.waitFor();

    // 1.1 Attribute verification: href and prefetch=false
    const href = await link.getAttribute('href');
    const prefetchProp = await link.getAttribute('data-prefetch-prop');
    const sellPrefetchAttr = await link.getAttribute('data-sell-prefetch');
    record('SellLink: correct href /vender', href === '/vender', `href was ${href}`);
    record('SellLink: prefetch is explicitly false', prefetchProp === 'false', `prefetch was ${prefetchProp}`);
    record('SellLink: data-sell-prefetch is true', sellPrefetchAttr === 'true', `attr was ${sellPrefetchAttr}`);

    // 1.2 Burst click test: simulate rapid iOS synthetic clicks (3 clicks in 2ms)
    const burstResult = await link.evaluate(el => {
      window.__linkClickEvents = 0;
      window.__navPreventedCount = 0;
      window.__navigationCommitCount = 0;
      window.__hapticCalls = 0;

      // 3 clicks simulating iOS Capacitor bridge duplicate click event
      el.click();
      el.click();
      el.click();

      return {
        clicks: window.__linkClickEvents,
        prevented: window.__navPreventedCount,
        commits: window.__navigationCommitCount,
        haptics: window.__hapticCalls,
      };
    });

    record('Burst clicks: 3 clicks received', burstResult.clicks === 3, `clicks=${burstResult.clicks}`);
    record('Burst clicks: exactly 1 navigation committed', burstResult.commits === 1, `commits=${burstResult.commits}`);
    record('Burst clicks: 2 duplicate clicks prevented', burstResult.prevented === 2, `prevented=${burstResult.prevented}`);
    record('Burst clicks: haptic fired on clicks', burstResult.haptics === 3, `haptics=${burstResult.haptics}`);

    // 1.3 Visual feedback badge accessibility & role while pending
    console.log('DOM after burst click:', await page.evaluate(() => document.body.innerHTML));
    const feedback = page.locator('[data-navigation-feedback="sell"]');
    await feedback.waitFor({ state: 'attached', timeout: 3000 });
    const role = await feedback.getAttribute('role');
    const text = await feedback.textContent();
    record('Feedback badge: has role="status"', role === 'status', `role=${role}`);
    record('Feedback badge: has text "Abriendo publicación…"', text?.includes('Abriendo publicación…') === true, `text=${text}`);

    // 1.4 Click while still pending should be blocked
    const midPendingClick = await link.evaluate(el => {
      window.__navigationCommitCount = 0;
      window.__navPreventedCount = 0;
      el.click();
      return {
        commits: window.__navigationCommitCount,
        prevented: window.__navPreventedCount
      };
    });
    record('Click while pending: blocked from starting another navigation', midPendingClick.commits === 0 && midPendingClick.prevented === 1);

    // 1.5 Finish pending transition and verify cleanup
    await page.evaluate(() => window.__finishPending());
    await page.waitForTimeout(50);
    const feedbackCountAfter = await page.locator('[data-navigation-feedback="sell"]').count();
    record('Feedback badge: cleaned up after navigation ends', feedbackCountAfter === 0, `count=${feedbackCountAfter}`);

    // 1.6 Click again after completion should be allowed
    const subsequentClick = await link.evaluate(el => {
      window.__navigationCommitCount = 0;
      window.__navPreventedCount = 0;
      el.click();
      return {
        commits: window.__navigationCommitCount,
        prevented: window.__navPreventedCount
      };
    });
    record('Subsequent navigation: allowed after previous finished', subsequentClick.commits === 1 && subsequentClick.prevented === 0);

    await page.close();
  }

  // ==========================================
  // SECTION 2: Prefetch Security & Network Boundaries
  // ==========================================
  console.log('\n--- Section 2: Prefetch Security & Network Boundaries ---');

  const boundaryCases = [
    { label: 'Save-Data active', fixture: { auth: true, seller: true, saveData: true }, expected: 0 },
    { label: 'Connection 2G', fixture: { auth: true, seller: true, effectiveType: '2g' }, expected: 0 },
    { label: 'Connection slow-2g', fixture: { auth: true, seller: true, effectiveType: 'slow-2g' }, expected: 0 },
    { label: 'Device offline', fixture: { auth: true, seller: true, offline: true }, expected: 0 },
    { label: 'Document visibility hidden', fixture: { auth: true, seller: true, hidden: true }, expected: 0 },
    { label: 'Document visibility prerender', fixture: { auth: true, seller: true, prerender: true }, expected: 0 },
    { label: 'Unauthenticated guest', fixture: { auth: false, seller: false }, expected: 0 },
    { label: 'Unauthenticated claiming seller', fixture: { auth: false, seller: true }, expected: 0 },
    { label: 'Authenticated buyer (non-seller)', fixture: { auth: true, seller: false }, expected: 0 },
    { label: 'Missing navigator.connection (Safari/WebKit fallback)', fixture: { auth: true, seller: true, noConnection: true }, expected: 1 },
    { label: 'Legitimate authenticated seller on 4G', fixture: { auth: true, seller: true, effectiveType: '4g' }, expected: 1 },
  ];

  for (const tc of boundaryCases) {
    const page = await browser.newPage();
    await page.route('**/*', r => r.fulfill({
      contentType: 'text/html',
      body: '<div id="root"></div><a data-sell-prefetch href="/vender">Vender</a><a data-tab-prefetch href="/chat">Chat</a>'
    }));
    await page.goto('https://fixture.invalid');

    await page.evaluate(f => {
      window.calls = [];
      Object.defineProperty(navigator, 'onLine', { value: !f.offline, configurable: true });
      if (f.noConnection) {
        Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
      } else {
        Object.defineProperty(navigator, 'connection', {
          value: { saveData: f.saveData, effectiveType: f.effectiveType },
          configurable: true
        });
      }
      const vis = f.hidden ? 'hidden' : f.prerender ? 'prerender' : 'visible';
      Object.defineProperty(document, 'visibilityState', { value: vis, configurable: true });
    }, tc.fixture);

    await page.addScriptTag({ content: prefetchBundle.outputFiles[0].text });
    await page.evaluate(f => window.renderPrefetch(f.auth, f.seller, '/'), tc.fixture);

    // Wait for speculative 300ms mount timer
    await page.waitForTimeout(400);

    // Also dispatch pointerover on the sell link
    await page.locator('a[data-sell-prefetch]').evaluate(el => {
      for (let i = 0; i < 5; i++) {
        el.dispatchEvent(new Event('pointerover', { bubbles: true }));
      }
    });

    const venderCalls = await page.evaluate(() => window.calls.filter(c => c.href === '/vender'));
    record(`Prefetch Boundary [${tc.label}]`, venderCalls.length === tc.expected, `got ${venderCalls.length}, expected ${tc.expected}`);
    await page.close();
  }

  // ==========================================
  // SECTION 3: Rate Limiting & Window Deduplication
  // ==========================================
  console.log('\n--- Section 3: Rate Limiting & Window Deduplication ---');
  {
    const page = await browser.newPage();
    await page.route('**/*', r => r.fulfill({
      contentType: 'text/html',
      body: `
        <div id="root"></div>
        <a id="link-vender" data-sell-prefetch href="/vender">Vender</a>
        <a id="link-home" data-tab-prefetch href="/">Inicio</a>
        <a id="link-buscar" data-tab-prefetch href="/buscar">Buscar</a>
        <a id="link-chat" data-tab-prefetch href="/chat">Chat</a>
        <a id="link-perfil" data-tab-prefetch href="/perfil">Perfil</a>
      `
    }));
    await page.goto('https://fixture.invalid');
    await page.evaluate(() => {
      window.calls = [];
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      Object.defineProperty(navigator, 'connection', { value: { effectiveType: '4g' }, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });
    await page.addScriptTag({ content: prefetchBundle.outputFiles[0].text });
    // Mount with seller on /perfil so neighbor is chat, not vender
    await page.evaluate(() => window.renderPrefetch(true, true, '/perfil'));

    // 3.1 50 rapid hovers on /vender: must only trigger 1 prefetch
    await page.locator('#link-vender').evaluate(el => {
      for (let i = 0; i < 50; i++) {
        el.dispatchEvent(new Event('pointerover', { bubbles: true }));
        el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      }
    });

    const venderCalls = await page.evaluate(() => window.calls.filter(c => c.href === '/vender'));
    record('Rate limit: 50 rapid hovers on /vender yields exactly 1 prefetch call', venderCalls.length === 1, `got ${venderCalls.length}`);

    // 3.2 Rapid sweep across all available links:
    await page.evaluate(() => {
      for (const id of ['link-home', 'link-buscar', 'link-chat', 'link-perfil', 'link-vender']) {
        document.getElementById(id).dispatchEvent(new Event('pointerover', { bubbles: true }));
      }
    });

    const totalCalls = await page.evaluate(() => window.calls.length);
    record('Rate limit: total requests within 30s window strictly capped <= 4', totalCalls <= 4, `total calls was ${totalCalls}`);
    await page.close();
  }

  // 3.3 Invalidation attack on fresh instance:
  {
    const page = await browser.newPage();
    await page.route('**/*', r => r.fulfill({
      contentType: 'text/html',
      body: '<div id="root"></div><a id="link-vender" data-sell-prefetch href="/vender">Vender</a>'
    }));
    await page.goto('https://fixture.invalid');
    await page.evaluate(() => {
      window.calls = [];
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      Object.defineProperty(navigator, 'connection', { value: { effectiveType: '4g' }, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });
    await page.addScriptTag({ content: prefetchBundle.outputFiles[0].text });
    // Mount on /buscar (not /vender) so href !== pathname
    await page.evaluate(() => window.renderPrefetch(true, true, '/buscar'));
    await page.waitForTimeout(50);

    // Even if onInvalidate is triggered rapidly, the sliding window must NOT exceed 4 requests in 30s!
    const invalidationTest = await page.evaluate(() => {
      window.calls = [];
      window.__triggerInvalidateImmediate = true; // onInvalidate fires immediately

      // Dispatch 15 hovers with instant invalidation
      const link = document.getElementById('link-vender');
      for (let i = 0; i < 15; i++) {
        link.dispatchEvent(new Event('pointerover', { bubbles: true }));
      }
      return window.calls.length;
    });

    record('Invalidation attack: 15 immediate invalidations capped at 4 requests', invalidationTest === 4, `calls was ${invalidationTest}`);
    await page.close();
  }

  // 3.4 Error resilience: router.prefetch throwing should not break future attempts or crash
  {
    const page = await browser.newPage();
    await page.route('**/*', r => r.fulfill({
      contentType: 'text/html',
      body: '<div id="root"></div><a id="link-vender" data-sell-prefetch href="/vender">Vender</a>'
    }));
    await page.goto('https://fixture.invalid');
    await page.evaluate(() => {
      window.calls = [];
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      Object.defineProperty(navigator, 'connection', { value: { effectiveType: '4g' }, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });
    await page.addScriptTag({ content: prefetchBundle.outputFiles[0].text });
    await page.evaluate(() => window.renderPrefetch(true, true, '/buscar'));
    await page.waitForTimeout(50);

    const errorResilience = await page.evaluate(() => {
      window.calls = [];
      window.__triggerInvalidateImmediate = false;
      window.__throwOnPrefetch = true;

      const link = document.getElementById('link-vender');
      let threw = false;
      try {
        link.dispatchEvent(new Event('pointerover', { bubbles: true }));
      } catch (e) {
        threw = true;
      }

      window.__throwOnPrefetch = false;
      // After exception, try again
      link.dispatchEvent(new Event('pointerover', { bubbles: true }));
      return { threw, calls: window.calls.length };
    });

    record('Error resilience: router throw is gracefully swallowed', errorResilience.threw === false, 'threw uncaught error');
    record('Error resilience: prefetch retry works after throw', errorResilience.calls === 1, `calls was ${errorResilience.calls}`);
    await page.close();
  }

  // ==========================================
  // SECTION 4: URL Intent Sanitization & Dirty Links
  // ==========================================
  console.log('\n--- Section 4: URL Intent Sanitization & Dirty Links ---');
  {
    const page = await browser.newPage();
    await page.route('**/*', r => r.fulfill({
      contentType: 'text/html',
      body: `
        <div id="root"></div>
        <!-- Dirty links -->
        <a id="l-query" data-sell-prefetch href="/vender?promo=123">Query</a>
        <a id="l-hash" data-sell-prefetch href="/vender#step2">Hash</a>
        <a id="l-external" data-sell-prefetch href="https://evil.org/vender">External</a>
        <a id="l-download" data-sell-prefetch href="/vender" download>Download</a>
        <a id="l-blank" data-sell-prefetch href="/vender" target="_blank">Target Blank</a>
        <a id="l-noattr" href="/vender">No Attr</a>
        <button id="btn-vender">Button</button>
      `
    }));
    await page.goto('https://fixture.invalid');
    await page.evaluate(() => {
      window.calls = [];
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      Object.defineProperty(navigator, 'connection', { value: { effectiveType: '4g' }, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });
    await page.addScriptTag({ content: prefetchBundle.outputFiles[0].text });
    await page.evaluate(() => window.renderPrefetch(true, true, '/'));

    // Wait for initial timer
    await page.waitForTimeout(400);
    // Clear initial speculative calls
    await page.evaluate(() => { window.calls = []; });

    const dirtyIds = ['l-query', 'l-hash', 'l-external', 'l-download', 'l-blank', 'l-noattr', 'btn-vender'];
    for (const id of dirtyIds) {
      await page.locator(`#${id}`).evaluate(el => el.dispatchEvent(new Event('pointerover', { bubbles: true })));
    }

    const dirtyCalls = await page.evaluate(() => window.calls);
    record('Dirty links: none of the dirty links triggered prefetch', dirtyCalls.length === 0, `dirty calls: ${JSON.stringify(dirtyCalls)}`);

    await page.close();
  }

  console.log('\n==========================================');
  console.log(`ALL ${testResults.length} ADVERSARIAL STRESS TESTS PASSED EMPIRICALLY!`);
  console.log('==========================================');

} finally {
  await browser.close();
}
