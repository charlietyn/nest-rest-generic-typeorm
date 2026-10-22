import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Controller, Injectable, Inject, Optional } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GenericRestModule, RestController, RgcCacheService, REST_GENERIC_CONFIG, injectParams } from '@charlietyn/nest-rest-typeorm';

class Entity {}
assert.ok(getRepositoryToken(Entity));
class ConfigConsumer {
  constructor(config, cache, absent) { this.config = config; this.cache = cache; this.absent = absent; }
}
Injectable()(ConfigConsumer);
Inject(REST_GENERIC_CONFIG)(ConfigConsumer, undefined, 0);
Inject(RgcCacheService)(ConfigConsumer, undefined, 1);
Inject('ABSENT')(ConfigConsumer, undefined, 2);
Optional()(ConfigConsumer, undefined, 2);
const service = {
  list_all: async params => ({ data: [{ id: 1, name: 'consumer' }], selected: params.select }),
  get_one: async () => ({ data: { id: 1 } }),
  show: async (_params, id) => ({ id }),
};
class ConsumerController extends RestController { constructor() { super(service); } }
Controller('items')(ConsumerController);
const module = await Test.createTestingModule({
  imports: [GenericRestModule.forRoot({ config: { cache: { enabled: true } } })],
  providers: [ConfigConsumer], controllers: [ConsumerController],
}).compile();
const app = module.createNestApplication({ logger: false });
app.use(injectParams({ select: 'id,name' }));
try {
  const consumer = module.get(ConfigConsumer);
  assert.equal(consumer.config.cache.enabled, true);
  assert.equal(consumer.absent, undefined);
  assert.ok(consumer.cache instanceof RgcCacheService);
  await app.listen(0, '127.0.0.1');
  const response = await fetch(`${await app.getUrl()}/items`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: [{ id: 1, name: 'consumer' }], selected: 'id,name' });
  const one = await fetch(`${await app.getUrl()}/items/get/one`);
  assert.equal(one.status, 200);
  assert.deepEqual(await one.json(), { data: { id: 1 } });
} finally { await app.close(); }
