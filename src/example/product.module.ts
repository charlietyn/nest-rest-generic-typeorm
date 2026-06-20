import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './product.entity';
import { Category } from './category.entity';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';

/**
 * Wiring example. Register the entities and the generic service/controller.
 * Remember to import `GenericRestModule.forRoot({...})` once at the app root.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Product, Category])],
  providers: [ProductService],
  controllers: [ProductController],
  exports: [ProductService],
})
export class ProductModule {}
