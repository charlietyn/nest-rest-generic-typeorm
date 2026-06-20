import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BaseEntity } from '../base/base.entity';
import { Category } from './category.entity';

/**
 * Example concrete entity. Note the static convention members inherited from
 * BaseEntity: MODEL, RELATIONS (whitelist), CACHE_INVALIDATES.
 */
@Entity('products')
export class Product extends BaseEntity {
  static readonly MODEL = 'product';
  static readonly RELATIONS = ['category'] as const;

  /**
   * Role-based field write restriction. `status` is only writable by admins;
   * any non-admin write to `status` is silently stripped before persistence.
   */
  static readonly FIELDS_BY_ROLE = { admin: ['status'] };

  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price!: number;

  @Column({ default: 'active' })
  status!: string;

  @Column({ name: 'category_id', type: 'int', nullable: true })
  category_id!: number | null;

  @ManyToOne(() => Category, (category) => category.products)
  @JoinColumn({ name: 'category_id' })
  category!: Category;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
