import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { BackupError } from '../../core/backup/backup-format';
import { BackupService } from '../../core/backup/backup-service';
import { inventoryErrorMessage } from '../../core/inventory/inventory-messages';
import { InventoryStore } from '../../core/inventory/inventory-store';
import { ContainerType } from '../../core/inventory/models';
import { InstallService } from '../../core/pwa/install-service';
import { confirm } from '../../shared/confirm-dialog';
import { installApp } from '../../shared/ios-install-dialog';
import { DOWNLOADER } from '../../shared/download';
import { TypeDialog, TypeDialogData, TypeDialogResult } from './type-dialog';

interface Task {
  label: string;
  done: number;
  total: number;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Ajustes: tipos de contenedor y copias de seguridad. */
@Component({
  imports: [MatButtonModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink],
  selector: 'app-settings',
  styleUrl: './settings.scss',
  templateUrl: './settings.html',
})
export class Settings {
  private readonly store = inject(InventoryStore);
  private readonly backups = inject(BackupService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly download = inject(DOWNLOADER);

  private readonly installer = inject(InstallService);
  protected readonly installState = this.installer.state;

  protected readonly types = this.store.types;
  /** Operación larga en curso; mientras dura no se puede iniciar otra. */
  protected readonly task = signal<Task | null>(null);
  protected readonly busy = computed(() => this.task() !== null);
  protected readonly percent = computed(() => {
    const task = this.task();
    return task && task.total > 0 ? Math.round((task.done / task.total) * 100) : 0;
  });
  protected readonly counts = this.store.counts;

  protected install(): Promise<void> {
    return installApp(this.installer, this.dialog);
  }

  protected async addType(): Promise<void> {
    const result = await this.askType({ title: 'Nuevo tipo', name: '', icon: 'category' });
    if (result) await this.run('Guardando el tipo…', () => this.store.addType(result));
  }

  protected async editType(type: ContainerType): Promise<void> {
    const result = await this.askType({ title: 'Editar tipo', name: type.name, icon: type.icon });
    if (result) await this.run('Guardando el tipo…', () => this.store.updateType(type.id, result));
  }

  protected async moveType(type: ContainerType, direction: -1 | 1): Promise<void> {
    await this.run('Reordenando…', () => this.store.moveType(type.id, direction));
  }

  protected async removeType(type: ContainerType): Promise<void> {
    const inUse = this.store
      .everything()
      .filter((e) => e.kind === 'container' && this.store.typeOf(e)?.id === type.id).length;
    const accepted = await confirm(this.dialog, {
      title: `¿Eliminar el tipo «${type.name}»?`,
      message:
        inUse === 0
          ? 'Ningún contenedor lo usa.'
          : `${plural(inUse, 'contenedor lo usa y quedará', 'contenedores lo usan y quedarán')} sin tipo. Los contenedores y su contenido no se borran.`,
      confirmLabel: 'Eliminar',
    });
    if (accepted) await this.run('Eliminando el tipo…', () => this.store.removeType(type.id));
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

  private async askType(data: TypeDialogData): Promise<TypeDialogResult | undefined> {
    const ref = this.dialog.open<TypeDialog, TypeDialogData, TypeDialogResult>(TypeDialog, {
      data,
      width: 'min(420px, calc(100vw - 32px))',
    });
    return firstValueFrom(ref.afterClosed());
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
