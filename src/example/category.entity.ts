import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
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

  // `@JoinColumn` binds the relation to the existing `parent_id` column. Without
  // it TypeORM would add a second, never-populated FK (`parentId`), leaving
  // `parent`/`children` permanently empty and out of sync with HIERARCHY_FIELD_ID.
  @ManyToOne(() => Category, (c) => c.children)
  @JoinColumn({ name: 'parent_id' })
  parent!: Category;

  @OneToMany(() => Category, (c) => c.parent)
  children!: Category[];

  @OneToMany(() => Product, (p) => p.category)
  products!: Product[];
}
