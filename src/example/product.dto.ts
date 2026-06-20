import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** Create DTO — validated by Nest's ValidationPipe at the controller. */
export class CreateProductDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;

  @IsOptional()
  @IsNumber()
  category_id?: number;
}

/** Update DTO — all fields optional. */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;

  @IsOptional()
  @IsNumber()
  category_id?: number;
}
