import { Controller } from '@nestjs/common';
import { RestController } from '../base/rest.controller';
import { Product } from './product.entity';
import { ProductService } from './product.service';

/**
 * Concrete controller. The full CRUD surface (index, show, store, update,
 * updateMultiple, destroy, deleteById, getOne, exportData) is inherited.
 */
@Controller('products')
export class ProductController extends RestController<Product> {
  constructor(service: ProductService) {
    super(service);
  }
}
