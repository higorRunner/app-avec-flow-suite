import { AppError } from './security.mjs';

export function database({ url, key, fetchImpl = fetch }) {
  const root = new URL(url);
  if (root.protocol !== 'https:' || root.username || root.password || root.search || root.hash) {
    throw new Error('SUPABASE_URL deve ser uma URL HTTPS.');
  }
  async function request(path, method = 'GET', body, prefer) {
    let response;
    try {
      response = await fetchImpl(new URL('/rest/v1/' + path, root), {
        method, headers: {
          apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
          ...(prefer ? { Prefer: prefer } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000), redirect: 'error',
      });
    } catch {
      throw new AppError('O banco está indisponível. Tente novamente em instantes.', 503);
    }
    if (!response.ok) {
      let code = '';
      try { code = (await response.json()).code || ''; } catch {}
      console.error(`Banco ${method} ${path.split('?')[0]} HTTP ${response.status} ${code}`);
      if (['PGRST202', 'PGRST205', '42P01', '42703'].includes(code)) {
        throw new AppError('O banco precisa ser instalado com o SQL desta versão.', 503);
      }
      if (code === '23505') throw new AppError('Este registro já existe.', 409);
      throw new AppError('Não foi possível concluir a operação no banco.', 503);
    }
    if (response.status === 204) return null;
    const data = await response.text();
    return data ? JSON.parse(data) : null;
  }
  const query = params => new URLSearchParams(params).toString();
  return {
    select: (table, params = {}) => request(table + '?' + query(params)),
    insert: (table, rows) => request(table, 'POST', rows, 'return=representation'),
    update: (table, where, values) => request(table + '?' + query(where), 'PATCH', values, 'return=representation'),
    remove: (table, where) => request(table + '?' + query(where), 'DELETE'),
    upsert: (table, rows, conflict) => request(table + '?' + query({ on_conflict: conflict }),
      'POST', rows, 'resolution=merge-duplicates,return=representation'),
    rpc: (name, args = {}) => request('rpc/' + name, 'POST', args),
    async all(table, params = {}) {
      const rows = [];
      for (let offset = 0; offset < 100000; offset += 500) {
        const page = await this.select(table, { ...params, order: params.order || 'id.asc', offset, limit: 500 });
        rows.push(...page);
        if (page.length < 500) return rows;
      }
      throw new AppError('Consulta excedeu o limite de segurança. Reduza o período.', 400);
    },
  };
}
