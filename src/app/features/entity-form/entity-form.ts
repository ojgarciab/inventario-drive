import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { inventoryErrorMessage } from '../../core/inventory/inventory-messages';
import { InventoryStore } from '../../core/inventory/inventory-store';
import {
  Entity,
  EntityChanges,
  EntityId,
  NAME_MAX_LENGTH,
  NOTES_MAX_LENGTH,
} from '../../core/inventory/models';
import { Breadcrumb } from '../../shared/breadcrumb';
import { containerLink, entityLink } from '../../shared/entity-links';

/** Valores editables, en la forma en que se comparan para detectar cambios. */
interface FormValues {
  name: string;
  notes: string;
  tags: string;
  typeId: EntityId | null;
  quantity: number;
}

const FIELD_LABELS: Record<keyof FormValues, string> = {
  name: 'el nombre',
  notes: 'las notas',
  tags: 'las etiquetas',
  typeId: 'el tipo',
  quantity: 'la cantidad',
};

const splitTags = (tags: string) =>
  tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

/** Alta y edición de contenedores y objetos. */
@Component({
  imports: [
    Breadcrumb,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  selector: 'app-entity-form',
  styleUrl: './entity-form.scss',
  templateUrl: './entity-form.html',
})
export class EntityForm implements OnInit {
  private readonly store = inject(InventoryStore);
  private readonly router = inject(Router);

  /** Clase de entidad, fijada en la definición de la ruta. */
  readonly kind = input.required<Entity['kind']>();
  /** Id de la entidad que se edita; ausente en un alta. */
  readonly id = input<string>();
  /** Id del contenedor en el que se crea (parámetro `en`); ausente en la raíz. */
  readonly en = input<string>();

  protected readonly nameMax = NAME_MAX_LENGTH;
  protected readonly notesMax = NOTES_MAX_LENGTH;
  protected readonly types = this.store.types;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Campos que otro dispositivo ha cambiado mientras se editaban aquí. */
  protected readonly conflict = signal<string | null>(null);
  /** Valores con los que se abrió el formulario (o los últimos aceptados). */
  private baseline: FormValues | null = null;

  protected readonly entity = computed(() => {
    const entity = this.id() ? this.store.get(this.id() as string) : undefined;
    return entity?.kind === this.kind() ? entity : undefined;
  });
  protected readonly isEdit = computed(() => this.id() !== undefined);
  protected readonly notFound = computed(() => this.isEdit() && !this.entity());
  /** Contenedor en el que está o se va a crear la entidad. */
  private readonly parentId = computed<EntityId | null>(() => {
    if (this.isEdit()) return this.entity()?.parentId ?? null;
    const parent = this.en();
    return parent && this.store.get(parent)?.kind === 'container' ? parent : null;
  });
  protected readonly path = computed(() => {
    const anchor = this.isEdit() ? this.id() : this.parentId();
    return anchor ? this.store.path(anchor) : [];
  });
  protected readonly title = computed(() => {
    const noun = this.kind() === 'container' ? 'contenedor' : 'objeto';
    return this.isEdit() ? `Editar ${noun}` : `Nuevo ${noun}`;
  });
  protected readonly cancelLink = computed(() => {
    const entity = this.entity();
    return entity ? entityLink(entity) : containerLink(this.parentId());
  });

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.pattern(/\S/),
        Validators.maxLength(NAME_MAX_LENGTH),
      ],
    }),
    typeId: new FormControl<EntityId | null>(null),
    quantity: new FormControl(1, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)],
    }),
    notes: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(NOTES_MAX_LENGTH)],
    }),
    tags: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    const entity = this.entity();
    if (entity) {
      this.baseline = this.valuesOf(entity);
      this.form.patchValue(this.baseline);
      // Se piden los cambios recientes para editar sobre la versión más actual posible.
      void this.store.refresh();
    } else if (this.kind() === 'container') {
      this.form.controls.typeId.setValue(this.suggestedTypeId());
    }
  }

  protected async save(overwrite = false): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.conflict.set(null);
    try {
      const target = this.isEdit() ? await this.saveChanges(overwrite) : await this.create();
      if (target) await this.router.navigate(target);
    } catch (error) {
      this.error.set(inventoryErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** Descarta lo escrito en los campos en conflicto y adopta lo que guardó el otro dispositivo. */
  protected useCurrent(): void {
    const entity = this.entity();
    if (entity) {
      const current = this.valuesOf(entity);
      const mine = this.formValues();
      for (const key of this.changedKeys(this.baseline, current)) {
        if (mine[key] !== current[key]) this.form.patchValue({ [key]: current[key] });
      }
      this.baseline = current;
    }
    this.conflict.set(null);
  }

  /** Crea la entidad y devuelve la pantalla a la que ir después. */
  private async create(): Promise<string[]> {
    const value = this.formValues();
    const parentId = this.parentId();
    const common = { name: value.name, notes: value.notes, tags: splitTags(value.tags), parentId };
    if (this.kind() === 'container') {
      // Se abre el contenedor recién creado para empezar a llenarlo.
      return entityLink(await this.store.addContainer({ ...common, typeId: value.typeId }));
    }
    // Tras crear un objeto se vuelve al contenedor, para añadir el siguiente.
    await this.store.addItem({ ...common, quantity: value.quantity });
    return containerLink(parentId);
  }

  /**
   * Guarda solo los campos que el usuario ha cambiado, de modo que lo que
   * otro dispositivo haya cambiado en los demás campos se conserva. Si ambos
   * han tocado el mismo campo, se detiene y avisa (devuelve `null`).
   */
  private async saveChanges(overwrite: boolean): Promise<string[] | null> {
    const id = this.id() as string;
    await this.store.refresh();
    const entity = this.entity();
    if (!entity) return entityLink(await this.store.update(id, {})); // falla con «ya no existe»

    const mine = this.formValues();
    const current = this.valuesOf(entity);
    const changed = this.changedKeys(this.baseline, mine);
    const clashes = this.changedKeys(this.baseline, current).filter(
      (key) => changed.includes(key) && mine[key] !== current[key],
    );
    if (clashes.length > 0 && !overwrite) {
      this.conflict.set(clashes.map((key) => FIELD_LABELS[key]).join(', '));
      return null;
    }
    if (changed.length === 0) return entityLink(entity);

    const changes: EntityChanges = {};
    for (const key of changed) {
      if (key === 'tags') changes.tags = splitTags(mine.tags);
      else if (key === 'name') changes.name = mine.name;
      else if (key === 'notes') changes.notes = mine.notes;
      else if (key === 'typeId') changes.typeId = mine.typeId;
      else changes.quantity = mine.quantity;
    }
    return entityLink(await this.store.update(id, changes));
  }

  private changedKeys(from: FormValues | null, to: FormValues): (keyof FormValues)[] {
    const keys: (keyof FormValues)[] =
      this.kind() === 'container'
        ? ['name', 'notes', 'tags', 'typeId']
        : ['name', 'notes', 'tags', 'quantity'];
    return keys.filter((key) => !from || from[key] !== to[key]);
  }

  private formValues(): FormValues {
    const value = this.form.getRawValue();
    return {
      name: value.name.trim(),
      notes: value.notes.trim(),
      tags: splitTags(value.tags).join(', '),
      typeId: value.typeId,
      quantity: Number(value.quantity),
    };
  }

  private valuesOf(entity: Entity): FormValues {
    return {
      name: entity.name,
      notes: entity.notes,
      tags: entity.tags.join(', '),
      typeId: entity.kind === 'container' ? (this.store.typeOf(entity)?.id ?? null) : null,
      quantity: entity.kind === 'item' ? entity.quantity : 1,
    };
  }

  /** Tipo siguiente al del contenedor padre: casa → habitación → armario → caja. */
  private suggestedTypeId(): EntityId | null {
    const types = this.types();
    const parentId = this.parentId();
    const parent = parentId ? this.store.get(parentId) : undefined;
    if (parent?.kind !== 'container') return types[0]?.id ?? null;
    const index = types.findIndex((type) => type.id === this.store.typeOf(parent)?.id);
    return (types[index + 1] ?? types.at(-1))?.id ?? null;
  }
}
