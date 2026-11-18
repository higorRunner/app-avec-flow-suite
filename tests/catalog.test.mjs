import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const catalog=JSON.parse(readFileSync(new URL('../assets/data/avec-reports.json',import.meta.url)));
const mapping=JSON.parse(readFileSync(new URL('../integrations/avec-report-map.json',import.meta.url)));
test('coleção possui 230 relatórios únicos',()=>{assert.equal(catalog.total,230);assert.equal(catalog.reports.length,230);assert.equal(new Set(catalog.reports.map(r=>r.code)).size,230);});
test('todas as referências dos módulos existem',()=>{const codes=new Set(catalog.reports.map(r=>r.code));assert.equal(Object.keys(mapping.modules).length,9);for(const m of Object.values(mapping.modules))for(const code of m.codes)assert(codes.has(code),code);});
test('campos documentados são somente GET',()=>{for(const r of catalog.reports){assert.equal(r.method,'GET');assert.equal(r.path,`/reports/${r.code}`);}});
