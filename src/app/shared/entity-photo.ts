import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { inventoryErrorMessage } from '../core/inventory/inventory-messages';
import { InventoryStore } from '../core/inventory/inventory-store';
import { Entity, EntityId, Photo } from '../core/inventory/models';
import { PhotoService } from '../core/photos/photo-service';
import { confirm } from './confirm-dialog';

type PhotoState = 'none' | 'loading' | 'ready' | 'error';

/** Niveles de ampliación de la lupa; el primero es el tamaño normal. */
const ZOOM_LEVELS = [1, 1.5, 2, 3, 4];
/** Desplazamiento a partir del cual un gesto es arrastrar y no pulsar. */
const DRAG_THRESHOLD_PX = 5;

/**
 * Fotografías de un contenedor o de un objeto: la elegida se ve en grande
 * (al entrar, la destacada) y debajo queda la galería con todas en pequeño.
 * Incluye las acciones para añadir fotos, destacar una y quitarlas, y sobre
 * la foto, una lupa para acercarla y botones para girarla.
 */
@Component({
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule],
  selector: 'app-entity-photo',
  host: { '[class.with-photo]': "state() !== 'none'" },
  styleUrl: './entity-photo.scss',
  templateUrl: './entity-photo.html',
})
export class EntityPhoto {
  private readonly photos = inject(PhotoService);
  private readonly store = inject(InventoryStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly entity = input.required<Entity>();

  private readonly entityId = computed(() => this.entity().id);
  protected readonly gallery = computed(() => this.store.photosOf(this.entityId()));
  protected readonly featuredId = computed(() => this.store.featuredPhotoId(this.entityId()));

  /** Foto que el usuario ha elegido ver en grande; sin elegir, la destacada. */
  private readonly picked = signal<EntityId | null>(null);
  protected readonly selectedId = computed(() => {
    const picked = this.picked();
    return picked && this.gallery().some((photo) => photo.id === picked)
      ? picked
      : this.featuredId();
  });

  private readonly selected = computed(() =>
    this.gallery().find((photo) => photo.id === this.selectedId()),
  );

  /**
   * Direcciones locales de las fotos ya cargadas y fotos cuya carga ha
   * fallado. Van por foto y giro: al girar una foto se pide su nueva versión.
   */
  private readonly loaded = signal<ReadonlyMap<string, string>>(new Map());
  private readonly failed = signal<ReadonlySet<string>>(new Set());
  /** Dirección de cada foto de la galería, con el giro que tiene ahora. */
  protected readonly urls = computed(() => {
    const loaded = this.loaded();
    const urls = new Map<EntityId, string>();
    for (const photo of this.gallery()) {
      const url = loaded.get(versionOf(photo));
      if (url) urls.set(photo.id, url);
    }
    return urls;
  });

  protected readonly state = computed<PhotoState>(() => {
    const photo = this.selected();
    if (!photo) return 'none';
    if (this.urls().has(photo.id)) return 'ready';
    return this.failed().has(versionOf(photo)) ? 'error' : 'loading';
  });
  protected readonly url = computed(() => this.urls().get(this.selectedId() ?? '') ?? null);
  protected readonly expanded = signal(false);
  protected readonly busy = signal(false);

  /** Posición en `ZOOM_LEVELS` del nivel de ampliación actual. */
  private readonly zoomIndex = signal(0);
  protected readonly zoom = computed(() => ZOOM_LEVELS[this.zoomIndex()]);
  protected readonly zoomed = computed(() => this.zoomIndex() > 0);
  protected readonly canZoomIn = computed(() => this.zoomIndex() < ZOOM_LEVELS.length - 1);
  /** Marco con desplazamiento dentro del que se mueve la foto ampliada. */
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  /** Arrastre en curso para mover la foto ampliada con el ratón. */
  private drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;

  constructor() {
    // Al pasar a otra entidad se vuelve a empezar por su foto destacada.
    effect(() => {
      this.entityId();
      this.picked.set(null);
    });
    effect(() => {
      this.selectedId();
      this.expanded.set(false);
      this.zoomIndex.set(0);
    });
    // Carga las fotos de la galería según aparecen, también las de otro dispositivo.
    effect(() => {
      const gallery = this.gallery();
      untracked(() => {
        for (const photo of gallery) {
          const version = versionOf(photo);
          if (!this.loaded().has(version) && !this.failed().has(version)) this.load(photo);
        }
      });
    });
  }

  protected select(photoId: EntityId): void {
    this.picked.set(photoId);
  }

  /** Pulsar la foto la amplía o la reduce; si está acercada, la devuelve a su tamaño. */
  protected toggle(): void {
    if (this.drag?.moved) return; // era el final de un arrastre, no una pulsación
    if (this.zoomed()) this.zoomIndex.set(0);
    else this.expanded.set(!this.expanded());
  }

  protected zoomIn(): void {
    if (this.canZoomIn()) this.setZoom(this.zoomIndex() + 1);
  }

  protected zoomOut(): void {
    if (this.zoomed()) this.setZoom(this.zoomIndex() - 1);
  }

  /** Cambia la ampliación manteniendo en el centro lo que se estaba mirando. */
  private setZoom(index: number): void {
    const viewport = this.viewport()?.nativeElement;
    const centerX = viewport
      ? relativeCenter(viewport.scrollLeft, viewport.clientWidth, viewport.scrollWidth)
      : 0.5;
    const centerY = viewport
      ? relativeCenter(viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight)
      : 0.5;
    this.zoomIndex.set(index);
    this.expanded.set(true); // acercada se ve siempre entera, sin recortar
    if (!viewport) return;
    requestAnimationFrame(() => {
      viewport.scrollLeft = centerX * viewport.scrollWidth - viewport.clientWidth / 2;
      viewport.scrollTop = centerY * viewport.scrollHeight - viewport.clientHeight / 2;
    });
  }

  // En pantallas táctiles la foto ampliada se mueve con el dedo, de forma
  // nativa; con ratón se arrastra.
  protected dragStart(event: PointerEvent): void {
    const viewport = this.viewport()?.nativeElement;
    if (!viewport || !this.zoomed() || event.pointerType !== 'mouse' || event.button !== 0) {
      this.drag = null;
      return;
    }
    this.drag = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      moved: false,
    };
  }

  protected dragMove(event: PointerEvent): void {
    const viewport = this.viewport()?.nativeElement;
    if (!this.drag || !viewport || event.buttons !== 1) return;
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) this.drag.moved = true;
    if (this.drag.moved) {
      viewport.scrollLeft = this.drag.left - dx;
      viewport.scrollTop = this.drag.top - dy;
    }
  }

  /** Gira la foto que se está viendo 90° a la derecha (1) o a la izquierda (-1). */
  protected async rotate(quarterTurns: 1 | -1): Promise<void> {
    const photoId = this.selectedId();
    if (!photoId) return;
    await this.run(async () => {
      await this.photos.rotate(this.entityId(), photoId, quarterTurns);
    });
  }

  protected retry(): void {
    const photo = this.selected();
    if (photo) this.load(photo);
  }

  protected async pick(input: HTMLInputElement): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = ''; // permite volver a elegir los mismos archivos
    if (files.length === 0) return;
    const entityId = this.entityId();
    await this.run(async () => {
      for (const file of files) {
        const photo = await this.photos.attach(entityId, file);
        this.picked.set(photo.id); // se enseña lo que se acaba de añadir
      }
    });
  }

  protected async feature(): Promise<void> {
    const photoId = this.selectedId();
    if (photoId) await this.run(() => this.photos.feature(this.entityId(), photoId));
  }

  protected async remove(): Promise<void> {
    const photoId = this.selectedId();
    if (!photoId) return;
    const accepted = await confirm(this.dialog, {
      title: '¿Quitar la foto?',
      message: 'La foto se borrará de Google Drive y no se podrá recuperar.',
      confirmLabel: 'Quitar',
    });
    if (accepted) await this.run(() => this.photos.remove(this.entityId(), photoId));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.snackBar.open(inventoryErrorMessage(error), 'Cerrar');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(photo: Photo): Promise<void> {
    const version = versionOf(photo);
    this.failed.update((failed) => without(failed, version));
    try {
      const url = await this.photos.objectUrl(photo.id, photo.rotation);
      this.loaded.update((loaded) => new Map(loaded).set(version, url));
    } catch {
      this.failed.update((failed) => new Set(failed).add(version));
    }
  }
}

/** Identifica una foto con un giro concreto. */
const versionOf = (photo: Photo) => `${photo.id}@${photo.rotation}`;

/** Punto central de lo visible, como fracción (0–1) del total desplazable. */
function relativeCenter(scroll: number, visible: number, total: number): number {
  return total > 0 ? (scroll + visible / 2) / total : 0.5;
}

function without(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!ids.has(id)) return ids;
  const next = new Set(ids);
  next.delete(id);
  return next;
}
