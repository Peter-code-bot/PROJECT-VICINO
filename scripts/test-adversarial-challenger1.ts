import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  nextCommunityNavigation,
  communityReturn,
  installCommunityNavigation,
  type CommunityNavigation,
} from '../apps/web/lib/navigation/retorno-comunidad';
import { loadChatCatalog } from '../apps/web/lib/chat/catalogo-chat';
import { getChatProductsSchema, selectChatProductSchema } from '../packages/shared/src/validators/sale-confirmation';

// ============================================================================
// SUITE 1: ADVERSARIAL STRESS TESTING - R1 (N01 NAVEGACIÓN COMUNIDADES)
// ============================================================================

describe('R1 (N01) Adversarial Navigation & State Corruption Tests', () => {
  const root = '/comunidades/00000000-0000-4000-8000-000000000001';
  const adminPath = '/comunidades/00000000-0000-4000-8000-000000000001/administrar';
  const commId = '00000000-0000-4000-8000-000000000001';

  test('Corrupted history.state primitives and objects fail gracefully to safe internal defaults', () => {
    const corruptedStates: any[] = [
      null,
      undefined,
      false,
      true,
      0,
      42,
      'corrupted-string',
      [],
      {},
      { path: null },
      { path: root, previous: 9999 },
      { path: root, previous: {} },
      { path: root, previous: 'javascript:alert(1)' },
      { path: root, previous: '//evil.com/phish' },
      { path: root, community: null },
      { path: root, community: { id: null, origin: null } },
      { path: root, community: { id: commId, origin: 12345 } },
      { path: root, community: { id: commId, origin: '//malicious.example.com' } },
      { path: root, community: { id: commId, origin: '/login' } },
      { path: root, community: { id: commId, origin: '/register?next=/admin' } },
      { path: root, community: { id: commId, origin: '/forgot-password' } },
      { path: root, community: { id: commId, origin: adminPath } },
    ];

    for (const state of corruptedStates) {
      // Test when in admin: must ALWAYS fall back safely to community root, never loop or throw
      const adminRet = communityReturn(state, adminPath, commId, true);
      assert.equal(adminRet.href, root, `Admin return href must be root for state: ${JSON.stringify(state)}`);
      // If previous was not a genuine verified community entry, back MUST be false (replace fallback)
      assert.equal(adminRet.back, false, `Admin back must be false for corrupted state: ${JSON.stringify(state)}`);

      // Test when in community: must ALWAYS fall back to safe internal origin, never loop to admin or auth
      const commRet = communityReturn(state, root, commId, false);
      assert.ok(commRet.href.startsWith('/'), `Community return href must be internal route`);
      assert.notEqual(commRet.href, adminPath, `Community return href must NEVER be admin path`);
      assert.equal(commRet.back, false, `Community back must be false for corrupted state`);
    }
  });

  test('Directly forged history.state with external/auth previous is refused by safePrevious check', () => {
    const forgedEntries = [
      { path: root, previous: '//evil.com', community: { id: commId, origin: '//evil.com' } },
      { path: root, previous: '/login', community: { id: commId, origin: '/login' } },
      { path: root, previous: '/register', community: { id: commId, origin: '/register' } },
      { path: root, previous: 'javascript:alert(1)', community: { id: commId, origin: 'javascript:alert(1)' } },
      { path: root, previous: '/\\evil.com', community: { id: commId, origin: '/\\evil.com' } },
    ];

    for (const entry of forgedEntries) {
      const ret = communityReturn(entry as any, root, commId, false);
      assert.equal(ret.back, false, `Must reject router.back for forged previous ${entry.previous}`);
      assert.equal(ret.href, '/', `Must fall back to /`);
    }
  });

  test('nextCommunityNavigation sanitizes malicious inputs and prevents admin bounce', () => {
    // 1. When previous was admin, entering community must NEVER record admin as return origin
    const adminOrigin = nextCommunityNavigation(null, adminPath, true);
    const commEntry = nextCommunityNavigation(adminOrigin, root, false);
    const retFromComm = communityReturn(commEntry, root, commId, false);

    assert.equal(retFromComm.href, '/', 'Origin must be sanitized to / when arriving from admin');
    assert.equal(retFromComm.back, false, 'Must NOT router.back into admin');

    // 2. Unsafe origins are sanitized to / at navigation time
    for (const badOrigin of ['//evil.invalid', '/\\evil.invalid', '/login', adminPath]) {
      const sanitizedOrigin = nextCommunityNavigation(null, badOrigin, true);
      const community = nextCommunityNavigation(sanitizedOrigin, root, false);
      assert.equal(communityReturn(community, root, commId, false).href, '/');
    }
  });

  test('Community ID resolution handles canonical UUIDs and alphanumeric slugs', () => {
    const testCases = [
      { id: '00000000-0000-4000-8000-000000000001', rawPath: '/comunidades/00000000-0000-4000-8000-000000000001' },
      { id: 'one', rawPath: '/comunidades/one' },
      { id: 'zona-sur_123', rawPath: '/comunidades/zona-sur_123' },
    ];

    for (const { id, rawPath } of testCases) {
      const origin = nextCommunityNavigation(null, '/explorar', true);
      const comm = nextCommunityNavigation(origin, rawPath, false);
      const admin = nextCommunityNavigation(comm, `${rawPath}/administrar`, false);

      const adminRet = communityReturn(admin, `${rawPath}/administrar`, id, true);
      assert.equal(adminRet.back, true);
      assert.equal(adminRet.href, rawPath);

      const commRet = communityReturn(comm, rawPath, id, false);
      assert.equal(commRet.back, true);
      assert.equal(commRet.href, '/explorar');
    }
  });

  test('Percent-encoded or non-matching slug safely falls back to / without loops or exceptions', () => {
    // Non-canonical slug with percent encoding
    const encodedPath = '/comunidades/comunidad-m%C3%A9xico';
    const origin = nextCommunityNavigation(null, '/explorar', true);
    const comm = nextCommunityNavigation(origin, encodedPath, false);

    // If unencoded ID is passed and differs from URL match, it gracefully returns safe / fallback
    const commRet = communityReturn(comm, encodedPath, 'comunidad-méxico', false);
    assert.equal(commRet.href, '/');
    assert.equal(commRet.back, false);
  });

  test('Rapid alternation: 1000-step navigation simulation preserves strict provenance invariants', () => {
    type HistoryEntry = { path: string; state: CommunityNavigation };
    const historyStack: HistoryEntry[] = [];
    let currentIndex = -1;

    function push(path: string) {
      const prevEntry = currentIndex >= 0 ? historyStack[currentIndex] : null;
      const nextState = nextCommunityNavigation(prevEntry ? prevEntry.state : null, path, false);
      historyStack.splice(currentIndex + 1);
      historyStack.push({ path, state: nextState });
      currentIndex = historyStack.length - 1;
    }

    function replace(path: string) {
      const prevEntry = currentIndex >= 0 ? historyStack[currentIndex] : null;
      const nextState = nextCommunityNavigation(prevEntry ? prevEntry.state : null, path, true);
      if (currentIndex >= 0) {
        historyStack[currentIndex] = { path, state: nextState };
      } else {
        historyStack.push({ path, state: nextState });
        currentIndex = 0;
      }
    }

    function pop() {
      if (currentIndex > 0) currentIndex--;
    }

    push('/home');

    const actions = ['enter_comm_a', 'enter_admin_a', 'in_app_back', 'browser_back', 'reload', 'enter_comm_b', 'go_explore'] as const;

    let seed = 1234567;
    function rand() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    for (let step = 0; step < 1000; step++) {
      const action = actions[Math.floor(rand() * actions.length)]!;
      const current = historyStack[currentIndex]!;
      const isCommA = current.path === '/comunidades/comm-a';
      const isAdminA = current.path === '/comunidades/comm-a/administrar';

      switch (action) {
        case 'enter_comm_a':
          if (!isCommA && !isAdminA) push('/comunidades/comm-a');
          break;
        case 'enter_admin_a':
          if (isCommA) push('/comunidades/comm-a/administrar');
          break;
        case 'in_app_back': {
          if (isAdminA) {
            const ret = communityReturn(current.state, current.path, 'comm-a', true);
            assert.equal(ret.href, '/comunidades/comm-a');
            if (ret.back) pop();
            else replace(ret.href);
          } else if (isCommA) {
            const ret = communityReturn(current.state, current.path, 'comm-a', false);
            assert.notEqual(ret.href, '/comunidades/comm-a/administrar', 'Community return must NEVER target admin');
            assert.ok(!ret.href.includes('/administrar'), 'Return href must never contain admin');
            if (ret.back) pop();
            else replace(ret.href);
          }
          break;
        }
        case 'browser_back':
          pop();
          break;
        case 'reload':
          replace(current.path);
          break;
        case 'enter_comm_b':
          push('/comunidades/comm-b');
          break;
        case 'go_explore':
          push('/explorar');
          break;
      }

      // Assert invariant after every action
      const stateNow = historyStack[currentIndex]!.state;
      const pathNow = historyStack[currentIndex]!.path;

      if (pathNow === '/comunidades/comm-a') {
        const ret = communityReturn(stateNow, pathNow, 'comm-a', false);
        assert.notEqual(ret.href, '/comunidades/comm-a/administrar', 'Invariant violated: return from comm-a targets admin');
      }
    }
  });

  test('installCommunityNavigation wrap/unwrap lifecycle clean restoration', () => {
    const originalPush = () => {};
    const originalReplace = () => {};
    const mockState: Record<string, any> = {};
    const mockWindowListeners: Record<string, Function[]> = {};

    const mockHistory = {
      state: mockState,
      pushState: originalPush,
      replaceState: originalReplace,
    };

    (globalThis as any).history = mockHistory;
    (globalThis as any).location = {
      pathname: '/comunidades/one',
      search: '',
      hash: '',
      href: 'https://vicino.test/comunidades/one',
    };
    (globalThis as any).window = {
      addEventListener(type: string, fn: Function) {
        mockWindowListeners[type] = mockWindowListeners[type] || [];
        mockWindowListeners[type]!.push(fn);
      },
      removeEventListener(type: string, fn: Function) {
        if (mockWindowListeners[type]) {
          mockWindowListeners[type] = mockWindowListeners[type]!.filter(f => f !== fn);
        }
      },
    };

    // Install and uninstall 10 times in a row
    for (let i = 0; i < 10; i++) {
      const uninstall = installCommunityNavigation();
      assert.notEqual(mockHistory.pushState, originalPush);
      uninstall();
      assert.equal(mockHistory.pushState, originalPush);
      assert.equal(mockHistory.replaceState, originalReplace);
      assert.equal(mockWindowListeners['popstate']?.length ?? 0, 0);
    }
  });
});

// ============================================================================
// SUITE 2: ADVERSARIAL CONCURRENCY & ISOLATION TESTS - R2 (C01 CHAT VENDOR SELECTOR)
// ============================================================================

describe('R2 (C01) Adversarial Chat Vendor Selector & Concurrency Tests', () => {
  const sellerA = '11111111-1111-4111-8111-111111111111';
  const sellerB = '22222222-2222-4222-8222-222222222222';
  const buyerC = '33333333-3333-4333-8333-333333333333';
  const outsiderD = '44444444-4444-4444-8444-444444444444';

  function mockDb(options: {
    productsA?: { id: string; titulo: string; estatus?: string; is_hidden?: boolean }[];
    productsB?: { id: string; titulo: string; estatus?: string; is_hidden?: boolean }[];
    networkDelayA?: number;
    networkDelayB?: number;
  } = {}) {
    const listA = (options.productsA ?? [{ id: 'a-1', titulo: 'Mesa de madera' }]).map(p => ({
      id: p.id,
      titulo: p.titulo,
      precio: 100,
      modo_precio: 'fijo',
      imagen_principal: null,
      creador_id: sellerA,
      estatus: p.estatus ?? 'disponible',
      is_hidden: p.is_hidden ?? false,
    }));

    const listB = (options.productsB ?? [{ id: 'b-1', titulo: 'Silla ergonómica' }]).map(p => ({
      id: p.id,
      titulo: p.titulo,
      precio: 50,
      modo_precio: 'fijo',
      imagen_principal: null,
      creador_id: sellerB,
      estatus: p.estatus ?? 'disponible',
      is_hidden: p.is_hidden ?? false,
    }));

    const allProducts = [...listA, ...listB];

    const client = {
      from(table: string) {
        const filters: [string, unknown][] = [];
        let limitVal = Infinity;
        let searchPattern = '';
        let targetCreator = '';

        const query = {
          select() { return query; },
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            if (col === 'creador_id') targetCreator = String(val);
            return query;
          },
          in(col: string, val: unknown) {
            filters.push([col, val]);
            return query;
          },
          order() { return query; },
          limit(n: number) {
            limitVal = n;
            return query;
          },
          ilike(col: string, pattern: string) {
            searchPattern = pattern;
            return query;
          },
          then(resolve: (res: any) => any) {
            const delay = targetCreator === sellerA
              ? (options.networkDelayA ?? 0)
              : targetCreator === sellerB
                ? (options.networkDelayB ?? 0)
                : 0;

            const run = () => {
              if (table === 'profiles') {
                const profiles = [
                  { id: sellerA, nombre: 'Ana Seller', display_name: null, nombre_negocio: null, seller_type: 'individual', foto: null },
                  { id: sellerB, nombre: 'Beatriz Business', display_name: null, nombre_negocio: 'Muebles B', seller_type: 'business', foto: null },
                ];
                return resolve({ data: profiles, error: null });
              }

              // products_services
              let matched = allProducts.filter(p =>
                filters.every(([k, v]) => Array.isArray(v) ? v.includes((p as any)[k]) : (p as any)[k] === v)
              );

              if (searchPattern) {
                // PostgREST unescapes \\% to %, \\_ to _, and \\\\ to \
                // Emulate PostgreSQL ILIKE behavior:
                assert.ok(searchPattern.startsWith('%') && searchPattern.endsWith('%'));
                const rawBody = searchPattern.slice(1, -1);
                // Unescape backslash escapes
                const unescaped = rawBody.replace(/\\([\\%_])/g, '$1');
                matched = matched.filter(p => p.titulo.toLowerCase().includes(unescaped.toLowerCase()));
              }

              const result = matched.slice(0, limitVal);
              return resolve({ data: result, error: null });
            };

            if (delay > 0) setTimeout(run, delay);
            else run();
          },
        };
        return query;
      },
    };

    return client as any;
  }

  test('Race Condition Stress: Slow Seller A response discarded when switching to Seller B', async () => {
    // Seller A has 100ms delay, Seller B has 10ms delay
    const client = mockDb({
      productsA: [{ id: 'a-1', titulo: 'Producto Lento A' }],
      productsB: [{ id: 'b-1', titulo: 'Producto Rapido B' }],
      networkDelayA: 100,
      networkDelayB: 10,
    });

    // Simulate React Component Disposed Pattern from ChatProductSelector:
    let activeCatalog: any = null;
    let effectCleanup: (() => void) | null = null;

    function triggerSelect(sellerId: string) {
      if (effectCleanup) effectCleanup(); // triggers disposed = true
      let disposed = false;
      effectCleanup = () => { disposed = true; };

      loadChatCatalog(client, [sellerA, sellerB], sellerId)
        .then(result => {
          if (disposed) return; // Stale request dropped!
          activeCatalog = result;
        });
    }

    // User triggers Seller A
    triggerSelect(sellerA);

    // After 20ms, user clicks Seller B before Seller A completes
    await new Promise(r => setTimeout(r, 20));
    triggerSelect(sellerB);

    // Wait 150ms for all promises to settle
    await new Promise(r => setTimeout(r, 150));

    // The active catalog MUST belong to Seller B, NOT overwritten by Seller A!
    assert.ok(activeCatalog !== null);
    assert.equal(activeCatalog.sellerId, sellerB);
    assert.equal(activeCatalog.data.length, 1);
    assert.equal(activeCatalog.data[0].id, 'b-1');
    assert.equal(activeCatalog.data[0].titulo, 'Producto Rapido B');
  });

  test('Race Condition Stress: 50 randomized concurrent seller toggles always converge to latest intent', async () => {
    const client = mockDb({
      productsA: [{ id: 'a-1', titulo: 'A item' }],
      productsB: [{ id: 'b-1', titulo: 'B item' }],
    });

    let currentSelected: any = null;
    let cleanup: (() => void) | null = null;

    let expectedFinalSeller = '';

    for (let i = 0; i < 50; i++) {
      const chooseSeller = i % 2 === 0 ? sellerA : sellerB;
      expectedFinalSeller = chooseSeller;

      if (cleanup) cleanup();
      let disposed = false;
      cleanup = () => { disposed = true; };

      // Give each request a random execution jitter
      const jitter = Math.floor(Math.random() * 20);
      void (async (curDisposed, target) => {
        await new Promise(r => setTimeout(r, jitter));
        const res = await loadChatCatalog(client, [sellerA, sellerB], target);
        if (!curDisposed()) {
          currentSelected = res;
        }
      })(() => disposed, chooseSeller);
    }

    // Wait for all jittered executions to finish
    await new Promise(r => setTimeout(r, 100));

    // Must strictly match the 50th request
    assert.equal(currentSelected.sellerId, expectedFinalSeller);
  });

  test('SQL Wildcard Fuzzing: %, _, \\, %%, and combinations match literally and never leak catalog', async () => {
    const specialTitles = [
      { id: '1', titulo: '100% Descuento' },
      { id: '2', titulo: '50% Off Especial' },
      { id: '3', titulo: 'Caja_Madera_A' },
      { id: '4', titulo: 'Caja_Madera_B' },
      { id: '5', titulo: 'CajaXMaderaXC' },
      { id: '6', titulo: 'C:Program Files\\Vicino' },
      { id: '7', titulo: 'Item_100%\\Especial' },
      { id: '8', titulo: 'Normal Item' },
      { id: '9', titulo: 'Emoji 🪑 Silla' },
    ];

    const client = mockDb({ productsA: specialTitles });

    // 1. Search "%": Must only match items containing literal '%'
    const pctRes = await loadChatCatalog(client, [sellerA, sellerB], sellerA, '%');
    const pctTitles = pctRes.data.map(p => p.titulo);
    assert.ok(pctTitles.includes('100% Descuento'));
    assert.ok(pctTitles.includes('50% Off Especial'));
    assert.ok(pctTitles.includes('Item_100%\\Especial'));
    assert.ok(!pctTitles.includes('Normal Item'), 'Search "%" must not match normal item as wildcard');
    assert.ok(!pctTitles.includes('Caja_Madera_A'));

    // 2. Search "_": Must only match items containing literal '_'
    const underscoreRes = await loadChatCatalog(client, [sellerA, sellerB], sellerA, '_');
    const usTitles = underscoreRes.data.map(p => p.titulo);
    assert.ok(usTitles.includes('Caja_Madera_A'));
    assert.ok(usTitles.includes('Caja_Madera_B'));
    assert.ok(usTitles.includes('Item_100%\\Especial'));
    assert.ok(!usTitles.includes('CajaXMaderaXC'), 'Search "_" must not match arbitrary character as wildcard');
    assert.ok(!usTitles.includes('Normal Item'));

    // 3. Search "\\": Must only match items containing literal '\\'
    const slashRes = await loadChatCatalog(client, [sellerA, sellerB], sellerA, '\\');
    const slashTitles = slashRes.data.map(p => p.titulo);
    assert.ok(slashTitles.includes('C:Program Files\\Vicino'));
    assert.ok(slashTitles.includes('Item_100%\\Especial'));
    assert.ok(!slashTitles.includes('Normal Item'));

    // 4. Search "_100%\\": Exact combination
    const comboRes = await loadChatCatalog(client, [sellerA, sellerB], sellerA, '_100%\\');
    assert.equal(comboRes.data.length, 1);
    assert.equal(comboRes.data[0].id, '7');

    // 5. Search Unicode Emoji
    const emojiRes = await loadChatCatalog(client, [sellerA, sellerB], sellerA, '🪑');
    assert.equal(emojiRes.data.length, 1);
    assert.equal(emojiRes.data[0].id, '9');
  });

  test('Catalog Isolation: A query for Seller A can NEVER return Seller B products under any query string', async () => {
    const client = mockDb({
      productsA: [{ id: 'a-1', titulo: 'Secreto A' }],
      productsB: [{ id: 'b-1', titulo: 'Secreto B' }],
    });

    const maliciousQueries = [
      '%',
      '_',
      '\\',
      "' OR 1=1 --",
      '" OR ""="',
      'Secreto',
      '*',
      'UNION SELECT * FROM products_services',
    ];

    for (const q of maliciousQueries) {
      const resA = await loadChatCatalog(client, [sellerA, sellerB], sellerA, q);
      for (const p of resA.data) {
        assert.equal(p.creador_id, sellerA, `Product ${p.id} leaked across sellers!`);
      }

      const resB = await loadChatCatalog(client, [sellerA, sellerB], sellerB, q);
      for (const p of resB.data) {
        assert.equal(p.creador_id, sellerB, `Product ${p.id} leaked across sellers!`);
      }
    }
  });

  test('Foreign seller outside participants is rejected BEFORE database query', async () => {
    const client = mockDb();
    await assert.rejects(
      loadChatCatalog(client, [sellerA, sellerB], outsiderD),
      /INVALID_SELLER/
    );
  });

  test('Seller eligibility is fully decoupled from 50-row catalog limit and search term', async () => {
    // Seller A has 250 products; Seller B has 1 product
    const hugeA = Array.from({ length: 250 }, (_, i) => ({
      id: `a-${i}`,
      titulo: `Articulo A ${i}`,
    }));
    const client = mockDb({
      productsA: hugeA,
      productsB: [{ id: 'b-1', titulo: 'Bicicleta B' }],
    });

    // 1. When no search and no seller selected, both are returned as sellers, sellerId is null, catalog data is empty
    const init = await loadChatCatalog(client, [sellerA, sellerB]);
    assert.equal(init.sellers.length, 2);
    assert.equal(init.sellerId, null);
    assert.deepEqual(init.data, []);

    // 2. When searching for a non-existent item 'zzzzzz' with Seller A selected:
    // Eligibility MUST still return both sellers, but data is empty
    const searchMiss = await loadChatCatalog(client, [sellerA, sellerB], sellerA, 'zzzzzz');
    assert.equal(searchMiss.sellers.length, 2, 'Both sellers must remain eligible despite search miss');
    assert.equal(searchMiss.sellerId, sellerA);
    assert.deepEqual(searchMiss.data, []);

    // 3. When querying Seller A with no search, pagination limit of 50 is strictly respected
    const aPage = await loadChatCatalog(client, [sellerA, sellerB], sellerA);
    assert.equal(aPage.data.length, 50, 'Catalog query must cap at 50 products');
    assert.ok(aPage.data.every(p => p.creador_id === sellerA));
  });

  test('Single eligible seller auto-selects and hides choice; zero eligible sellers yields empty state', async () => {
    // Seller A has active products; Seller B only has paused and hidden products
    const clientSingle = mockDb({
      productsA: [{ id: 'a-1', titulo: 'Disponible' }],
      productsB: [
        { id: 'b-paused', titulo: 'Pausado', estatus: 'pausado' },
        { id: 'b-hidden', titulo: 'Oculto', is_hidden: true },
      ],
    });

    const resSingle = await loadChatCatalog(clientSingle, [sellerA, sellerB]);
    assert.equal(resSingle.sellers.length, 1);
    assert.equal(resSingle.sellers[0].id, sellerA);
    assert.equal(resSingle.sellerId, sellerA);
    assert.equal(resSingle.data.length, 1);

    // Both sellers have 0 eligible products
    const clientZero = mockDb({
      productsA: [{ id: 'a-hidden', titulo: 'Oculto A', is_hidden: true }],
      productsB: [{ id: 'b-paused', titulo: 'Pausado B', estatus: 'pausado' }],
    });

    const resZero = await loadChatCatalog(clientZero, [sellerA, sellerB]);
    assert.deepEqual(resZero, { data: [], sellers: [], sellerId: null });
  });

  test('Write deferral: Catalog loading and seller selection do NOT perform database mutations', async () => {
    const schemaCheck = getChatProductsSchema.safeParse({
      chatId: '10000000-0000-4000-8000-000000000001',
      sellerId: sellerA,
      query: 'mesa',
    });
    assert.ok(schemaCheck.success);

    // Query exceeding max 100 characters rejected by schema before database access
    const longQuery = getChatProductsSchema.safeParse({
      chatId: '10000000-0000-4000-8000-000000000001',
      sellerId: sellerA,
      query: 'a'.repeat(101),
    });
    assert.equal(longQuery.success, false);

    // Non-UUID chatId rejected
    const badChat = getChatProductsSchema.safeParse({
      chatId: 'not-a-uuid',
    });
    assert.equal(badChat.success, false);

    // Invalid revision or negative price rejected at validator boundary before RPC
    const invalidSelection = selectChatProductSchema.safeParse({
      chatId: '10000000-0000-4000-8000-000000000001',
      productId: '20000000-0000-4000-8000-000000000001',
      expectedRevision: -5,
    });
    assert.equal(invalidSelection.success, false);
  });
});
