import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { InventoryStore } from '../core/inventory/inventory-store';
import { EntityId } from '../core/inventory/models';
import { PhotoService } from '../core/photos/photo-service';

/**
 * Miniatura de la foto destacada de un contenedor o de un objeto, para las
 * listas. No hay archivos de miniatura: se usa la propia foto, que solo se
 * descarga cuando la fila llega a verse y queda en la caché del dispositivo.
 * Sin foto (o si no se puede cargar) no ocupa sitio (ver `styles.scss`).
 */
@Component({
  selector: 'app-entity-thumb',
  host: { '[class.empty]': '!url()' },
  template: `
    @if (url(); as src) {
      <img [src]="src" alt="" />
    }
  `,
  styles: `
    :host {
      align-self: center;
      background: var(--mat-sys-surface-container);
      border-radius: 6px;
      display: block;
      flex: none;
      height: 44px;
      overflow: hidden;
      width: 44px;
    }

    img {
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
  `,
})
export class EntityThumb {
  private readonly store = inject(InventoryStore);
  private readonly photos = inject(PhotoService);

  readonly entityId = input.required<EntityId>();

  private readonly photo = computed(() => {
    const id = this.store.featuredPhotoId(this.entityId());
    return id ? this.store.photosOf(this.entityId()).find((photo) => photo.id === id) : undefined;
  });
  /** La fila está (o ha estado) a la vista; hasta entonces no se descarga nada. */
  private readonly seen = signal(false);
  private readonly loaded = signal<{ key: string; url: string } | null>(null);
  private readonly key = computed(() => {
    const photo = this.photo();
    return photo ? `${photo.id}@${photo.rotation}` : null;
  });
  protected readonly url = computed(() => {
    const loaded = this.loaded();
    return loaded && loaded.key === this.key() ? loaded.url : null;
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    // Se espera al primer pintado: antes la miniatura aún no está en su fila.
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        this.seen.set(true);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            this.seen.set(true);
            observer.disconnect();
          }
        },
        { rootMargin: '200px' },
      );
      // Oculta no tiene tamaño: se observa la fila que la contiene.
      observer.observe(host.parentElement ?? host);
      destroyRef.onDestroy(() => observer.disconnect());
    });

    effect(() => {
      const photo = this.photo();
      const key = this.key();
      if (!photo || !key || !this.seen()) return;
      this.photos.objectUrl(photo.id, photo.rotation).then(
        (url) => this.loaded.set({ key, url }),
        () => undefined, // sin miniatura la fila se queda como estaba
      );
    });
  }
}
