import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { inventoryErrorMessage } from '../../core/inventory/inventory-messages';
import { InventoryStore } from '../../core/inventory/inventory-store';
import { ContainerType } from '../../core/inventory/models';
import { InstallService } from '../../core/pwa/install-service';
import { confirm } from '../../shared/confirm-dialog';
import { installApp } from '../../shared/ios-install-dialog';
import { TypeDialog, TypeDialogData, TypeDialogResult } from './type-dialog';

interface Task {
  label: string;
  done: number;
  total: number;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Ajustes: tipos de contenedor e instalación. Las copias están en Almacenamiento. */
@Component({
  imports: [MatButtonModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink],
  selector: 'app-settings',
  styleUrl: './settings.scss',
  templateUrl: './settings.html',
})
export class Settings {
  private readonly store = inject(InventoryStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

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
      this.snackBar.open(inventoryErrorMessage(error), 'Cerrar');
    } finally {
      this.task.set(null);
    }
  }
}
