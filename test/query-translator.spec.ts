import 'reflect-metadata';
import { DataSource, Repository } from 'typeorm';
import { Product } from '../src/example/product.entity';
import { Category } from '../src/example/category.entity';
import { BaseService } from '../src/base/base.service';
import { TypeormQueryTranslator } from '../src/query/typeorm.translator';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config/rest-generic.config';
import { DataResult } from '../src/interfaces/service-result.interface';

class ProductSvc extends BaseService<Product> {}

/**
 * Regression coverage for the query translator: same-column conjunctions,
 * nested relation sub-filters, and the relation whitelist on `orderby`.
 */
describe('nest-rest-generic-typeorm · TypeormQueryTranslator', () => {
  let ds: DataSource;
  let repo: Repository<Product>;
  let products: ProductSvc;
  let translator: TypeormQueryTranslator<Product>;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [Product, Category],
      synchronize: true,
    });
    await ds.initialize();
    repo = ds.getRepository(Product);
    const categories = ds.getRepository(Category);
    products = new ProductSvc(repo, DEFAULT_CONFIG);
    translator = new TypeormQueryTranslator(repo, DEFAULT_CONFIG);

    const electronics = await categories.save(categories.create({ name: 'Electronics', parent_id: null }));
    const phones = await categories.save(categories.create({ name: 'Phones', parent_id: electronics.id }));
    const garden = await categories.save(categories.create({ name: 'Garden', parent_id: null }));

    await repo.save([
      repo.create({ name: 'iPhone', price: 999, status: 'active', category_id: phones.id }),
      repo.create({ name: 'Pixel', price: 799, status: 'active', category_id: phones.id }),
      repo.create({ name: 'Cheap Phone', price: 49, status: 'inactive', category_id: phones.id }),
      repo.create({ name: 'Hose', price: 20, status: 'active', category_id: garden.id }),
    ]);
  });

  afterAll(async () => ds.destroy());

  describe('same-column conjunctions', () => {
    it('keeps both bounds of a range filter on one column', async () => {
      const res = (await products.list_all({
        oper: { and: ['price|>=|100', 'price|<=|800'] },
      })) as DataResult<Product[]>;
      expect(res.data.map((p) => p.name)).toEqual(['Pixel']);
    });

    it('keeps three conditions on the same column', async () => {
      const res = (await products.list_all({
        oper: { and: ['price|>|10', 'price|<|1000', 'price|!=|799'] },
      })) as DataResult<Product[]>;
      expect(res.data.map((p) => p.name).sort()).toEqual(['Cheap Phone', 'Hose', 'iPhone']);
    });

    it('combines the legacy attr equality with an oper condition on the same column', async () => {
      const where = translator.buildWhere({
        oper: { and: ['status|!=|inactive'] },
        attr: { status: 'active' },
      } as never);
      const res = (await products.list_all({
        oper: { and: ['status|!=|inactive'] },
        attr: { status: 'active' },
      })) as DataResult<Product[]>;
      expect(where).toBeDefined();
      expect(res.data.every((p) => p.status === 'active')).toBe(true);
      expect(res.data).toHaveLength(3);
    });

    it('merges two sub-filters that target the same relation', async () => {
      const res = (await products.list_all({
        oper: {
          and: [{ category: { and: ['name|=|Phones'] } }, { category: { and: ['id|>|0'] } }],
        },
      })) as DataResult<Product[]>;
      expect(res.data.map((p) => p.name).sort()).toEqual(['Cheap Phone', 'Pixel', 'iPhone']);
    });

    it('still distributes OR correctly', async () => {
      const res = (await products.list_all({
        oper: { and: ['status|=|active', { or: ['price|<|100', 'price|>|900'] }] },
      })) as DataResult<Product[]>;
      expect(res.data.map((p) => p.name).sort()).toEqual(['Hose', 'iPhone']);
    });
  });

  describe('nested relation sub-filters', () => {
    it('resolves a second-level relation against its own entity metadata', async () => {
      const res = (await products.list_all({
        oper: { category: { parent: { and: ['name|=|Electronics'] } } },
      })) as DataResult<Product[]>;
      expect(res.data.map((p) => p.name).sort()).toEqual(['Cheap Phone', 'Pixel', 'iPhone']);
    });

    it('joins only the base relation of a nested filter', () => {
      // TypeORM resolves the deeper chain of a nested `where` itself; adding the
      // full path would eager-load unrequested relations and break self-references.
      const relations = translator.buildRelations({
        oper: { category: { parent: { and: ['name|=|Electronics'] } } },
      } as never);
      expect(relations).toEqual({ category: {} });
    });

    it('collects relation paths nested inside an and/or block', () => {
      const relations = translator.buildRelations({
        oper: { and: [{ or: [{ category: { and: ['name|=|Phones'] } }] }] },
      } as never);
      expect(relations).toEqual({ category: {} });
    });

    it('still rejects a relation missing from the whitelist', async () => {
      await expect(
        products.list_all({ oper: { supplier: { and: ['name|=|x'] } } }),
      ).rejects.toThrow(/not allowed for filtering/);
    });
  });

  describe('orderby relation whitelist', () => {
    it('orders by a whitelisted relation field', async () => {
      const res = (await products.list_all({
        orderby: [{ 'category.name': 'asc' }],
      })) as DataResult<Product[]>;
      expect(res.data).toHaveLength(4);
    });

    it('rejects ordering by a relation absent from RELATIONS', () => {
      expect(() => translator.buildOrder([{ 'supplier.secret': 'desc' }] as never)).toThrow(
        /not allowed for ordering/,
      );
    });

    it('rejects ordering by a whitelisted name that is not a real relation', () => {
      const relaxed = new TypeormQueryTranslator(repo, {
        ...DEFAULT_CONFIG,
        filtering: { ...DEFAULT_CONFIG.filtering, strictRelations: false },
      });
      expect(() => relaxed.buildOrder([{ 'nope.secret': 'desc' }] as never)).toThrow(
        /does not exist on Product/,
      );
    });

    it('leaves plain column ordering untouched', () => {
      expect(translator.buildOrder([{ price: 'desc' }] as never)).toEqual({ price: 'DESC' });
    });
  });

  describe('mergeConfig', () => {
    it('keeps default per-method TTLs when one is overridden', () => {
      const cfg = mergeConfig({ cache: { ttlByMethod: { list_all: 120 } } });
      expect(cfg.cache.ttlByMethod).toEqual({ list_all: 120, get_one: 30 });
    });
  });
});
