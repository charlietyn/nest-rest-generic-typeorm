import 'reflect-metadata';
import { DataSource, Repository } from 'typeorm';
import { Product } from '../src/example/product.entity';
import { Category } from '../src/example/category.entity';
import { BaseService } from '../src/base/base.service';
import { DEFAULT_CONFIG } from '../src/config/rest-generic.config';
import { DataResult, PaginatedResult } from '../src/interfaces/service-result.interface';

class ProductSvc extends BaseService<Product> {}
class CategorySvc extends BaseService<Category> {}

describe('nest-rest-generic-typeorm · BaseService', () => {
  let ds: DataSource;
  let productRepo: Repository<Product>;
  let categoryRepo: Repository<Category>;
  let products: ProductSvc;
  let categories: CategorySvc;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [Product, Category],
      synchronize: true,
    });
    await ds.initialize();
    productRepo = ds.getRepository(Product);
    categoryRepo = ds.getRepository(Category);
    products = new ProductSvc(productRepo, DEFAULT_CONFIG);
    categories = new CategorySvc(categoryRepo, DEFAULT_CONFIG);

    const electronics = await categoryRepo.save(categoryRepo.create({ name: 'Electronics', parent_id: null }));
    const phones = await categoryRepo.save(categoryRepo.create({ name: 'Phones', parent_id: electronics.id }));
    await categoryRepo.save(categoryRepo.create({ name: 'Laptops', parent_id: electronics.id }));

    await productRepo.save([
      productRepo.create({ name: 'iPhone', price: 999, status: 'active', category_id: phones.id }),
      productRepo.create({ name: 'Pixel', price: 799, status: 'active', category_id: phones.id }),
      productRepo.create({ name: 'Cheap Phone', price: 49, status: 'inactive', category_id: phones.id }),
    ]);
  });

  afterAll(async () => ds.destroy());

  it('filters with oper (and / >=)', async () => {
    const res = (await products.list_all({ oper: { and: ['price|>=|500'] } })) as DataResult<Product[]>;
    expect(res.data.map((p) => p.name).sort()).toEqual(['Pixel', 'iPhone']);
  });

  it('filters with or', async () => {
    const res = (await products.list_all({
      oper: { or: ['name|=|iPhone', 'name|=|Pixel'] },
    })) as DataResult<Product[]>;
    expect(res.data).toHaveLength(2);
  });

  it('supports in operator', async () => {
    const res = (await products.list_all({ oper: { and: ['status|in|active'] } })) as DataResult<Product[]>;
    expect(res.data).toHaveLength(2);
  });

  it('filters by relation (whereHas style)', async () => {
    const res = (await products.list_all({
      oper: { category: { and: ['name|=|Phones'] } },
      relations: ['category'],
    })) as DataResult<Product[]>;
    expect(res.data).toHaveLength(3);
    expect(res.data[0].category.name).toBe('Phones');
  });

  it('orders results', async () => {
    const res = (await products.list_all({ orderby: [{ price: 'desc' }] })) as DataResult<Product[]>;
    expect(res.data.map((p) => p.name)).toEqual(['iPhone', 'Pixel', 'Cheap Phone']);
  });

  it('paginates', async () => {
    const res = (await products.list_all({ pagination: { page: 1, pageSize: 2 } })) as PaginatedResult<Product>;
    expect(res.data).toHaveLength(2);
    expect(res.total).toBe(3);
    expect(res.last_page).toBe(2);
  });

  it('creates (single) and bumps nothing without cache', async () => {
    const res = await products.create({ name: 'Watch', price: 399, status: 'active' });
    expect(res.success).toBe(true);
  });

  it('creates in bulk via {product: [...]}', async () => {
    const res = await products.create({ product: [{ name: 'A', price: 1 }, { name: 'B', price: 2 }] });
    expect(res.success).toBe(true);
    expect(res.models).toHaveLength(2);
  });

  it('updates by id', async () => {
    const created = await products.create({ name: 'ToEdit', price: 10 });
    const id = (created.model as Product).id;
    const res = await products.update({ price: 20 }, id);
    expect((res.model as Product).price).toBe(20);
  });

  it('destroys by id', async () => {
    const created = await products.create({ name: 'ToDelete', price: 10 });
    const id = (created.model as Product).id;
    const res = await products.destroy(id);
    expect(res.success).toBe(true);
  });

  it('builds hierarchy with descendants', async () => {
    const res = (await categories.list_all({
      hierarchy: { filter_mode: 'with_descendants', children_key: 'children' },
      oper: { and: ['name|=|Electronics'] },
    })) as DataResult<Record<string, unknown>[]>;
    expect(res.data).toHaveLength(1);
    const root = res.data[0];
    expect(root.name).toBe('Electronics');
    expect((root.children as unknown[]).length).toBe(2);
  });
});
