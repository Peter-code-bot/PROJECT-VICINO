// Synthetic in-memory PostgREST boundary. No real identities or remote writes.
export function createFixtureClient({ total = 5, failure = '', hidden = false, now = '2026-09-28T12:00:00Z', storage } = {}) {
  const userId = 'synthetic-user';
  const statuses = ['completed', 'completed', 'pending_confirmation', 'cancelled', 'expired'];
  const sales = ['ventas', 'compras'].flatMap(role => Array.from({ length: total }, (_, i) => ({
    id: `${role}-${String(i).padStart(4, '0')}`,
    precio_acordado: 99999999.99, cantidad: 12, status: statuses[i % 5],
    created_at: i % 5 === 1 ? null : now, completed_at: null,
    buyer_id: role === 'compras' ? userId : 'synthetic-buyer',
    seller_id: role === 'ventas' ? userId : 'synthetic-seller', product_id: 'synthetic-product',
    products_services: hidden || i % 5 === 4 ? null : { id: 'synthetic-product', titulo: i % 5 === 2 ? 'ProductoSinEspacios'.repeat(12) : 'Producto de prueba con título largo para comprobar que la información completa se puede leer en ambas pestañas', imagen_principal: null },
    buyer: { nombre: 'Comprador sintético con nombre y apellidos muy largos', trust_level: 'verificado' },
    seller: { nombre: 'VendedorSintéticoSinEspacios'.repeat(5), trust_level: 'estrella' },
  })));
  const reviews = ['ventas', 'compras'].map(role => ({ id: `review-${role}`, sale_confirmation_id: `${role}-0001`, reviewer_id: userId, review_type: role === 'ventas' ? 'seller_to_buyer' : 'buyer_to_seller' }));
  if (storage?.getItem('synthetic-reviews')) reviews.push(...JSON.parse(storage.getItem('synthetic-reviews')));
  const calls = [];
  function from(table) {
    const filters = []; const orders = []; let start = 0; let end = Infinity; let options = {}; let single = false; let insert;
    const query = {
      select(_fields, opts = {}) { options = opts; return this; },
      eq(field, value) { filters.push({ field, value, op: 'eq' }); return this; },
      in(field, value) { filters.push({ field, value, op: 'in' }); return this; },
      gte(field, value) { filters.push({ field, value, op: 'gte' }); return this; },
      lte(field, value) { filters.push({ field, value, op: 'lte' }); return this; },
      order(field, opts) { orders.push({ field, ...opts }); return this; },
      range(a, b) { start = a; end = b; return this; },
      limit(n) { end = n - 1; return this; },
      single() { single = true; return this; },
      maybeSingle() { single = true; return this; },
      insert(row) { insert = row; return this; },
      then(resolve, reject) {
        calls.push({ table, filters, orders, start, end, options });
        const role = filters.find(f => ['seller_id','buyer_id'].includes(f.field))?.field;
        const shouldFail = failure === 'reviews' && table === 'reviews' || failure === 'stats' && options.head || !options.head && table === 'sale_confirmations' && failure === (role === 'seller_id' ? 'ventas' : 'compras');
        if (failure === 'throw') return Promise.reject(new Error('synthetic network failure')).then(resolve, reject);
        if (shouldFail) return Promise.resolve({ data: null, count: null, error: { message: 'synthetic query failure' } }).then(resolve, reject);
        if (insert) {
          if (storage) storage.setItem('synthetic-reviews', JSON.stringify([...JSON.parse(storage.getItem('synthetic-reviews') || '[]'), insert]));
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        let rows = table === 'reviews' ? reviews : table === 'profiles' ? [{ id: 'synthetic-buyer', nombre: 'Comprador sintético' },{ id: 'synthetic-seller', nombre: 'Vendedor sintético' }] : sales;
        rows = rows.filter(row => filters.every(({ field, value, op }) => op === 'eq' ? row[field] === value : op === 'in' ? value.includes(row[field]) : row[field] !== null && (op === 'gte' ? Date.parse(row[field]) >= Date.parse(value) : Date.parse(row[field]) <= Date.parse(value))));
        const count = options.count ? rows.length : null;
        if (options.count && !options.head && start > 0 && start >= rows.length) {
          return Promise.resolve({ data: null, count: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }).then(resolve, reject);
        }
        rows = [...rows].sort((a,b) => {
          for (const { field, ascending, nullsFirst = false } of orders) {
            if (a[field] === b[field]) continue;
            if (a[field] === null) return nullsFirst ? -1 : 1;
            if (b[field] === null) return nullsFirst ? 1 : -1;
            return (a[field] < b[field] ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        }).slice(start,end+1);
        return Promise.resolve({ data: options.head ? null : single ? rows[0] ?? null : rows, count, error: null }).then(resolve,reject);
      },
    };
    return query;
  }
  return { auth: { getUser: async () => ({ data: { user: { id: userId } } }) }, from, calls, sales };
}
