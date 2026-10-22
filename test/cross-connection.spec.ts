import 'reflect-metadata';
import { Column, Entity, PrimaryGeneratedColumn, DataSource } from 'typeorm';
import { BaseEntity } from '../src/base/base.entity';
import { BaseService } from '../src/base/base.service';
import { DEFAULT_CONFIG } from '../src/config/rest-generic.config';
import { OneToManyConfig, ResolvedRelationConfig } from '../src/relations/relation-config';

/**
 * Polyglot persistence: the parent (Owner) lives on one connection and the
 * related model (Note) on another. The RelationManager must resolve Note's
 * repository from ITS OWN data source — not the parent's — and transact there.
 */
@Entity('owners')
class Owner extends BaseEntity {
  static readonly MODEL = 'owner';
  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
}

@Entity('notes')
class Note extends BaseEntity {
  static readonly MODEL = 'note';
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'int' }) owner_id!: number;
  @Column() text!: string;
}

const o2m: ResolvedRelationConfig = {
  _type: 'o2m',
  relationship: 'notes',
  relatedModel: Note,
  parentModel: Owner,
  foreignKey: 'owner_id',
  localKey: 'id',
  mutation: { dataKey: ['notes'], deleteRelated: true },
} as OneToManyConfig & { _type: 'o2m' };

describe('nest-rest-generic-typeorm · cross-connection relations', () => {
  let ownersDs: DataSource;
  let notesDs: DataSource;
  let ownerSvc: BaseService<Owner>;
  let ownerId: number;

  beforeAll(async () => {
    ownersDs = new DataSource({ type: 'sqlite', database: ':memory:', entities: [Owner], synchronize: true });
    notesDs = new DataSource({ type: 'sqlite', database: ':memory:', entities: [Note], synchronize: true });
    await ownersDs.initialize();
    await notesDs.initialize();

    // Constructing both services registers BOTH data sources with the registry.
    ownerSvc = new (class extends BaseService<Owner> {})(ownersDs.getRepository(Owner), DEFAULT_CONFIG);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const noteSvc = new (class extends BaseService<Note> {})(notesDs.getRepository(Note), DEFAULT_CONFIG);

    const owner = await ownersDs.getRepository(Owner).save({ name: 'Ada' });
    ownerId = owner.id;
    await notesDs.getRepository(Note).save([
      { owner_id: owner.id, text: 'first' },
      { owner_id: owner.id, text: 'second' },
    ]);
  });

  afterAll(async () => {
    await ownersDs.destroy();
    await notesDs.destroy();
  });

  it('lists a related entity that lives on another connection', async () => {
    const res = (await ownerSvc.listRelation(o2m, ownerId, {})) as { data: Note[] };
    expect(res.data.map((n) => n.text).sort()).toEqual(['first', 'second']);
  });

  it('creates a related entity on its own connection (transaction there)', async () => {
    const res = (await ownerSvc.createRelation(o2m, ownerId, { text: 'third' }, false)) as {
      success: boolean;
      model: Note;
    };
    expect(res.success).toBe(true);
    expect(res.model.owner_id).toBe(ownerId);
    // The row landed in the notes connection, not the owners one.
    const inNotes = await notesDs.getRepository(Note).count();
    expect(inNotes).toBe(3);
  });
});
