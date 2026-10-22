const assert = require('node:assert/strict');
require('reflect-metadata');
const api = require('@charlietyn/nest-rest-typeorm');

assert.equal(typeof api.BaseService, 'function');
assert.equal(typeof api.RestController, 'function');
assert.equal(api.mergeConfig({ cache: { enabled: true } }).cache.enabled, true);
assert.deepEqual(api.parseConditionString('price|>=|10'), { field: 'price', operator: '>=', value: '10' });
assert.throws(() => require('@charlietyn/nest-rest-typeorm/dist/base/base.service'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
for (const dependency of ['exceljs', 'pdfkit']) {
  assert.throws(() => require.resolve(dependency), { code: 'MODULE_NOT_FOUND' });
}
Promise.all([
  assert.rejects(api.ExportService.toExcel([], []), /Optional dependency 'exceljs'/),
  assert.rejects(api.ExportService.toPdf([], []), /Optional dependency 'pdfkit'/),
]).catch(error => { console.error(error); process.exitCode = 1; });
