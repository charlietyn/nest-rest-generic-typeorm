import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../base/base.entity';
import { Product } from './product.entity';

/**
 * Example self-referencing entity demonstrating hierarchical listing:
 * `HIERARCHY_FIELD_ID` points at the adjacency-list parent column.
 */
@Entity('categories')
export class Category extends BaseEntity {
  static readonly MODEL = 'category';
  static readonly RELATIONS = ['products', 'parent', 'children'] as const;
  static readonly HIERARCHY_FIELD_ID = 'parent_id';

  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ name: 'parent_id', type: 'int', nullable: true })
  parent_id!: number | null;

  @ManyToOne(() => Category, (c) => c.children)
  parent!: Category;

  @OneToMany(() => Category, (c) => c.parent)
  children!: Category[];

  @OneToMany(() => Product, (p) => p.category)
  products!: Product[];
}
