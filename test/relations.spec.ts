import 'reflect-metadata';
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  DataSource,
  Repository,
} from 'typeorm';
import { BaseEntity } from '../src/base/base.entity';
import { BaseService } from '../src/base/base.service';
import { DEFAULT_CONFIG } from '../src/config/rest-generic.config';
import {
  ManyToManyConfig,
  OneToManyConfig,
  ResolvedRelationConfig,
} from '../src/relations/relation-config';
import { Product } from '../src/example/product.entity';
import { Category } from '../src/example/category.entity';

@Entity('tags')
class Tag extends BaseEntity {
  static readonly MODEL = 'tag';
  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
}

@Entity('product_tags')
class ProductTag extends BaseEntity {
  static readonly MODEL = 'product_tag';
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'int' }) product_id!: number;
  @Column({ type: 'int' }) tag_id!: number;
  @Column({ type: 'varchar', nullable: true }) note!: string | null;
}

class ProductSvc extends BaseService<Product> {}

const o2m: ResolvedRelationConfig = {
  _type: 'o2m',
  relationship: 'products',
  relatedModel: Product,
  parentModel: Category,
  foreignKey: 'category_id',
  localKey: 'id',
  mutation: { dataKey: ['products'], deleteRelated: true },
} as OneToManyConfig & { _type: 'o2m' };

const m2m: ResolvedRelationConfig = {
  _type: 'm2m',
  relationship: 'tags',
  relatedModel: Tag,
  parentModel: Product,
  pivotModel: ProductTag,
  parentKey: 'product_id',
  relatedKey: 'tag_id',
  mutation: { dataKey: ['tags'], deleteRelated: false, pivotColumns: ['note'] },
} as ManyToManyConfig & { _type: 'm2m' };

describe('nest-rest-generic-typeorm · RelationManager', () => {
  let ds: DataSource;
  let categoryRepo: Repository<Category>;
  let productRepo: Repository<Product>;
  // O2M parent is Category, so we drive O2M through a Category-backed service.
  let categorySvc: BaseService<Category>;
  let productSvc: ProductSvc;
  let phonesId: number;
  let iphoneId: number;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [Product, Category, Tag, ProductTag],
      synchronize: true,
    });
    await ds.initialize();
    categoryRepo = ds.getRepository(Category);
    productRepo = ds.getRepository(Product);
    categorySvc = new (class extends BaseService<Category> {})(categoryRepo, DEFAULT_CONFIG);
    productSvc = new ProductSvc(productRepo, DEFAULT_CONFIG);

    const phones = await categoryRepo.save(categoryRepo.create({ name: 'Phones', parent_id: null }));
    phonesId = phones.id;
    const iphone = await productRepo.save(productRepo.create({ name: 'iPhone', price: 999, status: 'active', category_id: phones.id }));
    iphoneId = iphone.id;
    await ds.getRepository(Tag).save([{ name: 'new' }, { name: 'sale' }, { name: 'hot' }]);
  });

  afterAll(async () => ds.destroy());

  it('O2M: lists related rows scoped to the parent', async () => {
    const res = (await categorySvc.listRelation(o2m, phonesId, {})) as { data: Product[] };
    expect(res.data).toHaveLength(1);
    expect(res.data[0].name).toBe('iPhone');
  });

  it('O2M: creates a related row with the FK set automatically', async () => {
    const res = await categorySvc.createRelation(o2m, phonesId, { name: 'Pixel', price: 799 }, false);
    expect(res.success).toBe(true);
    const list = (await categorySvc.listRelation(o2m, phonesId, {})) as { data: Product[] };
    expect(list.data.map((p) => p.name).sort()).toEqual(['Pixel', 'iPhone']);
    expect(list.data.every((p) => p.category_id === phonesId)).toBe(true);
  });

  it('O2M: bulk create + filtered list via oper', async () => {
    await categorySvc.createRelation(o2m, phonesId, [{ name: 'Cheap', price: 10 }, { name: 'Mid', price: 300 }], true);
    const res = (await categorySvc.listRelation(o2m, phonesId, { oper: { and: ['price|>=|300'] } })) as { data: Product[] };
    expect(res.data.map((p) => p.name).sort()).toEqual(['Mid', 'Pixel', 'iPhone']);
  });

  it('M2M: attach (single + bulk) with pivot whitelist, then list', async () => {
    await productSvc.attachRelation(m2m, iphoneId, { tag_id: 1, note: 'keep', dropme: 'x' }, 'attach');
    await productSvc.attachRelation(m2m, iphoneId, [{ tag_id: 2 }, { tag_id: 3 }], 'bulk_attach');
    const res = (await productSvc.listRelation(m2m, iphoneId, {})) as { data: Tag[] };
    expect(res.data.map((t) => t.id).sort()).toEqual([1, 2, 3]);
    const pivotRepo = ds.getRepository(ProductTag);
    const pivot = await pivotRepo.findOne({ where: { product_id: iphoneId, tag_id: 1 } });
    expect(pivot?.note).toBe('keep');
    expect((pivot as unknown as Record<string, unknown>).dropme).toBeUndefined();
  });

  it('M2M: sync replaces the set', async () => {
    await productSvc.attachRelation(m2m, iphoneId, [1, 2], 'sync');
    const res = (await productSvc.listRelation(m2m, iphoneId, {})) as { data: Tag[] };
    expect(res.data.map((t) => t.id).sort()).toEqual([1, 2]);
  });

  it('M2M: detach removes the pivot but not the related row', async () => {
    await productSvc.detachRelation(m2m, iphoneId, 1, [], false);
    const res = (await productSvc.listRelation(m2m, iphoneId, {})) as { data: Tag[] };
    expect(res.data.map((t) => t.id)).toEqual([2]);
    const tag = await ds.getRepository(Tag).findOne({ where: { id: 1 } });
    expect(tag).not.toBeNull();
  });

  it('actionValidate returns success by default', async () => {
    const res = await productSvc.actionValidate('create', { name: 'x' });
    expect(res.success).toBe(true);
  });
});
