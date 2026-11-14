import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { BackupError } from '../../core/backup/backup-format';
import { BackupService } from '../../core/backup/backup-service';
import { inventoryErrorMessage } from '../../core/inventory/inventory-messages';
import { InventoryCache } from '../../core/inventory/inventory-cache';
import { InventoryRepository } from '../../core/inventory/inventory-repository';
import { InventoryStore } from '../../core/inventory/inventory-store';
import { StorageUsage } from '../../core/inventory/models';
import { Connectivity } from '../../core/pwa/connectivity';
import { PhotoService } from '../../core/photos/photo-service';
import { confirm } from '../../shared/confirm-dialog';
import { DOWNLOADER } from '../../shared/download';
import { formatBytes, formatPercent } from './format-bytes';

interface Task {
  label: string;
  done: number;
  total: number;
}

type UsageState = 'loading' | 'ready' | 'error';

/** Lo que la aplicación tiene guardado en este dispositivo. */
interface DeviceUsage {
  /** Copia del inventario; `null` si todavía no se ha guardado ninguna. */
  dataBytes: number | null;
  photoBytes: number;
  photoCount: number;
  /** Todo lo que ocupa la aplicación según el navegador, incluidos sus propios archivos. */
  totalBytes: number | null;
}

const SYNC_DATE = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Almacenamiento: espacio que ocupa el inventario en Drive, lo que hay guardado
 * en el dispositivo para usarlo sin conexión, y copias de seguridad.
 */
@Component({
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, RouterLink],
  selector: 'app-storage',
  styleUrl: './storage.scss',
  templateUrl: './storage.html',
})
export class Storage {
  private readonly repository = inject(InventoryRepository);
  private readonly store = inject(InventoryStore);
  /** Sin conexión solo se puede consultar: las acciones que guardan se desactivan. */
  protected readonly online = inject(Connectivity).online;
  private readonly backups = inject(BackupService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly download = inject(DOWNLOADER);
  private readonly cache = inject(InventoryCache);
  private readonly photos = inject(PhotoService);

  protected readonly counts = this.store.counts;
  protected readonly usageState = signal<UsageState>('loading');
  private readonly usage = signal<StorageUsage | null>(null);

  /** Datos de la barra: lo que ocupan los datos y las fotos, y su parte del total. */
  protected readonly summary = computed(() => {
    const usage = this.usage();
    if (!usage) return null;
    const total = usage.dataBytes + usage.photoBytes;
    const account = usage.account;
    return {
      total: formatBytes(total),
      empty: total === 0,
      data: {
        size: formatBytes(usage.dataBytes),
        files: plural(usage.dataFiles, 'archivo', 'archivos'),
        // Proporción para repartir la barra; con cero no se dibuja el tramo.
        weight: usage.dataBytes,
      },
      photos: {
        size: formatBytes(usage.photoBytes),
        files: plural(usage.photoFiles, 'fotografía', 'fotografías'),
        weight: usage.photoBytes,
      },
      account: account && {
        used: formatBytes(account.usedBytes),
        limit: account.limitBytes === null ? null : formatBytes(account.limitBytes),
        share: account.limitBytes && total > 0 ? formatPercent(total / account.limitBytes) : null,
      },
    };
  });

  private readonly device = signal<DeviceUsage | null>(null);
  /** Datos de la barra de lo guardado en el dispositivo para usarlo sin conexión. */
  protected readonly deviceSummary = computed(() => {
    const device = this.device();
    if (!device) return null;
    const dataBytes = device.dataBytes ?? 0;
    const syncedAt = this.store.syncedAt();
    return {
      total: formatBytes(dataBytes + device.photoBytes),
      empty: dataBytes + device.photoBytes === 0,
      data: {
        size: formatBytes(dataBytes),
        detail:
          device.dataBytes === null
            ? 'todavía no hay copia'
            : syncedAt
              ? `sincronizada el ${SYNC_DATE.format(new Date(syncedAt))}`
              : 'guardada',
        weight: dataBytes,
      },
      photos: {
        size: formatBytes(device.photoBytes),
        detail: `${device.photoCount} de ${plural(this.store.photoCount(), 'fotografía', 'fotografías')}`,
        weight: device.photoBytes,
      },
      appTotal: device.totalBytes === null ? null : formatBytes(device.totalBytes),
    };
  });

  /** Operación larga en curso; mientras dura no se puede iniciar otra. */
  protected readonly task = signal<Task | null>(null);
  protected readonly busy = computed(() => this.task() !== null);
  protected readonly percent = computed(() => {
    const task = this.task();
    return task && task.total > 0 ? Math.round((task.done / task.total) * 100) : 0;
  });

  constructor() {
    void this.loadUsage();
    void this.loadDeviceUsage();
  }

  private async loadDeviceUsage(): Promise<void> {
    const [dataBytes, photos, totalBytes] = await Promise.all([
      this.cache.size(),
      this.photos.cacheUsage(),
      // No todos los navegadores informan de cuánto ocupa el sitio.
      navigator.storage
        ?.estimate?.()
        .then((estimate) => estimate.usage ?? null)
        .catch(() => null) ?? Promise.resolve(null),
    ]);
    this.device.set({ dataBytes, photoBytes: photos.bytes, photoCount: photos.count, totalBytes });
  }

  protected async loadUsage(): Promise<void> {
    this.usageState.set('loading');
    try {
      this.usage.set(await this.repository.storageUsage());
      this.usageState.set('ready');
    } catch {
      this.usageState.set('error');
    }
  }

  protected async exportJson(): Promise<void> {
    await this.run('Preparando los datos…', async () => {
      this.download(this.backups.exportJson(), `inventario-${today()}.json`);
    });
  }

  protected async exportZip(): Promise<void> {
    await this.run('Reuniendo las fotografías…', async (progress) => {
      this.download(await this.backups.exportZip(progress), `inventario-${today()}.zip`);
    });
  }

  protected async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.run('Leyendo la copia…', async (progress) => {
      const loaded = await this.backups.read(file);
      const { containers, items, photos } = loaded.summary;
      if (containers + items === 0) {
        this.snackBar.open('La copia no contiene ningún elemento.', 'Cerrar');
        return;
      }
      const accepted = await confirm(this.dialog, {
        title: '¿Importar la copia?',
        message:
          `Se añadirán ${plural(containers, 'contenedor', 'contenedores')}, ` +
          `${plural(items, 'objeto', 'objetos')} y ${plural(photos, 'fotografía', 'fotografías')} ` +
          'al inventario actual. No se borra ni se modifica nada de lo que ya hay, así que ' +
          'importar una copia de este mismo inventario duplicaría su contenido.',
        confirmLabel: 'Importar',
      });
      if (!accepted) return;
      this.task.set({ label: 'Importando…', done: 0, total: 0 });
      const result = await this.backups.import(loaded, progress);
      void this.loadUsage(); // lo importado cambia el espacio ocupado
      this.snackBar.open(
        `Importados ${plural(result.containers, 'contenedor', 'contenedores')}, ` +
          `${plural(result.items, 'objeto', 'objetos')} y ` +
          `${plural(result.photos, 'fotografía', 'fotografías')}.` +
          (result.failedPhotos > 0
            ? ` No se pudieron subir ${plural(result.failedPhotos, 'fotografía', 'fotografías')}.`
            : ''),
        'Cerrar',
      );
    });
  }

  /** Ejecuta una operación mostrando su avance y avisando si falla. */
  private async run(
    label: string,
    action: (progress: (done: number, total: number) => void) => Promise<unknown>,
  ): Promise<void> {
    if (this.busy()) return;
    this.task.set({ label, done: 0, total: 0 });
    try {
      await action((done, total) => this.task.update((task) => task && { ...task, done, total }));
    } catch (error) {
      const message = error instanceof BackupError ? error.message : inventoryErrorMessage(error);
      this.snackBar.open(message, 'Cerrar');
    } finally {
      this.task.set(null);
    }
  }
}

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
