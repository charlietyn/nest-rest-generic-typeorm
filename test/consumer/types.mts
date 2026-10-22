import { GenericRestModule, BaseService, type FilterParams, type RestGenericConfigInput } from '@charlietyn/nest-rest-typeorm';
const config: RestGenericConfigInput = { cache: { ttlByMethod: { get_one: 5 } } };
const query: FilterParams = { relations: ['category'], orderby: [{ id: 'asc' }] };
GenericRestModule.forRoot({ config });
void [BaseService, query];
